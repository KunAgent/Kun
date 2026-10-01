import type { ThreadRecord } from '../../contracts/threads.js'
import type { HybridThreadIndexRepository } from './hybrid-thread-index.js'
import { needsSummaryMetadataRepair, rowFromIndexRecord, type ThreadRow } from './hybrid-thread-index-mapping.js'

type RepairSource = {
  readThreadMetadataFromDisk(id: string): Promise<ThreadRecord | null>
  index: HybridThreadIndexRepository | null
}

/** Lazily backfill a page's lightweight routing fields, without reading conversation bodies. */
export async function repairLegacySummaryMetadata(store: unknown, row: ThreadRow): Promise<ThreadRow> {
  if (!needsSummaryMetadataRepair(row)) return row
  const source = store as RepairSource
  const thread = await source.readThreadMetadataFromDisk(row.id)
  if (!thread) throw new Error(`Thread metadata unavailable while repairing summary: ${row.id}`)
  const next = rowFromIndexRecord({ thread, messageCount: row.message_count,
    eventSeqHighWater: row.event_seq_high_water, preview: row.preview ?? '' }, {
    metadataPath: row.metadata_path, messagesPath: row.messages_path, eventsPath: row.events_path
  })
  source.index?.repairSummaryMetadata(row.id, row.extension_metadata_json, next.extension_metadata_json)
  // A newer live write wins if it changed the row while metadata was loading.
  return source.index?.find(row.id) ?? next
}
