export async function readWriteDocumentSha256(
  workspaceRoot: string,
  filePath: string | null
): Promise<string | undefined> {
  if (!filePath || !workspaceRoot) return undefined
  if (typeof window.kunGui?.readWriteDocumentSha256 !== 'function') return undefined
  const result = await window.kunGui
    .readWriteDocumentSha256({ workspaceRoot, filePath })
    .catch(() => ({ ok: false as const }))
  return result.ok ? result.sha256 : undefined
}
