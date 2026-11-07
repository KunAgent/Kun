const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
// Sandboxed Electron preloads cannot resolve arbitrary local CommonJS chunks.
for (const name of ['remote-desktop-capture', 'remote-desktop-indicator', 'remote-desktop-viewer', 'control-viewer-probe']) {
  const source = readFileSync(resolve(__dirname, '../out/preload', name + '.cjs'), 'utf8')
  const required = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1])
  if (required.some(name => name !== 'electron')) throw Error('Remote desktop sandbox preload is not self-contained: ' + name)
}
console.log('Remote desktop sandbox preloads are self-contained.')
