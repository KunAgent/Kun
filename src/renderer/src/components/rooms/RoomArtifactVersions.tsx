import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { agentPath, useAgentResource } from './agent-client'
import { roomsRequest } from './rooms-client'

type VersionPage = { versions: Array<{ version: number; createdAt: string }>; nextCursor?: string }
export function RoomArtifactVersions({ room, reference, onVersion }: {
  room: Room; reference: RoomContentReference; onVersion: (version: number) => void
}) {
  const { t } = useTranslation('common')
  const file = reference.kind === 'agent_file' ? reference : undefined
  const path = file?.artifactId ? agentPath(room.members[0].participantAgentId!) + '/artifacts/' + encodeURIComponent(file.artifactId) + '/versions?limit=100' : null
  const resource = useAgentResource<VersionPage>(path)
  const [tail, setTail] = useState<VersionPage & { path: string | null }>({ path: null, versions: [] })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null), current = useRef(path); current.current = path
  useEffect(() => { setBusy(false); setError(''); return () => pending.current?.abort() }, [path])
  if (!file?.artifactId || !file.artifactVersion) return null
  const appended = tail.path === path ? tail : undefined
  const versions = [...new Map([...(resource.data?.versions ?? []), ...(appended?.versions ?? [])].map((item) => [item.version, item])).values()]
  const cursor = appended ? appended.nextCursor : resource.data?.nextCursor
  const more = async () => {
    if (!path || !cursor || busy) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError('')
    try {
      const page = await roomsRequest<VersionPage>(path + '&cursor=' + encodeURIComponent(cursor), 'GET', undefined, controller.signal)
      if (!controller.signal.aborted && current.current === path) setTail({ ...page, path, versions: [...(appended?.versions ?? []), ...page.versions] })
    } catch (cause) { if (!controller.signal.aborted && current.current === path) setError(String(cause)) }
    finally { if (!controller.signal.aborted && current.current === path) setBusy(false) }
  }
  return <div className="rooms-artifact-versions"><label>{t('roomsContentVersion')}
    <select value={file.artifactVersion} onChange={(event) => onVersion(Number(event.target.value))}>
      {!versions.some((item) => item.version === file.artifactVersion) ? <option value={file.artifactVersion}>v{file.artifactVersion}</option> : null}
      {versions.map((item) => <option key={item.version} value={item.version}>v{item.version} · {new Date(item.createdAt).toLocaleString()}</option>)}
    </select></label>
    {cursor ? <button type="button" disabled={busy} onClick={() => void more()}>{t('roomsArtifactMoreVersions')}</button> : null}
    {resource.error || error ? <span role="alert">{resource.error || error}<button type="button" onClick={resource.refresh}>{t('roomsRefresh')}</button></span> : null}
  </div>
}
