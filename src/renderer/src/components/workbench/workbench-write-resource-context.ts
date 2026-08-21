import { relativeWritePath } from '../../write/quoted-selection'
import type { WriteActiveFileKind } from '../../write/write-workspace-store-types'
import type { WriteActiveResourceReference } from '../../write/write-turn-reference-context'

export function activeWriteResourceReference(
  workspaceRoot: string,
  filePath: string | null,
  fileKind: WriteActiveFileKind | null,
  sourceFormat?: string
): WriteActiveResourceReference | undefined {
  if (!filePath || !fileKind) return undefined
  const locator = relativeWritePath(workspaceRoot, filePath)
  return {
    sourceName: locator,
    locator,
    resourceKind: fileKind,
    access: fileKind === 'text' || fileKind === 'code' || (fileKind === 'office' && sourceFormat === 'xlsx')
      ? 'read-write'
      : 'read-only',
    ...(sourceFormat ? { sourceFormat } : {})
  }
}
