import type { HarnessTokenGrant } from '../../harness/harness-token-service.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'

export function harnessGatewayStream(source: AsyncIterable<ModelStreamChunk>, grant?: HarnessTokenGrant): AsyncIterable<ModelStreamChunk> {
  if (!grant?.onResolvedRoute) return source
  return (async function* () {
    for await (const chunk of source) {
      if (chunk.route && (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta' ||
        chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete' || chunk.kind === 'completed' && chunk.stopReason !== 'error')) {
        await grant.onResolvedRoute!(chunk.route)
      }
      yield chunk
    }
  })()
}
