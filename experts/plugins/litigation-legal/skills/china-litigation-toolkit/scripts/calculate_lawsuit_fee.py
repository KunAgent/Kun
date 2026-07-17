#!/usr/bin/env python3
import sys

def calc(amount: float) -> float:
    if amount <= 10000:
        return 50.0
    if amount <= 100000:
        return amount * 0.025 - 200
    if amount <= 200000:
        return amount * 0.02 + 300
    if amount <= 500000:
        return amount * 0.015 + 1300
    if amount <= 1000000:
        return amount * 0.01 + 3800
    if amount <= 2000000:
        return amount * 0.009 + 4800
    if amount <= 5000000:
        return amount * 0.008 + 6800
    if amount <= 10000000:
        return amount * 0.007 + 11800
    if amount <= 20000000:
        return amount * 0.006 + 21800
    return amount * 0.005 + 41800


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: calculate_lawsuit_fee.py <claim_amount_rmb>', file=sys.stderr)
        return 2
    try:
        amount = float(sys.argv[1])
    except ValueError:
        print('Claim amount must be a number.', file=sys.stderr)
        return 2
    if amount < 0:
        print('Claim amount must be non-negative.', file=sys.stderr)
        return 2
    fee = calc(amount)
    print(f'Claim amount: {amount:.2f} RMB')
    print(f'Estimated filing fee: {fee:.2f} RMB')
    print('Note: estimate for common PRC civil property disputes only; excludes lawyer fees and other costs.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
