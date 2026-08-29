import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolve the stable out/main root from either the entry or a split chunk. */
export function mainBundleDirectory(moduleUrl: string): string {
  const directory = dirname(fileURLToPath(moduleUrl))
  return basename(directory) === 'chunks' ? dirname(directory) : directory
}
