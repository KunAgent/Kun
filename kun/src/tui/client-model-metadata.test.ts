import { expect, it, vi } from 'vitest'
import { KunTuiClient } from './client.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'

it('consumes metadata-only SSE snapshots and reconnects with a separate metadata cursor', async () => {
  const abort = new AbortController()
  const frame = (metadataRevision: number) => `id: 7:${metadataRevision}\nevent: model_connections\ndata: ${JSON.stringify(
    ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 7, metadataRevision, providers: [] })
  )}\n\n`
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(frame(2) + frame(2) + frame(3))); controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } }))
  const client = new KunTuiClient({ baseUrl: 'http://127.0.0.1:18899', fetch: fetcher })
  const seen: number[] = []
  await client.subscribeModelConnections({ sinceRevision: 7, sinceMetadataRevision: 1, signal: abort.signal,
    onSnapshot(snapshot) { seen.push(snapshot.metadataRevision!); if (snapshot.metadataRevision === 3) abort.abort() } })
  expect(seen).toEqual([2, 3])
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('since_revision=7&since_metadata_revision=1')
})
