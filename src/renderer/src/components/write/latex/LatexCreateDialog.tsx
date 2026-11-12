import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import './latex.css'

export function LatexCreateDialog({ workspaceRoot, onClose }: { workspaceRoot: string; onClose: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'chinese' | 'english' | 'blank'>('chinese')
  const [autoBuild, setAutoBuild] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLFormElement>(null)
  useEffect(() => { void window.kunGui.getSettings().then((settings) => setAutoBuild(settings.write.latex?.autoCompile !== false)).catch(() => {}) }, [])
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select') ?? [])]
        const first = elements[0], last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('keydown', handleKey); prior?.focus() }
  }, [submitting, onClose])
  return (
    <div className="ds-no-drag fixed inset-0 z-[85] flex items-center justify-center bg-black/20 backdrop-blur-[2px]" onMouseDown={() => { if (!submitting) onClose() }}>
      <form className="latex-create-dialog" role="dialog" aria-modal="true" aria-labelledby="latex-create-title" ref={dialog} onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault(); setSubmitting(true); setError('')
          void (async () => {
            const result = await window.kunGui.latexCreate({ workspaceRoot, name, template, autoBuild })
            if (!result.ok) throw new Error(result.message)
            await useWriteWorkspaceStore.getState().refreshWorkspace(workspaceRoot)
            await useWriteWorkspaceStore.getState().openFile(workspaceRoot, result.project.mainPath)
            onClose()
          })().catch((error) => setError(String(error))).finally(() => setSubmitting(false))
        }}>
        <h2 id="latex-create-title">{t('latexNewPaper')}</h2><p>{t('latexCreateHint')}</p>
        <div className="latex-create-fields"><div>
          <label htmlFor="latex-project-name">{t('latexProjectName')}</label>
          <input id="latex-project-name" autoFocus required disabled={submitting} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} className="latex-create-name" placeholder={t('latexProjectNamePlaceholder')} />
          <label>{t('latexTemplate')}</label>
          {(['chinese', 'english', 'blank'] as const).map((option) => <button type="button" className="latex-template" key={option} aria-pressed={template === option} onClick={() => setTemplate(option)} disabled={submitting}>
            <strong>{t(`latexTemplate_${option}`)}</strong><small>{t(`latexTemplateHint_${option}`)}</small></button>)}
          <label className="latex-create-auto"><input type="checkbox" checked={autoBuild} onChange={(event) => setAutoBuild(event.target.checked)} />{t('latexAutoCompile')}</label>
        </div><aside className="latex-create-preview"><strong>{name || t('latexProjectNamePlaceholder')}/</strong>
          <span>main.tex</span>{template !== 'blank' ? <><span>sections/</span><span>{'  introduction.tex'}</span></> : null}<span>references.bib</span><span>figures/</span><small>{t('latexCreateNoTools')}</small></aside></div>
        {error ? <p role="alert" className="text-red-500">{error}</p> : null}
        <footer><button type="button" disabled={submitting} onClick={onClose}>{t('writeEntryDialogCancel')}</button><button type="submit" className="latex-primary" disabled={submitting || !name.trim()}>{t(submitting ? 'latexCreating' : 'latexCreateOpen')}</button></footer>
      </form>
    </div>
  )
}
