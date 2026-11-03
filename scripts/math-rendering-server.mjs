import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build, preview } from 'vite'
import { mathRenderingFixture } from './math-rendering-ui-fixture.mjs'

// Build before opening the browser: on-demand dev dependency discovery can
// replace shared optimized chunks while Electron is still requesting them.
// A preview serves immutable production assets, with no optimizer or HMR reloads.
export async function createMathRenderingServer(repository, temporary) {
  await writeFile(join(temporary, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>')
  await writeFile(join(temporary, 'fixture.tsx'), mathRenderingFixture())
  const config = {
    configFile: false,
    root: temporary,
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    css: { postcss: repository },
    resolve: { alias: {
      '/src': resolve(repository, 'src'),
      '@renderer': resolve(repository, 'src/renderer/src'),
      '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts')
    } },
    build: { outDir: join(temporary, 'dist'), emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0 }
  }
  await build(config)
  return preview(config)
}
