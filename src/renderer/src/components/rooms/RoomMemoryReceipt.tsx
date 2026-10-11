import { useState } from 'react'
import { AgentMemoryEntry, type AgentMemoryListEntry } from './AgentMemoryEntry'
import { agentPath, useAgentResource } from './agent-client'
import './agents.css'
import { useTranslation } from 'react-i18next'
import type { RoomRunDetail } from '@shared/rooms-api'

/** Only render an actual frozen input receipt; absence never means zero memories. */
export function RoomMemoryReceipt({ context, agentId }: { context?: RoomRunDetail['context']; agentId?: string }) {
  const { t } = useTranslation('common')
  const receipt = context?.memoryReceipt
  if (!receipt) return null
  return <details className="agent-memory-entry room-memory-receipt"><summary>{t('memoryPreparedInput', { count: receipt.entries.length })}</summary>
    <p className="rooms-run-note">{t('memoryPreparedInputHint')}</p>
    <small>{new Date(receipt.preparedAt).toLocaleString()}</small>
    {receipt.entries.map((entry) => <div key={entry.memoryId} className="memory-evidence-source">
      <strong>{entry.memoryId}</strong> · {t('memoryRevision', { revision: entry.revision })}
      {entry.evidenceStatus ? <p>{t('memoryEvidence_' + entry.evidenceStatus)}</p> : null}
      <p>{t('agentsMemorySources')}: {entry.sourceIds.join(', ') || t('memoryEvidenceUnavailable')}</p>
      <details><summary>{t('memoryReceiptIdentity')}</summary><p>{entry.fingerprint}</p></details>
      {agentId ? <CurrentReceiptMemory agentId={agentId} memoryId={entry.memoryId} /> : null}
    </div>)}
    <details><summary>{t('memoryInputIdentity')}</summary><p>{receipt.inputHash}</p></details>
  </details>
}

function CurrentReceiptMemory({ agentId, memoryId }: { agentId: string; memoryId: string }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const state = useAgentResource<AgentMemoryListEntry>(agentPath(agentId) + '/memories/' + encodeURIComponent(memoryId), open)
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t('memoryCurrentRecord')}</summary>
    <p className="rooms-run-note">{t('memoryCorrectionHint')}</p>
    {state.data ? <AgentMemoryEntry key={state.data.fingerprint} agentId={agentId} entry={state.data} onUpdated={state.refresh} />
      : <p>{t(state.error ? 'memoryCurrentUnavailable' : 'roomsLoading')}</p>}
  </details>
}
