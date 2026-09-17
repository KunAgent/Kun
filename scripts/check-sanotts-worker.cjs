'use strict'
const { readFileSync, statSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

/** Check the real unpacked dependency closure, not Electron's virtual ASAR view. */
function checkSanottsWorker(entry) {
  const visited = new Set()
  function visit(file) {
    if (visited.has(file)) return
    if (!statSync(file).isFile()) throw new Error(`sanoTTS worker dependency is not a file: ${file}`)
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
      visit(resolve(dirname(file), match[1]))
    }
  }
  visit(resolve(entry))
  return [...visited]
}
module.exports = { checkSanottsWorker }
if (require.main === module) {
  const files = checkSanottsWorker(process.argv[2] || 'out/main/local-sanotts-worker-entry.js')
  console.log(`[sanotts-worker] Verified ${files.length} worker files`)
}
