/**
 * Agent-callable artifact reader (P0 #5).
 *
 * Large tool results are offloaded to the content-addressed artifact store and
 * the model only sees a bounded summary + an artifact id. This tool lets the
 * model pull the rest on demand — the full content, a byte range, or a line
 * range — instead of forcing every big payload into context. Read-only.
 */

import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { readArtifactBounded } from '../../artifacts/artifact-store.js'

export function createReadArtifactTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: 'read_artifact',
    description:
      'Read a stored artifact (large tool output) by id. Optionally fetch only a slice: ' +
      'startLine/endLine for a 1-indexed inclusive line range, or offset/length for a UTF-8 byte range. ' +
      'Use the artifact id returned by a previous tool result (e.g. stdoutArtifactId).',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
        offset: { type: 'number' },
        length: { type: 'number' },
        startLine: { type: 'number' },
        endLine: { type: 'number' }
      },
      required: ['artifactId'],
      additionalProperties: false
    },
    policy: 'auto',
    execute: async (args, context) => {
      if (!context.artifactStore) {
        return { output: { error: 'artifact store is not available in this runtime' }, isError: true }
      }
      const artifactId = typeof args.artifactId === 'string' ? args.artifactId.trim() : ''
      if (!artifactId) return { output: { error: 'artifactId is required' }, isError: true }
      const meta = await context.artifactStore.stat(artifactId)
      if (!meta) return { output: { error: `artifact not found: ${artifactId}` }, isError: true }
      const range = {
        ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
        ...(typeof args.length === 'number' ? { length: args.length } : {}),
        ...(typeof args.startLine === 'number' ? { startLine: args.startLine } : {}),
        ...(typeof args.endLine === 'number' ? { endLine: args.endLine } : {})
      }
      // Always read through the bounded reader: a request with no range, or a
      // range larger than the cap, is clamped to <=1 MiB / <=2000 lines and a
      // cursor is returned so the model pages rather than pulling a huge result
      // into context.
      const bounded = await readArtifactBounded(context.artifactStore, artifactId, meta, range)
      if (bounded === null) return { output: { error: `artifact content not found: ${artifactId}` }, isError: true }
      return {
        output: {
          artifactId,
          byteSize: meta.byteSize,
          lineCount: meta.lineCount,
          ...(meta.source ? { source: meta.source } : {}),
          ...(meta.origin ? { origin: meta.origin } : {}),
          range: bounded.range,
          truncated: bounded.truncated,
          ...(bounded.nextOffset !== undefined ? { nextOffset: bounded.nextOffset } : {}),
          ...(bounded.nextStartLine !== undefined ? { nextStartLine: bounded.nextStartLine } : {}),
          content: bounded.content
        }
      }
    }
  })
}
