import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { useAgentResource } from './agent-client'
import { roomPath } from './rooms-client'
import { roomContentKey } from './room-content-client'

type FileProps = { room: Room; onOpen: (reference: RoomContentReference) => void }
type FilePage = { files: RoomContentReference[]; nextCursor?: string; nextLegacyCursor?: string }
export function RoomDirectFiles(props: FileProps) {
  return <RoomDirectFileSearch key={JSON.stringify([props.room.id, props.room.members[0]?.participantAgentId])} {...props} />
}
function RoomDirectFileSearch({ room, onOpen }: FileProps) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  return <div className="direct-file-list min-h-0 flex-1 overflow-y-auto">
    <input aria-label={t('roomsArtifactSearch', { defaultValue: 'Search saved files' })} value={search}
      placeholder={t('roomsArtifactSearch', { defaultValue: 'Search saved files' })} onChange={(event) => setSearch(event.target.value)} />
    <RoomDirectFilePage key={search} room={room} onOpen={onOpen} search={search} />
  </div>
}
function RoomDirectFilePage({ room, onOpen, search }: FileProps & { search: string }) {
  const { t } = useTranslation('common')
  const [cursor, setCursor] = useState<string>(), [legacyCursor, setLegacyCursor] = useState<string>()
  const [prior, setPrior] = useState<RoomContentReference[]>([])
  const query = new URLSearchParams({ limit: '30', search })
  if (cursor) query.set('cursor', cursor)
  if (legacyCursor) query.set('legacy_cursor', legacyCursor)
  const resource = useAgentResource<FilePage>(roomPath(room.id) + '/files?' + query)
  const files = [...new Map([...prior, ...(resource.data?.files ?? [])].map((file) => [roomContentKey(file), file])).values()]
  const loading = !resource.data && !resource.error
  return <div className="direct-file-page" aria-busy={loading}>
    {files.map((file) => <button type="button" key={roomContentKey(file)} onClick={() => onOpen(file)}><FolderOpen size={16} />{file.titleSnapshot}
      {file.kind === 'agent_file' ? <small>{file.artifactVersion ? `v${file.artifactVersion}` : t('roomsArtifactLegacy', { defaultValue: 'Current workspace file' })}</small> : null}</button>)}
    {loading ? <p role="status">{t('roomsLoading')}</p> : null}
    {!loading && !resource.error && !files.length ? <p role="status">{search.trim()
      ? t('roomsArtifactNoSearchResults', { defaultValue: 'No files match your search' }) : t('directNoFiles')}</p> : null}
    {resource.data?.nextCursor ? <button type="button" onClick={() => { setPrior(files); setCursor(resource.data!.nextCursor) }}>
      {t('roomsArtifactMore', { defaultValue: 'Load more files' })}</button> : null}
    {!resource.data?.nextCursor && resource.data?.nextLegacyCursor ? <button type="button" onClick={() => {
      setPrior(files); setCursor(undefined); setLegacyCursor(resource.data!.nextLegacyCursor)
    }}>{t('roomsArtifactLegacyMore', { defaultValue: 'Search older workspace references' })}</button> : null}
    {resource.error ? <p role="alert">{resource.error} <button type="button" onClick={resource.refresh}>{t('retry', { defaultValue: 'Retry' })}</button></p> : null}
  </div>
}
