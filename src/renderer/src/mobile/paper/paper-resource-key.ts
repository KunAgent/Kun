import { workFileResourceKey } from '../work/work-resource-key'

/** Paper URLs carry an opaque per-library key, never a host path or unit directory. */
export function paperResourceKey(libraryRoot: string, unitDir: string): string {
  return `p-${workFileResourceKey(libraryRoot, unitDir).slice(2)}`
}
