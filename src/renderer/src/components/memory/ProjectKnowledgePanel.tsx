import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import {
  buildProjectKnowledgeMarkdown, eligibleProjectKnowledge, parseProjectKnowledgeMarkdown,
  previewProjectKnowledgeExport, previewProjectKnowledgeImport, projectKnowledgeSource
} from '@shared/project-memory-interoperability'

export function ProjectKnowledgePanel({ records, create, update }: {
  records: CoreMemoryRecordJson[]
  create: (input: Record<string, unknown>) => Promise<boolean>
  update: (id: string, input: Record<string, unknown>) => Promise<boolean>
}) {
  const { t } = useTranslation('common')
  const projects = [...new Set(records.filter((record) => record.scope === 'project').map((record) => record.project).filter((value): value is string => Boolean(value)))]
  const [project, setProject] = useState(''), [selected, setSelected] = useState<string[]>([])
  const [raw, setRaw] = useState(''), [mode, setMode] = useState<'export' | 'import'>('export')
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const eligible = eligibleProjectKnowledge(records, project)
  const prepared = useMemo(() => {
    if (!project) return null
    try {
      const manifest = mode === 'export' ? previewProjectKnowledgeExport(records, { project, approvedIds: selected })
        : parseProjectKnowledgeMarkdown(raw, project)
      return { manifest, imports: previewProjectKnowledgeImport(manifest, records), error: '' }
    } catch (error) { return { error: String(error) } }
  }, [mode, project, raw, records, selected])
  const reset = () => { setPreview(false); setNotice('') }
  const apply = async () => {
    if (inFlight.current || !preview || !prepared?.manifest?.records.length) return
    inFlight.current = true; setBusy(true); setNotice('')
    try {
      if (mode === 'export') {
        const result = await window.kunGui.exportMemoryMarkdown({
          markdown: buildProjectKnowledgeMarkdown(prepared.manifest), defaultFileName: 'project-knowledge.md',
          projectKnowledge: { project, approvedIds: prepared.manifest.records.map((entry) => entry.id) }
        })
        if (result.ok) { setNotice(t('projectKnowledgeExported')); setPreview(false) }
        else if (!result.canceled) setNotice(result.message ?? '')
      } else {
        let changed = 0
        for (const candidate of prepared.imports) {
          const input = { content: candidate.entry.content, type: candidate.entry.type, tags: candidate.entry.tags, authority: 'reference' }
          if (candidate.action === 'blocked') throw new Error(candidate.reason)
          if (candidate.action === 'unchanged') continue
          const saved = candidate.action === 'create'
            ? await create({ ...input, scope: 'project', project, sources: [projectKnowledgeSource(candidate.entry.id)] })
            : await update(candidate.targetId!, { ...input, expectedRevision: candidate.expectedRevision })
          if (!saved) throw new Error(t('projectKnowledgeImportConflict'))
          changed++
        }
        setNotice(t('projectKnowledgeImported', { count: changed })); setPreview(false); setRaw('')
      }
    } catch (error) { setNotice(String(error)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <details className="agent-memory-panel project-knowledge-panel"><summary>{t('projectKnowledgeTitle')}</summary>
    <p className="rooms-run-note">{t('projectKnowledgeBoundary')}</p>
    <label>{t('memoryProject')}<input list="project-knowledge-projects" value={project} disabled={busy} aria-label={t('projectKnowledgeProject')}
      onChange={(event) => { setProject(event.target.value); setSelected([]); reset() }} /></label>
    <datalist id="project-knowledge-projects">{projects.map((value) => <option key={value} value={value} />)}</datalist>
    <div className="agent-memory-actions">
      <button type="button" disabled={busy} aria-pressed={mode === 'export'} onClick={() => { setMode('export'); reset() }}>{t('projectKnowledgeExport')}</button>
      <button type="button" disabled={busy} aria-pressed={mode === 'import'} onClick={() => { setMode('import'); reset() }}>{t('projectKnowledgeImport')}</button>
    </div>
    {mode === 'export' ? <fieldset disabled={busy}><legend>{t('projectKnowledgeSelect')}</legend>
      {eligible.map((record) => <label className="agent-checkbox" key={record.id}><input type="checkbox" checked={selected.includes(record.id)} onChange={() => {
        setSelected(selected.includes(record.id) ? selected.filter((id) => id !== record.id) : [...selected, record.id]); reset()
      }} /><span>{record.content}{'projectIdentity' in record && record.projectIdentity ? <small className="memory-project-identity">{t('memoryProjectIdentity')}: {String(record.projectIdentity)}</small> : null}</span></label>)}
      {!eligible.length ? <p>{t('projectKnowledgeEmpty')}</p> : null}
    </fieldset> : <label>{t('projectKnowledgePaste')}<textarea rows={6} value={raw} disabled={busy} aria-label={t('projectKnowledgePaste')}
      onChange={(event) => { setRaw(event.target.value); reset() }} /></label>}
    <div className="agent-memory-actions"><button type="button" disabled={busy || !project} onClick={() => setPreview(true)}>{t('projectKnowledgePreview')}</button></div>
    {preview ? <section aria-label={t('projectKnowledgePreview')}>
      {prepared?.error ? <p role="alert">{prepared.error}</p> : prepared?.manifest ? <>
        <p>{t('projectKnowledgePreviewCount', { count: prepared.manifest.records.length })} · {project}</p>
        {!prepared.manifest.records.length ? <p>{t('projectKnowledgeEmptyPreview')}</p> : null}
        {prepared.manifest.records.map((entry, index) => <article className="agent-memory-entry" key={entry.id}>
          <small>{entry.id}{mode === 'import' ? ' · ' + t('projectKnowledgeAction_' + prepared.imports[index].action) : ''}</small>
          {mode === 'import' && prepared.imports[index].action === 'update' ? <details><summary>{t('agentsMemoryCurrent')}</summary><p>{records.find((record) => record.id === prepared.imports[index].targetId)?.content}</p></details> : null}
          <p className="whitespace-pre-wrap">{entry.content}</p>
        </article>)}
        <p className="rooms-run-note">{t('memoryReferenceBoundary')}</p>
        <div className="agent-memory-actions">
          <button type="button" disabled={busy} onClick={() => setPreview(false)}>{t('roomsCancel')}</button>
          <button type="button" disabled={busy || !prepared.manifest.records.length || (mode === 'import' && prepared.imports.some((entry) => entry.action === 'blocked'))}
            onClick={() => void apply()}>{t(mode === 'export' ? 'projectKnowledgeSaveApproved' : 'projectKnowledgeImportApproved')}</button>
        </div>
      </> : null}
    </section> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </details>
}
