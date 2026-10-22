import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { renderPptdPreviewDeck } from '../../ppt/pptd-preview-svg.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { assertPptScopedExistingPath, assertPptScopedMutationPath } from './ppt-agent-physical-path.js'
import { portableRelative } from './ppt-agent-preview-files.js'

/** Direction candidates are judged on three sample pages, always in this order. */
export const PPT_DIRECTION_SAMPLE_ROLES = ['cover', 'representative', 'complex'] as const

/** Child-authored sample decks live here, beside (not inside) the main deck manifest. */
export const PPT_DIRECTION_SAMPLE_DIR = 'directions'
/** Host-rendered sample previews; the integrity check accepts files only from here or legacy .kun/images. */
export const PPT_DIRECTION_RENDER_DIR = '.kun-ppt-review/directions'

export type PptDirectionSamplePreview = {
  role: (typeof PPT_DIRECTION_SAMPLE_ROLES)[number]
  imagePath: string
  sha256: string
  width: number
  height: number
}

/**
 * Render one candidate's three-page sample PPTD with the built-in renderer.
 * Files are named by content hash, so a revision never overwrites the
 * preview another candidate (or the previous revision) still points at.
 */
export async function renderPptDirectionSamples(input: {
  sampleProject: string
  directionName: string
  workspaceRoot: string
  projectDir: string
  context: ToolHostContext
}): Promise<{ sampleProject: string; previews: PptDirectionSamplePreview[] }> {
  const sampleRoot = resolve(input.projectDir, PPT_DIRECTION_SAMPLE_DIR)
  const sample = await resolveWorkspacePath(input.sampleProject, input.context, { enforceWorkspaceBoundary: true })
  const proof = await assertPptScopedExistingPath({
    workspaceRoot: input.workspaceRoot,
    scopeRoot: sampleRoot,
    // workspaceRoot and projectDir are physical; keep the target in the same space.
    targetPath: resolve(input.workspaceRoot, sample.relativePath),
    label: 'PPT direction sample',
    expected: 'directory',
    recursive: true
  })
  if (proof.physicalPath === proof.physicalScopeRoot) {
    throw new Error(`direction ${input.directionName} must use its own folder under ${PPT_DIRECTION_SAMPLE_DIR}/`)
  }
  const rendered = await renderPptdPreviewDeck(proof.physicalPath)
  if (rendered.pages.length !== PPT_DIRECTION_SAMPLE_ROLES.length) {
    throw new Error(`direction ${input.directionName} sample must contain exactly 3 pages: cover, representative content, and the most complex page`)
  }
  if (Math.abs(rendered.width / rendered.height - 16 / 9) / (16 / 9) > 0.01) {
    throw new Error(`direction ${input.directionName} sample must use a 16:9 page size`)
  }
  const renderRoot = resolve(input.projectDir, PPT_DIRECTION_RENDER_DIR)
  await assertPptScopedMutationPath({
    workspaceRoot: input.workspaceRoot,
    scopeRoot: input.projectDir,
    targetPath: renderRoot,
    label: 'PPT direction preview directory',
    expected: 'directory'
  })
  await mkdir(renderRoot, { recursive: true })
  const previews: PptDirectionSamplePreview[] = []
  for (const [index, role] of PPT_DIRECTION_SAMPLE_ROLES.entries()) {
    const svg = rendered.pages[index].svg
    const sha256 = createHash('sha256').update(svg).digest('hex')
    const target = resolve(renderRoot, `${sha256.slice(0, 16)}-${role}.svg`)
    await assertPptScopedMutationPath({
      workspaceRoot: input.workspaceRoot,
      scopeRoot: renderRoot,
      targetPath: target,
      label: 'PPT direction preview',
      expected: 'file'
    })
    await writeFile(target, svg, 'utf8')
    previews.push({
      role,
      imagePath: portableRelative(input.workspaceRoot, target),
      sha256,
      width: rendered.width,
      height: rendered.height
    })
  }
  return { sampleProject: portableRelative(input.workspaceRoot, proof.physicalPath), previews }
}
