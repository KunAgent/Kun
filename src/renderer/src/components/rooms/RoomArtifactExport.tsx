import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { agentPath } from './agent-client'
import { roomsRequest } from './rooms-client'

type ExportPage = { version: number; fileName: string; mimeType: string; byteSize: number; sha256: string;
  offset: number; dataBase64: string; nextOffset?: number }
export function RoomArtifactExport({ room, reference, compact = false }: { room: Room; reference: RoomContentReference; compact?: boolean }) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const identity = reference.kind === 'agent_file' ? `${reference.artifactId}:${reference.artifactVersion}` : reference.kind
  useEffect(() => { setBusy(false); setError(''); return () => pending.current?.abort() }, [room.id, identity])
  if (reference.kind !== 'agent_file' || !reference.artifactId || !reference.artifactVersion) return null
  const download = async () => {
    if (busy) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError('')
    try {
      const agentId = room.members[0].participantAgentId!
      const path = agentPath(agentId) + '/artifacts/' + encodeURIComponent(reference.artifactId!) + '/export?version=' + reference.artifactVersion
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let offset = 0, final: ExportPage | undefined
      do {
        const page = await roomsRequest<ExportPage>(path + '&offset=' + offset, 'GET', undefined, controller.signal)
        if (controller.signal.aborted) return
        if (page.offset !== offset || page.version !== reference.artifactVersion || page.byteSize > 50 * 1024 * 1024 ||
          final && (page.sha256 !== final.sha256 || page.byteSize !== final.byteSize)) throw new Error('Artifact export changed')
        const data = Uint8Array.from(atob(page.dataBase64), (character) => character.charCodeAt(0))
        chunks.push(data); offset += data.length; final = page
        if (page.nextOffset !== undefined && (page.nextOffset !== offset || !data.length)) throw new Error('Invalid artifact export cursor')
      } while (final.nextOffset !== undefined)
      if (offset !== final.byteSize) throw new Error('Incomplete artifact export')
      const blob = new Blob(chunks, { type: final.mimeType })
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      if ([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') !== final.sha256) throw new Error('Artifact export integrity check failed')
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = final.fileName.replace(/[\\/]/g, '_'); link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const label = t('roomsArtifactExport', { defaultValue: 'Export saved version' })
  return <div className={`rooms-artifact-export${compact ? ' is-compact' : ''}`}><button type="button" disabled={busy}
    className={compact ? 'ds-code-sidebar-icon-button' : undefined} title={label} aria-label={label}
    onClick={() => void download()}><Download size={compact ? 16 : 14} strokeWidth={1.75} />
    {compact ? null : label}</button>{error ? <p role="alert">{error}</p> : null}</div>
}
