export const FIXTURE_SAMPLE_RATE: number
export const FIXTURE_DURATION_SECONDS: number
export const FIXTURE_WAV_SHA256: string

export function buildFixtureWav(): Buffer
export function sha256(bytes: Uint8Array): string
export function validateFixtureWav(bytes?: Buffer): {
  byteLength: number
  sha256: string
}
