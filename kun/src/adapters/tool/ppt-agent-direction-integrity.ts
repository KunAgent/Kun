import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { PptReviewManifestV1 } from '../../ppt/ppt-review-manifest.js'
import { detectPptImageDimensions } from '../../ppt/ppt-geometry-qa-image.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { assertPptScopedExistingPath } from './ppt-agent-physical-path.js'
import { PPT_DIRECTION_RENDER_DIR } from './ppt-agent-direction-samples.js'

export async function pptDirectionPreviewIntegrityError(
  manifest: PptReviewManifestV1,
  context: ToolHostContext
): Promise<string> {
  if (!manifest.directions) return 'persisted visual directions are unavailable'
  // Rendered sample pages live in the project; legacy directions used generated images.
  const renderedRoot = `${manifest.projectDir.replace(/\/+$/, '')}/${PPT_DIRECTION_RENDER_DIR}/`
  const managedRoots = [renderedRoot, '.kun/images/']
  for (const candidate of manifest.directions.candidates) {
    for (const preview of candidate.previews) {
      const portable = preview.imagePath.replaceAll('\\', '/')
      const root = managedRoots.find((prefix) => portable.startsWith(prefix))
      if (!root) {
        return `persisted direction preview left the managed preview directory: ${preview.imagePath}`
      }
      try {
        const scope = await resolveWorkspacePath(root.slice(0, -1), context, { enforceWorkspaceBoundary: true })
        const image = await resolveWorkspacePath(preview.imagePath, context, { enforceWorkspaceBoundary: true })
        const proof = await assertPptScopedExistingPath({
          workspaceRoot: image.workspaceRoot,
          scopeRoot: scope.absolutePath,
          targetPath: image.absolutePath,
          label: 'PPT direction preview',
          expected: 'file'
        })
        const bytes = await readFile(proof.physicalPath)
        const dimensions = detectPptImageDimensions(bytes, proof.physicalPath)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (!dimensions || sha256 !== preview.sha256 ||
          dimensions.width !== preview.width || dimensions.height !== preview.height) {
          return `persisted direction preview changed after host validation: ${preview.imagePath}`
        }
      } catch {
        return `persisted direction preview is unavailable or changed: ${preview.imagePath}`
      }
    }
  }
  return ''
}
