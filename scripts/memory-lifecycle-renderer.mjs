import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// Use the same component bundle in the native smoke and its fast build regression.
export function buildMemoryLifecycleRenderer(outdir) {
  return build({ entryPoints: [join(root, 'scripts/fixtures/memory-lifecycle.tsx')], bundle: true,
    format: 'esm', platform: 'browser', jsx: 'automatic', write: false, outdir,
    assetNames: 'assets/[name]-[hash]',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    alias: { '@shared': join(root, 'src/shared') },
    plugins: [{ name: 'synthetic-memory-transport', setup(builder) {
      // Bare esbuild does not implement Vite's ?url contract. Keep the real
      // dependency as a local asset instead of importing it as JavaScript.
      builder.onResolve({ filter: /\?url$/ }, ({ path, resolveDir }) => ({
        path: require.resolve(path.slice(0, -4), { paths: [resolveDir] }), namespace: 'asset-url'
      }))
      builder.onLoad({ filter: /.*/, namespace: 'asset-url' }, async ({ path }) => ({
        contents: await readFile(path), loader: 'file'
      }))
      builder.onLoad({ filter: /agent[\\/]registry\.ts$/ }, () => ({ contents: `export const getProvider = () => ({
        listMemories: async ({workspace}) => (await window.memoryFixture.api('/v1/memory?workspace='+encodeURIComponent(workspace))).memories,
        updateMemory: async (id,patch,access) => (await window.memoryFixture.api('/v1/memory/'+encodeURIComponent(id)+'?project='+encodeURIComponent(access.project), 'PATCH', patch)).memory
      });`, loader: 'js' }))
      builder.onLoad({ filter: /rooms[\\/]useRoomEvents\.ts$/ }, () => ({ contents: `
        export const roomEventsLive = () => true;
        export const acknowledgeRoomAttention = () => {};
        export const useRoomAttentionCount = () => 0;
        export const useRoomEvents = () => ({});
        export function subscribeRoomEvents(listener) {
          const handler = () => listener({kind:'agent.memory.updated'});
          window.addEventListener('memory-fixture-change', handler);
          return () => window.removeEventListener('memory-fixture-change', handler);
        }`, loader: 'js' }))
    } }]
  })
}
