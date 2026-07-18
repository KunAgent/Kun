import { engineError } from './errors.js'
import type { Rational } from './schema.js'

const MICROSECONDS_PER_SECOND = 1_000_000n

export function normalizeRational(value: Rational): Rational {
  if (
    !Number.isSafeInteger(value.numerator) ||
    !Number.isSafeInteger(value.denominator) ||
    value.numerator <= 0 ||
    value.denominator <= 0
  ) {
    throw engineError('invalid_project', 'A frame rate must contain positive safe integers')
  }
  const divisor = gcd(value.numerator, value.denominator)
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor
  }
}

export function rationalEquals(left: Rational, right: Rational): boolean {
  const a = normalizeRational(left)
  const b = normalizeRational(right)
  return a.numerator === b.numerator && a.denominator === b.denominator
}

export function framesToMicroseconds(frames: number, fps: Rational): number {
  assertNonNegativeSafeInteger(frames, 'frames')
  const rate = normalizeRational(fps)
  const numerator = BigInt(frames) * BigInt(rate.denominator) * MICROSECONDS_PER_SECOND
  return toSafeNumber(divideRounded(numerator, BigInt(rate.numerator)), 'microseconds')
}

export function microsecondsToFrames(
  microseconds: number,
  fps: Rational,
  mode: 'floor' | 'nearest' | 'ceil' = 'nearest'
): number {
  assertNonNegativeSafeInteger(microseconds, 'microseconds')
  const rate = normalizeRational(fps)
  const numerator = BigInt(microseconds) * BigInt(rate.numerator)
  const denominator = BigInt(rate.denominator) * MICROSECONDS_PER_SECOND
  const frames = mode === 'floor'
    ? numerator / denominator
    : mode === 'ceil'
      ? (numerator + denominator - 1n) / denominator
      : divideRounded(numerator, denominator)
  return toSafeNumber(frames, 'frames')
}

export function rescaleFrames(
  frames: number,
  sourceFps: Rational,
  targetFps: Rational,
  mode: 'floor' | 'nearest' | 'ceil' = 'nearest'
): number {
  return microsecondsToFrames(framesToMicroseconds(frames, sourceFps), targetFps, mode)
}

export function frameToSecondsArgument(frame: number, fps: Rational): string {
  assertNonNegativeSafeInteger(frame, 'frame')
  const rate = normalizeRational(fps)
  return `${frame * rate.denominator}/${rate.numerator}`
}

export function microsecondsToSecondsArgument(microseconds: number): string {
  assertNonNegativeSafeInteger(microseconds, 'microseconds')
  const whole = Math.floor(microseconds / 1_000_000)
  const remainder = String(microseconds % 1_000_000).padStart(6, '0')
  return `${whole}.${remainder}`
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator
}

function gcd(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw engineError('invalid_project', `${label} must be a non-negative safe integer`, {
      [label]: value
    })
  }
}

function toSafeNumber(value: bigint, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) {
    throw engineError('invalid_project', `${label} exceeds the supported integer range`)
  }
  return result
}
