import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'

const root = dirname(fileURLToPath(import.meta.url))
const appSource = resolve(root, 'src/tui/app')
const srcRoot = resolve(root, 'src')
const distRoot = resolve(root, 'dist')
const appDist = resolve(distRoot, 'tui/app')

// Node resolves solid-js to its server build. The terminal renderer needs the
// reactive client runtime, which @opentui/solid itself imports by path.
const SOLID_CLIENT: Record<string, string> = {
  'solid-js': 'solid-js/dist/solid.js',
  'solid-js/store': 'solid-js/store/dist/store.js'
}

/**
 * Only the JSX application under src/tui/app is bundled here. Everything it
 * imports from the rest of Kun stays an external import of the tsc output, so
 * the renderer-neutral controller, client and contracts exist exactly once at
 * runtime and keep their module identity (instanceof checks, singletons).
 */
function kunExternals(): Plugin {
  return {
    name: 'kun-tui-externals',
    enforce: 'pre',
    resolveId(source, importer) {
      if (SOLID_CLIENT[source]) return { id: SOLID_CLIENT[source]!, external: true }
      if (!importer || source.startsWith('\0')) return null
      if (!source.startsWith('.')) {
        return source.startsWith('/') ? null : { id: source, external: true }
      }
      const target = resolve(dirname(importer), source)
      if (target === appSource || target.startsWith(`${appSource}${sep}`)) return null
      if (!target.startsWith(`${srcRoot}${sep}`)) return null
      const compiled = resolve(distRoot, relative(srcRoot, target)).replace(/\.tsx?$/u, '.js')
      let specifier = relative(appDist, compiled).split(sep).join('/')
      if (!specifier.startsWith('.')) specifier = `./${specifier}`
      return { id: specifier, external: true }
    }
  }
}

export default defineConfig({
  root,
  logLevel: 'warn',
  plugins: [
    kunExternals(),
    solid({ solid: { generate: 'universal', moduleName: '@opentui/solid' } })
  ],
  build: {
    ssr: resolve(appSource, 'main.tsx'),
    target: 'node22',
    outDir: appDist,
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        format: 'esm',
        entryFileNames: 'main.js'
      }
    }
  }
})
