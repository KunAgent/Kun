import { useEffect, useMemo, useState } from 'react'
import { kunThreadToolOutputPath } from '@shared/kun-endpoints'
import { AcpToolOutputSchema, hasAcpResult, type AcpToolOutput, type ToolPresentation } from '@shared/tool-presentation'
import { boundCompleteToolPresentation } from '../../../../../kun/src/contracts/tool-presentation-bounds'
import { toolPresentationFields } from '../../../../../kun/src/contracts/tool-presentation-fields'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import type { ToolBlock } from '../../agent/types'
import { useTimelineFilePreviewThreadId } from './timeline-file-preview-workspace'

/** Only mounted inside an open details card. ACP evidence, including a late
 * normal protocol update, always takes priority over this local display copy. */
export function useAcpToolOutput(block: ToolBlock, p: ToolPresentation) {
  const thread = useTimelineFilePreviewThreadId()
  const call = block.meta?.callId
  const key = p.source === 'acp' && (p.state === 'completed' || p.state === 'failed') && !hasAcpResult(p) &&
    thread && block.turnId && typeof call === 'string' && call ? kunThreadToolOutputPath(thread, block.turnId, call) : undefined
  const [saved, setSaved] = useState<{ key: string; output: AcpToolOutput | null }>()
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    void rendererRuntimeClient.runtimeRequest(key, 'GET', undefined, { signal: controller.signal }).then(reply => {
      if (controller.signal.aborted) return
      const output = reply.ok ? AcpToolOutputSchema.safeParse(JSON.parse(reply.body)) : undefined
      setSaved({ key, output: output?.success ? output.data : null })
    }).catch(() => { if (!controller.signal.aborted) setSaved({ key, output: null }) })
    return () => controller.abort()
  }, [key])
  const presentation = useMemo(() => saved?.output && key === saved.key ? presentAcpToolOutput(p, saved.output) : p, [p, key, saved])
  return { presentation, loadingOutput: Boolean(key && key !== saved?.key) }
}

function presentAcpToolOutput(p: ToolPresentation, { text, truncated, provider }: AcpToolOutput): ToolPresentation {
  let output: unknown = text
  if (provider !== 'devin' && !truncated && p.kind !== 'read' && /^\s*(?:\[|\{)/u.test(text)) {
    try { output = JSON.parse(text) } catch { /* Plain text that starts with a bracket is still evidence. */ }
  }
  const result = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : undefined
  const command = Array.isArray(result?.command) && result.command.every((v): v is string => typeof v === 'string')
    ? result.command.map(arg => /^[\w./:=+-]+$/u.test(arg) ? arg : JSON.stringify(arg)).join(' ') : undefined
  const fields = toolPresentationFields(p.kind, p.input, command ? { ...result, command } : output)
  if (fields.results) fields.results = fields.results.filter(row => row.text || row.path || row.title || row.url)
  const view = { ...p, ...fields, output, truncated: p.truncated || truncated || fields.truncated }
  if (view.state === 'failed') view.error ??= view.text
  // Antigravity read_file has already numbered the returned lines. Keep the
  // original in Output and let the code viewer number its excerpt only once.
  if (provider !== 'devin' && p.kind === 'read') {
    const match = /^Showing lines (\d+)-(\d+) of \d+\r?\n/u.exec(text)
    if (match) {
      const first = Number(match[1]), lines = text.slice(match[0].length).split(/\r?\n/u)
      if (lines.at(-1) === '') lines.pop()
      if (lines.length === Number(match[2]) - first + 1 && lines.every((line, i) => line.startsWith(`${first + i}:`))) {
        view.fileContent = lines.map(line => line.replace(/^\d+: ?/u, '')).join('\n')
        view.line = first
        delete view.text
      }
    }
  }
  return boundCompleteToolPresentation(view)
}
