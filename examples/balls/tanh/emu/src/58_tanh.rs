//===- 58_tanh.rs - TANH instruction (exact fp32 tanh) ---------------------===//
//
// y = tanh(x), the exact form (reference: torch.tanh, never a rational or
// piecewise-linear approximation). fp32 in / fp32 out, odd symmetric.
//
// rs1[9:0]:    in_bank  (BANK0, fp32 input bank, single group)
// rs1[19:10]:  reserved (BANK1), must be zero
// rs1[29:20]:  out_bank (BANK2, fp32 output bank, single group, distinct)
// rs1[63:30]:  n        (BB_ITER, fp32 element count)
// xs2:         reserved, must be zero
//
// A bank row is 16 bytes = 4 fp32 lanes (toy bank_width = 128). The ball
// reads input rows 0..n/4-1 and writes tanh() of every lane to the same
// row/lane position of the separate output bank (dense packing, in-place
// never happens).
//
// The golden value is evaluated in IEEE double with a 9-term Taylor exp and
// an exact 2^k bit-scaling path (no libm anywhere), in the same operation
// sequence as `tanh_ref()` in workloads/ctests/: with e = exp(-2|x|) (odd
// magnitude a = |x| clamped to 100), tanh(x) = sign(x) * (1 - e) / (1 + e).
// The ctests compare with |got - expected| <= 1e-4f, which bounds the RTL
// contract.
//
// Fail-hard table (identical in ctest expectations, this model, and RTL):
//   xs2 != 0 or rs1.BANK1 != 0  -> reserved field must be zero
//   n == 0                       -> N must be positive
//   n % 4 != 0                   -> N must be a multiple of the 16B row
//   n > 4 * bank lines           -> N exceeds bank capacity
//   bank id >= bank_num          -> invalid bank id
//   bank unallocated or cols > 1 -> not a single-group allocated bank
//   in_bank == out_bank          -> in/out banks must be distinct
// An undeclared funct7 never reaches this file: lib.rs dispatches by the
// core ballISA mnemonic and the chain-end unwrap_or_else panics otherwise.
//===---------------------------------------------------------------------===//

use super::super::bank::{bank_lines, bank_num};
use super::decode::{pbank, rs1_b0, rs1_b1, rs1_b2, rs1_iter};
use super::instruction::{BallInstruction, ExecContext};

pub struct Tanh;

/// exp(y) for y in [-200, 0], pure bit arithmetic (no libm, FMA-free): a
/// 9-term Taylor series in the range-reduced mantissa times an exact 2^k
/// exponent add. Term-for-term identical to `tanh_exp_neg()` in
/// workloads/ctests/tanh_test.c and to the model in /tmp validation.
fn exp_neg(y: f64) -> f64 {
    let k = (y * 1.4426950408889634 - 0.5) as i32;
    let f = y - (k as f64) * 0.6931471805599453;
    let e = 1.0
        + f * (1.0
            + f * (0.5 + f * (1.0 / 6.0 + f * (1.0 / 24.0 + f * (1.0 / 120.0 + f * (1.0 / 720.0 + f * (1.0 / 5040.0 + f * (1.0 / 40320.0))))))));
    f64::from_bits(e.to_bits().wrapping_add((k as u64) << 52))
}

fn tanh_gold(x: f32) -> f32 {
    let xd = f64::from(x);
    let a = if xd < 0.0 { -xd } else { xd };
    // exp(-2a) saturates the fp32 result: a >= 9.0104 already rounds to
    // exactly 1.0 in fp32; clamping at 100 (e <= 1.4e-87, still a normal
    // double) leaves every affected output at bit-exact +-1.0.
    let a = if a > 100.0 { 100.0 } else { a };
    let e = exp_neg(-2.0 * a);
    let y = (1.0 - e) / (1.0 + e);
    if xd >= 0.0 {
        y as f32
    } else {
        -y as f32
    }
}

/// Shared encoding validation for exec() and latency(): every violation
/// panics with the same messages the ctest documents.
fn decode_validate(xs1: u64, xs2: u64) -> (usize, usize, usize) {
    if xs2 != 0 {
        panic!("tanh: reserved xs2 must be zero, got {xs2}");
    }
    if rs1_b1(xs1) != 0 {
        panic!("tanh: reserved rs1 BANK1 field must be zero");
    }
    let n = rs1_iter(xs1);
    if n == 0 {
        panic!("tanh: N must be positive");
    }
    if n % 4 != 0 {
        panic!("tanh: N must be a multiple of 4 (16B bank row), got {n}");
    }
    if n / 4 > bank_lines() as u64 {
        panic!("tanh: N = {n} exceeds bank capacity (4 * {} lines)", bank_lines());
    }
    let in_bank = rs1_b0(xs1);
    let out_bank = rs1_b2(xs1);
    if in_bank >= bank_num() as u64 {
        panic!("tanh: invalid in_bank id {in_bank}");
    }
    if out_bank >= bank_num() as u64 {
        panic!("tanh: invalid out_bank id {out_bank}");
    }
    if in_bank == out_bank {
        panic!("tanh: in_bank and out_bank must be distinct, both {in_bank}");
    }
    (in_bank as usize, out_bank as usize, (n / 4) as usize)
}

impl BallInstruction for Tanh {
    fn exec(xs1: u64, xs2: u64, ctx: &mut ExecContext) -> u64 {
        let (in_bank, out_bank, rows) = decode_validate(xs1, xs2);
        for bank in [in_bank, out_bank] {
            let config = ctx.cfgs[bank];
            if !config.allocated {
                panic!("tanh: bank {bank} not allocated");
            }
            if config.cols != 1 {
                panic!("tanh: bank {bank} must be a single-group bank, cols = {}", config.cols);
            }
        }
        let in_pbank = pbank(ctx.bank_map, in_bank as u64);
        let out_pbank = pbank(ctx.bank_map, out_bank as u64);
        let (read, write) = ctx.banks.read_write(in_pbank, out_pbank);
        for row in 0..rows {
            let base = row * 16;
            for lane in 0..4 {
                let off = base + lane * 4;
                let x = f32::from_le_bytes(read[off..off + 4].try_into().unwrap());
                write[off..off + 4].copy_from_slice(&tanh_gold(x).to_le_bytes());
            }
        }
        0
    }

    fn latency(xs1: u64, xs2: u64) -> u64 {
        let (_in_bank, _out_bank, rows) = decode_validate(xs1, xs2);
        // One cycle per fp32 element (N total): a safe estimate for the RTL
        // streaming read -> compute -> write FSM, which handles the 4 lanes
        // of a 16B row together every few cycles. bemu only uses this value
        // for timing, never for results.
        (rows * 4) as u64
    }
}
