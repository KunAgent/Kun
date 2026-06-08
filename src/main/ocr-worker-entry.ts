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
 */

const Tesseract = require('tesseract.js')
const { recognize } = Tesseract
const { readFile } = require('node:fs/promises')
const { extname } = require('node:path')

type WorkerRequest = {
  id: string
  filePath: string
  language: string
  workerPath?: string
  corePath?: string
  langPath?: string
}

async function main(): Promise<void> {
  // Read request from command-line arg (avoids IPC structuredClone issues)
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

  try {
    const buf = await readFile(req.filePath)
    const ext = extname(req.filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.tiff' || ext === '.tif' ? 'image/tiff'
      : ext === '.bmp' ? 'image/bmp'
      : ext === '.webp' ? 'image/webp'
      : 'image/png'

    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`

    const opts: Record<string, unknown> = {}
    if (req.workerPath) opts.workerPath = req.workerPath
    if (req.corePath) opts.corePath = req.corePath
    if (req.langPath) opts.langPath = req.langPath

    const result = await recognize(dataUrl, req.language, opts, {
      text: true,
      blocks: true,
      hocr: false,
      tsv: false
    })

    // Write result to stdout as JSON, then exit cleanly
    const response = { id: req.id, ok: true, data: result.data }
    process.stdout.write(JSON.stringify(response))
    process.exit(0)
  } catch (err) {
    const response = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
    process.stdout.write(JSON.stringify(response))
    process.exit(0)
  }
}

main().catch((err) => {
  process.stderr.write(`ocr-worker-entry: unhandled: ${err}\n`)
  process.exit(1)
})
