'use strict'
const { readFileSync, statSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

/** Check the real unpacked dependency closure, not Electron's virtual ASAR view. */
function checkKokoroWorker(entry) {
  const visited = new Set()
  function visit(file) {
    if (visited.has(file)) return
    if (!statSync(file).isFile()) throw new Error(`Kokoro worker dependency is not a file: ${file}`)
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
      visit(resolve(dirname(file), match[1]))
    }
  }
  visit(resolve(entry))
  return [...visited]
}
module.exports = { checkKokoroWorker }
if (require.main === module) {
  const files = checkKokoroWorker(process.argv[2] || 'out/main/local-kokoro-worker-entry.js')
  console.log(`[kokoro-worker] Verified ${files.length} worker files`)
}
