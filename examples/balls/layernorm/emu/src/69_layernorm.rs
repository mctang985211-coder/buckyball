//===- 69_layernorm.rs - LAYERNORM instruction (row-wise LN, fp32) ---------===//
//
// Row-wise layer normalization over a dense row-major block of R x C fp32
// held in SRAM banks (reference: torch.nn.LayerNorm(C, eps=1e-12), biased
// variance, two-step mean-subtracted form):
//   mu  = mean(row)
//   var = sum((x - mu)^2) / C
//   rstd = 1/sqrt(var + 1e-12)
//   y[j] = (x[j] - mu) * rstd * gamma[j] + beta[j]
//
// rs1[9:0]:    x_bank     (BANK0, fp32 input bank, single group)
// rs1[19:10]:  param_bank (BANK1, gamma||beta bank, single group)
// rs1[29:20]:  out_bank   (BANK2, fp32 output bank, single group, distinct)
// rs1[63:30]:  n          (BB_ITER, fp32 element count = R * C)
// xs2[31:0]:   c          (columns per row = normalization width)
// xs2[63:32]:  reserved, must be zero
//
// A bank row is 16 bytes = 4 fp32 lanes (toy bank_width = 128). The block
// is dense row-major: row r starts at byte r*C*4, and C is a multiple of 4
// so every row is 16B-aligned. gamma occupies param elems [0, C), beta
// elems [C, 2C); every x row shares gamma[j]/beta[j] of its column j.
//
// The golden value is evaluated in IEEE double in the same operation
// sequence as `ln_row()` in workloads/ctests/: mu and the biased variance
// are accumulated over the row, rstd uses f64::sqrt (no libm anywhere),
// and y is cast back to f32. The ctests compare with
// |got - expected| <= 1e-4 * (1 + |expected|), which bounds the RTL
// contract (the rstd scale term needs the relative component).
//
// Fail-hard table (identical in ctest expectations, this model, and RTL):
//   xs2[63:32] != 0              -> reserved field must be zero
//   n == 0                       -> N must be positive
//   c == 0                       -> C must be positive
//   c % 4 != 0                   -> C must be a multiple of the 16B row
//   n % c != 0                   -> N must be whole rows of C
//   c > 2 * bank lines           -> 2C gamma+beta exceed param bank
//   n / 4 > bank lines           -> N exceeds x bank capacity
//   bank id >= bank_num          -> invalid bank id
//   bank unallocated or cols > 1 -> not a single-group allocated bank
//   x/param/out banks collide    -> pairwise distinct banks, in-place never
// An undeclared funct7 never reaches this file: lib.rs dispatches by the
// core ballISA mnemonic and the chain-end unwrap_or_else panics otherwise.
//===---------------------------------------------------------------------===//

use super::super::bank::{bank_lines, bank_num};
use super::decode::{pbank, rs1_b0, rs1_b1, rs1_b2, rs1_iter};
use super::instruction::{BallInstruction, ExecContext};

pub struct LayerNorm;

/// 1e-12, fixed in the op semantics (fp32 graph value 9.99999996E-13 differs
/// by < 1e-13, far below tolerance; the golden always uses double 1e-12).
const EPS: f64 = 1e-12;

