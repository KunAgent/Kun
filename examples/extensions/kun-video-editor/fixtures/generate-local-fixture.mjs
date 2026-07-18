import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_SAMPLE_RATE = 8_000
export const FIXTURE_DURATION_SECONDS = 2
export const FIXTURE_WAV_SHA256 = '1a9fbec88c2121c1c146a751274f2dc3aeaaa18c6a0b40dbcec08a815deb92ce'

export function buildFixtureWav() {
  const sampleCount = FIXTURE_SAMPLE_RATE * FIXTURE_DURATION_SECONDS
  const bytesPerSample = 2
  const dataBytes = sampleCount * bytesPerSample
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(FIXTURE_SAMPLE_RATE, 24)
  wav.writeUInt32LE(FIXTURE_SAMPLE_RATE * bytesPerSample, 28)
  wav.writeUInt16LE(bytesPerSample, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)

  // An integer-only 100 Hz triangle wave keeps output byte-identical across
  // platforms and JavaScript engines. Silence at both ends gives edit fixtures
  // explicit non-speech ranges without requiring FFmpeg or ASR.
  for (let index = 0; index < sampleCount; index += 1) {
    const active = index >= 800 && index < sampleCount - 800
    const phase = index % 80
    const triangle = phase < 40 ? phase : 80 - phase
    const sample = active ? (triangle - 20) * 900 : 0
    wav.writeInt16LE(sample, 44 + index * bytesPerSample)
  }
  return wav
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function validateFixtureWav(bytes = buildFixtureWav()) {
  if (bytes.length !== 32_044) throw new Error(`Unexpected WAV byte length: ${bytes.length}`)
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('Missing RIFF header')
  if (bytes.subarray(8, 12).toString('ascii') !== 'WAVE') throw new Error('Missing WAVE header')
  if (bytes.readUInt32LE(24) !== FIXTURE_SAMPLE_RATE) throw new Error('Unexpected sample rate')
  if (bytes.readUInt16LE(22) !== 1) throw new Error('Fixture must remain mono')
  const digest = sha256(bytes)
  if (digest !== FIXTURE_WAV_SHA256) {
    throw new Error(`Deterministic WAV digest changed: ${digest}`)
  }
  return { byteLength: bytes.length, sha256: digest }
}

async function main(args) {
  const wav = buildFixtureWav()
  const checked = validateFixtureWav(wav)
  if (args.includes('--check')) {
    process.stdout.write(`Kun video fixture OK: ${checked.byteLength} bytes, sha256 ${checked.sha256}\n`)
    return
  }

  const outputIndex = args.indexOf('--output')
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
  if (!output || output.startsWith('-')) {
    throw new Error('Usage: npm run fixture:generate -- --output <directory>')
  }
  const directory = resolve(output)
  await mkdir(directory, { recursive: true })
  const here = fileURLToPath(new URL('.', import.meta.url))
  await Promise.all([
    writeFile(resolve(directory, 'talking-head.wav'), wav),
    writeFile(resolve(directory, 'talking-head.srt'), await readFile(resolve(here, 'talking-head.srt'))),
    writeFile(resolve(directory, 'talking-head.vtt'), await readFile(resolve(here, 'talking-head.vtt'))),
    writeFile(resolve(directory, 'talking-head.json'), await readFile(resolve(here, 'talking-head.json')))
  ])
  process.stdout.write(`Wrote deterministic local fixtures to ${directory}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
