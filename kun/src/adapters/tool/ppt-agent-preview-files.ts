import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, relative, resolve, sep } from 'node:path'
import type { PptdPreviewPage } from '../../ppt/pptd-preview-svg.js'
import { assertPptScopedExistingPath, assertPptScopedMutationPath } from './ppt-agent-physical-path.js'

/** Generated review preview names: page number plus manifest revision. */
const PREVIEW_FILE = /^p\d{2,}-r\d+\.svg$/

export function portableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

/**
 * Write one SVG per page under revision-specific names. A new name per
 * revision keeps whiteboard image caches from showing a stale page; the
 * previous revision stays on disk while older generated previews are pruned.
 */
export async function writePptPreviewSvgs(input: {
  pages: readonly PptdPreviewPage[]
  outputDir: string
  workspaceRoot: string
  revisions: readonly number[]
  keep: readonly string[]
}): Promise<string[]> {
  await assertPptScopedMutationPath({
    workspaceRoot: input.workspaceRoot,
    scopeRoot: input.outputDir,
    targetPath: input.outputDir,
    label: 'PPT preview output',
    expected: 'directory'
  })
  await mkdir(input.outputDir, { recursive: true })
  const directory = await assertPptScopedExistingPath({
    workspaceRoot: input.workspaceRoot,
    scopeRoot: input.outputDir,
    targetPath: input.outputDir,
    label: 'PPT preview output',
    expected: 'directory'
  })
  const written: string[] = []
  for (const [index, page] of input.pages.entries()) {
    // Scope checks run in the caller's (lexical) path space; writes use the proven physical path.
    const target = await assertPptScopedMutationPath({
      workspaceRoot: input.workspaceRoot,
      scopeRoot: input.outputDir,
      targetPath: resolve(input.outputDir, `p${String(index + 1).padStart(2, '0')}-r${input.revisions[index] ?? 1}.svg`),
      label: 'PPT rendered preview',
      expected: 'file'
    })
    await writeFile(target.physicalPath, page.svg, 'utf8')
    written.push(target.physicalPath)
  }
  const keep = new Set([...written, ...input.keep].map((path) => basename(path)))
  for (const entry of await readdir(directory.physicalPath, { withFileTypes: true })) {
    if (entry.isFile() && PREVIEW_FILE.test(entry.name) && !keep.has(entry.name)) {
      await rm(resolve(directory.physicalPath, entry.name), { force: true })
    }
  }
  return written
}