/// Shared encoding validation for exec() and latency(): every violation
/// panics with the same messages the ctest documents.
fn decode_validate(xs1: u64, xs2: u64) -> (u64, u64, u64, u64, u64) {
    if xs2 >> 32 != 0 {
        panic!("layernorm: reserved xs2[63:32] must be zero, got {}", xs2 >> 32);
    }
    let c = xs2 & 0xffff_ffff;
    let n = rs1_iter(xs1);
    if n == 0 {
        panic!("layernorm: N must be positive");
    }
    if c == 0 {
        panic!("layernorm: C must be positive");
    }
    if c % 4 != 0 {
        panic!("layernorm: C must be a multiple of 4 (16B bank row), got {c}");
    }
    if n % c != 0 {
        panic!("layernorm: N = {n} must be a multiple of C = {c} (whole rows)");
    }
    if c > 2 * bank_lines() as u64 {
        panic!("layernorm: C = {c} exceeds 2 * {} lines (2C gamma+beta bank capacity)", bank_lines());
    }
    if n / 4 > bank_lines() as u64 {
        panic!("layernorm: N = {n} exceeds bank capacity (4 * {} lines)", bank_lines());
    }
    let x_bank = rs1_b0(xs1);
    let param_bank = rs1_b1(xs1);
    let out_bank = rs1_b2(xs1);
    for (name, bank) in [("x_bank", x_bank), ("param_bank", param_bank), ("out_bank", out_bank)] {
        if bank >= bank_num() as u64 {
            panic!("layernorm: invalid {name} id {bank}");
        }
    }
    if x_bank == param_bank || x_bank == out_bank || param_bank == out_bank {
        panic!("layernorm: x_bank/param_bank/out_bank must be pairwise distinct, got {x_bank}/{param_bank}/{out_bank}");
    }
    (x_bank, param_bank, out_bank, n, c)
}

impl BallInstruction for LayerNorm {
    fn exec(xs1: u64, xs2: u64, ctx: &mut ExecContext) -> u64 {
        let (x_bank, param_bank, out_bank, n, c) = decode_validate(xs1, xs2);
        for bank in [x_bank, param_bank, out_bank] {
            let config = ctx.cfgs[bank as usize];
            if !config.allocated {
                panic!("layernorm: bank {bank} not allocated");
            }
            if config.cols != 1 {
                panic!("layernorm: bank {bank} must be a single-group bank, cols = {}", config.cols);
            }
        }
        let x_pbank = pbank(ctx.bank_map, x_bank);
        let param_pbank = pbank(ctx.bank_map, param_bank);
        let out_pbank = pbank(ctx.bank_map, out_bank);
        let rows = n / c;
        let c_usize = c as usize;
        for r in 0..rows {
            let row_off = (r * c * 4) as usize;
            // Pass A (two scans): mu, then the biased variance of (x - mu).
            let mut sum = 0.0f64;
            for j in 0..c_usize {
                let off = row_off + j * 4;
                let xj = f32::from_le_bytes(ctx.banks[x_pbank][off..off + 4].try_into().unwrap());
                sum += f64::from(xj);
            }
            let mu = sum / c as f64;
            let mut ss = 0.0f64;
            for j in 0..c_usize {
                let off = row_off + j * 4;
                let xj = f32::from_le_bytes(ctx.banks[x_pbank][off..off + 4].try_into().unwrap());
                let d = f64::from(xj) - mu;
                ss += d * d;
            }
            let rstd = 1.0 / (ss / c as f64 + EPS).sqrt();
            // Pass B: y[j] = (x[j] - mu) * rstd * gamma[j] + beta[j].
            for j in 0..c_usize {
                let off = row_off + j * 4;
                let xj = f64::from(f32::from_le_bytes(
                    ctx.banks[x_pbank][off..off + 4].try_into().unwrap(),
                ));
                let gj = f64::from(f32::from_le_bytes(
                    ctx.banks[param_pbank][j * 4..j * 4 + 4].try_into().unwrap(),
                ));
                let bj = f64::from(f32::from_le_bytes(
                    ctx.banks[param_pbank][(c_usize + j) * 4..(c_usize + j) * 4 + 4]
                        .try_into()
                        .unwrap(),
                ));
                let y = ((xj - mu) * rstd) * gj + bj;
                ctx.banks[out_pbank][off..off + 4]
                    .copy_from_slice(&(y as f32).to_le_bytes());
            }
        }
        0
    }

    fn latency(xs1: u64, xs2: u64) -> u64 {
        let (_x_bank, _param_bank, _out_bank, n, c) = decode_validate(xs1, xs2);
        let rows = n / c;
        // Element-step estimate for the streaming RTL FSM: three x scans per
        // row (mean, variance, normalize) plus gamma/beta and the y write.
        // bemu only uses this value for timing, never for results.
        3 * n + 2 * n + rows * c
    }
}
