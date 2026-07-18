'use strict'

const { isAbsolute, join } = require('node:path')

function developmentRendererEnvironment(environment, options) {
  const rendererPort = options?.rendererPort
  const temporaryRoot = options?.temporaryRoot
  if (!Number.isSafeInteger(rendererPort) || rendererPort <= 0 || rendererPort > 65_535) {
    throw new Error('rendererPort must select a valid development renderer port')
  }
  if (typeof temporaryRoot !== 'string' || !isAbsolute(temporaryRoot)) {
    throw new Error('temporaryRoot must be an absolute path')
  }
  return {
    ...environment,
    ELECTRON_RENDERER_URL: `http://127.0.0.1:${rendererPort}`,
    KUN_ELECTRON_VITE_PORT: String(rendererPort),
    KUN_ELECTRON_VITE_CACHE_DIR: join(temporaryRoot, 'vite-cache')
  }
}

module.exports = {
  developmentRendererEnvironment
}
