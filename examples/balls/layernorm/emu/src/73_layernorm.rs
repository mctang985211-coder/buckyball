use super::super::bank::{bank_num, bank_size};
use super::decode::{pbank_group, rs1_b0, rs1_b1, rs1_b2, rs1_iter};
use super::instruction::{BallInstruction, ExecContext};

/// LayerNormBall: BERT-exact fp32 layer normalization.
///
/// For each normalized row r (of `rows`) with `cols` f32 elements:
///   mean = (1/cols) * sum(x)
///   var  = (1/cols) * sum((x - mean)^2)      (biased, torch semantics)
///   y    = (x - mean) * rsqrt(var + 1e-12) * gamma + beta
///
/// gamma/beta are shared per-row C-wide vectors, packed densely as
/// [0, C) = gamma, [C, 2C) = beta in the param region.
///
/// Region geometry (16B bank lines, 4 f32 lanes per line):
/// logical line L of the x/out tensor = r * (cols/4) + e/4 for element e of
/// row r; physical bank group = L / 64, line offset = (L % 64) * 16B.
/// Param region lines are numbered in the same flat space over C/2 lines.
/// Golden math is f64; results are stored as f32.

const LN_EPS: f64 = 1e-12;
const LANES_PER_LINE: usize = 4; // bank row bytes / 4

struct Encoded {
    x_bank: u64,
    param_bank: u64,
    out_bank: u64,
    rows: usize,
    cols: usize,
}

fn lines_per_bank() -> usize {
    bank_size() / 16
}

fn check_encoding(xs1: u64, xs2: u64) -> Encoded {
    let x_bank = rs1_b0(xs1);
    let param_bank = rs1_b1(xs1);
    let out_bank = rs1_b2(xs1);
    let rows = rs1_iter(xs1) as usize;
    let cols = (xs2 & 0xffff_ffff) as usize;

    if xs2 >> 32 != 0 {
        panic!("layernorm: rs2[63:32] must be zero");
    }
    if rows == 0 {
        panic!("layernorm: rows (iter) must be > 0");
    }
    if !matches!(cols, 4 | 64 | 256 | 512) {
        panic!("layernorm: unsupported cols={cols}");
    }
    for bank in [x_bank, param_bank, out_bank] {
        if bank >= bank_num() as u64 {
            panic!("layernorm: invalid bank id {bank}");
        }
    }
    if x_bank == param_bank || x_bank == out_bank || param_bank == out_bank {
        panic!("layernorm: x, param and out banks must be distinct");
    }
    Encoded {
        x_bank,
        param_bank,
        out_bank,
        rows,
        cols,
    }
}

pub struct LayerNorm;

impl BallInstruction for LayerNorm {
    fn exec(xs1: u64, xs2: u64, ctx: &mut ExecContext) -> u64 {
        let enc = check_encoding(xs1, xs2);
        let x = ctx.cfgs[enc.x_bank as usize];
        let param = ctx.cfgs[enc.param_bank as usize];
        let out = ctx.cfgs[enc.out_bank as usize];
        if !x.allocated || !param.allocated || !out.allocated {
            panic!("layernorm: bank not allocated");
        }
        let lpb = lines_per_bank();
        let need = enc.rows * enc.cols / LANES_PER_LINE;
        if need > (x.cols as usize) * lpb || need > (out.cols as usize) * lpb {
            panic!(
                "layernorm: x/out region capacity exceeded rows*cols/4={need} lines"
            );
        }
        if x.cols != out.cols {
            panic!(
                "layernorm: x/out cols mismatch x_cols={} out_cols={}",
                x.cols, out.cols
            );
        }
        if enc.cols / 2 > (param.cols as usize) * lpb {
            panic!("layernorm: param region capacity exceeded cols/2 lines");
        }

        let rows = enc.rows;
        let cols = enc.cols;
        let row_lines = cols / LANES_PER_LINE;
        let mut row = vec![0f64; cols];
        let mut out_row = vec![0f32; cols];
        for r in 0..rows {
            for e in 0..cols {
                let l = r * row_lines + e / LANES_PER_LINE;
                let g = (l / lpb) as u64;
                let p = pbank_group(ctx.bank_map, enc.x_bank, g);
                let off = (l % lpb) * 16 + (e % LANES_PER_LINE) * 4;
                row[e] =
                    f32::from_le_bytes(ctx.banks[p][off..off + 4].try_into().unwrap()) as f64;
            }
            let count = cols as f64;
            let mean: f64 = row.iter().sum::<f64>() / count;
            let var: f64 = row
                .iter()
                .map(|&v| {
                    let d = v - mean;
                    d * d
                })
                .sum::<f64>()
                / count;
            let scale: f64 = 1.0 / (var + LN_EPS).sqrt();
            for e in 0..cols {
                let lane = (e % LANES_PER_LINE) * 4;
                let gl = e / LANES_PER_LINE;
                let gp = pbank_group(ctx.bank_map, enc.param_bank, (gl / lpb) as u64);
                let goff = (gl % lpb) * 16 + lane;
                let gamma = f32::from_le_bytes(ctx.banks[gp][goff..goff + 4].try_into().unwrap())
                    as f64;
                let bl = row_lines + e / LANES_PER_LINE;
                let bp = pbank_group(ctx.bank_map, enc.param_bank, (bl / lpb) as u64);
                let boff = (bl % lpb) * 16 + lane;
                let beta = f32::from_le_bytes(ctx.banks[bp][boff..boff + 4].try_into().unwrap())
                    as f64;
                out_row[e] = (((row[e] - mean) * scale) * gamma + beta) as f32;
            }
            for e in 0..cols {
                let l = r * row_lines + e / LANES_PER_LINE;
                let g = (l / lpb) as u64;
                let p = pbank_group(ctx.bank_map, enc.out_bank, g);
                let off = (l % lpb) * 16 + (e % LANES_PER_LINE) * 4;
                ctx.banks[p][off..off + 4].copy_from_slice(&out_row[e].to_le_bytes());
            }
        }
        0
    }

    fn latency(xs1: u64, xs2: u64) -> u64 {
        let enc = check_encoding(xs1, xs2);
        let lines = (enc.rows * enc.cols / LANES_PER_LINE) as u64;
        lines.saturating_mul(12).max(1)
    }
}
