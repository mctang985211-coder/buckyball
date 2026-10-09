use super::super::bank::{bank_lines, bank_num, bank_row_bytes};
use super::decode::{pbank, rs1_b0, rs1_b1, rs1_b2, rs1_iter};
use super::instruction::{BallInstruction, ExecContext};

pub struct Clamp;

fn decode_validate(xs1: u64, xs2: u64) -> (usize, usize, usize, i32, i32) {
    assert_eq!(bank_row_bytes(), 16, "clamp: requires 128-bit rows");
    assert_eq!(rs1_b1(xs1), 0, "clamp: reserved BANK1 must be zero");
    let n = rs1_iter(xs1);
    assert!(n > 0, "clamp: N must be positive");
    assert_eq!(n % 4, 0, "clamp: N must be a multiple of 4");
    assert!(n / 4 <= bank_lines() as u64, "clamp: N exceeds bank capacity");
    let input = rs1_b0(xs1);
    let output = rs1_b2(xs1);
    assert!(input < bank_num() as u64, "clamp: input bank out of range");
    assert!(output < bank_num() as u64, "clamp: output bank out of range");
    assert_ne!(input, output, "clamp: banks must be distinct");
    let lo = xs2 as u32 as i32;
    let hi = (xs2 >> 32) as u32 as i32;
    assert!(lo <= hi, "clamp: lo must not exceed hi");
    (input as usize, output as usize, (n / 4) as usize, lo, hi)
}

impl BallInstruction for Clamp {
    fn exec(xs1: u64, xs2: u64, ctx: &mut ExecContext) -> u64 {
        let (input, output, rows, lo, hi) = decode_validate(xs1, xs2);
        for bank in [input, output] {
            assert!(ctx.cfgs[bank].allocated, "clamp: bank {bank} not allocated");
            assert_eq!(ctx.cfgs[bank].cols, 1, "clamp: bank {bank} must be single group");
        }
        let input = pbank(ctx.bank_map, input as u64);
        let output = pbank(ctx.bank_map, output as u64);
        assert_ne!(input, output, "clamp: physical bank alias");
        let (read, write) = ctx.banks.read_write(input, output);
        for row in 0..rows {
            for lane in 0..4 {
                let off = row * 16 + lane * 4;
                let x = i32::from_le_bytes(read[off..off + 4].try_into().unwrap());
                let y = x.max(lo).min(hi);
                write[off..off + 4].copy_from_slice(&y.to_le_bytes());
            }
        }
        0
    }

    fn latency(xs1: u64, xs2: u64) -> u64 {
        let (_, _, rows, _, _) = decode_validate(xs1, xs2);
        // Serial read-request/read-response/write-request/write-response FSM.
        // Excludes issue and external channel stalls; timing estimate only.
        (rows * 4 + 2) as u64
    }
}
