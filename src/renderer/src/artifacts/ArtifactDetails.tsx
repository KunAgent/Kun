import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import { openSourceConversation, sourceThreadFor } from './artifact-actions'
import type { LibraryArtifact } from './artifact-types'
import { formatArtifactSize, formatArtifactTime } from './artifact-view-model'

/** Project, source conversation, update time, path and size of an artifact. */
export function ArtifactDetails({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const threads = useChatStore((state) => state.threads)
  const source = sourceThreadFor(artifact, threads)
  const rows: Array<{ label: string; value: ReactElement | string }> = [
    { label: t('artifactsFieldProject'), value: artifact.projectName },
    {
      label: t('artifactsFieldSource'),
      value: source
        ? <button type="button" onClick={() => void openSourceConversation(artifact)} className="truncate text-left text-accent hover:underline">{source.title}</button>
        : t('artifactsFieldUnknownSource')
    },
    { label: t('artifactsFieldUpdated'), value: formatArtifactTime(artifact.updatedAt, i18n.language) },
    { label: t('artifactsFieldFile'), value: <span className="break-all font-mono text-[12px]">{artifact.path}</span> },
    ...(artifact.size !== undefined ? [{ label: t('artifactsFieldSize'), value: formatArtifactSize(artifact.size) }] : [])
  ]
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-3.5 text-[13px]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ds-muted">{row.label}</dt>
          <dd className="min-w-0 text-ds-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
