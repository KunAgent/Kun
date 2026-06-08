/**
 * One-shot OCR worker process.
 *
 * Spawned via child_process.fork() for EACH OCR request.
 * Reads the request from argv (JSON), runs tesseract.js, writes the
 * result to stdout, and exits. This avoids long-lived worker_threads
 * instability in Electron's ASAR environment.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 node ocr-worker-entry.js '<json-request>'
 *
 * Preload mode (download language data without OCR):
 *   ELECTRON_RUN_AS_NODE=1 node ocr-worker-entry.js '{"preload":["eng","chi_sim"],...}'
 */

const Tesseract = require('tesseract.js')
const { recognize } = Tesseract
const { readFile } = require('node:fs/promises')
const { extname } = require('node:path')

type WorkerRequest = {
  id: string
  filePath?: string
  language?: string
  preload?: string[]
  workerPath?: string
  corePath?: string
  langPath?: string
}

// 1x1 white PNG (67 bytes) — used for preload and testing
const BLANK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg=='

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg) {
    process.stderr.write('ocr-worker-entry: no request argument provided\n')
    process.exit(1)
  }

  let req: WorkerRequest
  try {
    req = JSON.parse(arg)
  } catch (err) {
    process.stderr.write(`ocr-worker-entry: invalid JSON: ${err}\n`)
    process.exit(1)
  }

  const opts: Record<string, unknown> = {}
  if (req.workerPath) opts.workerPath = req.workerPath
  if (req.corePath) opts.corePath = req.corePath
  if (req.langPath) opts.langPath = req.langPath

  try {
    // Preload mode: download language data for the specified languages
    if (req.preload && req.preload.length > 0) {
      const dataUrl = `data:image/png;base64,${BLANK_PNG_BASE64}`
      for (const lang of req.preload) {
        try {
          await recognize(dataUrl, lang, opts, { text: true, blocks: false, hocr: false, tsv: false })
        } catch {
          // Individual language preload failure is non-fatal
        }
      }
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, data: { preloaded: req.preload } }))
      process.exit(0)
      return
    }

    // OCR mode
    if (!req.filePath) {
      process.stderr.write('ocr-worker-entry: filePath is required for OCR mode\n')
      process.exit(1)
    }

    const buf = await readFile(req.filePath)
    const ext = extname(req.filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.tiff' || ext === '.tif' ? 'image/tiff'
      : ext === '.bmp' ? 'image/bmp'
      : ext === '.webp' ? 'image/webp'
      : 'image/png'

    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    const language = req.language || 'eng'

    const result = await recognize(dataUrl, language, opts, {
      text: true,
      blocks: true,
      hocr: false,
      tsv: false
    })

    process.stdout.write(JSON.stringify({ id: req.id, ok: true, data: result.data }))
    process.exit(0)
  } catch (err) {
    process.stdout.write(JSON.stringify({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }))
    process.exit(0)
  }
}

main().catch((err) => {
  process.stderr.write(`ocr-worker-entry: unhandled: ${err}\n`)
  process.exit(1)
})
