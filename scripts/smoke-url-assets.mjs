import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// esbuild does not implement Vite's ?url imports. Preserve their asset semantics:
// emit the original bytes and export the emitted path, never evaluate the asset.
export function smokeUrlAssets() {
  return {
    name: 'smoke-url-assets',
    setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, async (args) => {
        const resolved = await builder.resolve(args.path.slice(0, -4), {
          importer: args.importer, resolveDir: args.resolveDir, kind: args.kind
        })
        if (resolved.errors.length) return { errors: resolved.errors }
        return { path: resolved.path, namespace: 'smoke-url-asset' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'smoke-url-asset' }, async (args) => ({
        contents: await readFile(args.path), loader: 'file'
      }))
    }
  }
}

export async function writeSmokeAssets(outputFiles) {
  for (const file of outputFiles) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents)
  }
}
