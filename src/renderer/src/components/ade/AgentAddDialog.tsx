import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, FileUp, GitFork, SquareTerminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { loadHarnesses } from '../../store/harness-store'
import { settingsButtonClass } from '../settings-button'
import { AgentCenterCustomForm, type CustomFormMode } from './agent-center-custom-form'

const STATE_KEY = 'kun-agent-add-dialog-v1'
type Kind = Exclude<CustomFormMode, 'free'>
type Step = 'choose' | 'form'
type DialogState = { step: Step; kind: Kind }

const KINDS: ReadonlyArray<{ id: Kind; icon: typeof GitFork }> = [
  { id: 'derive', icon: GitFork },
  { id: 'acp', icon: SquareTerminal },
  { id: 'import', icon: FileUp }
]
const initialState: DialogState = { step: 'choose', kind: 'derive' }

function readState(): DialogState {
  if (typeof window === 'undefined') return initialState
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STATE_KEY) ?? '{}') as Partial<DialogState>
    return parsed.step === 'form' && KINDS.some((kind) => kind.id === parsed.kind)
      ? { step: 'form', kind: parsed.kind as Kind }
      : initialState
  } catch {
    return initialState
  }
}

/**
 * Adds an Agent that is not in the list: derive from a
 * built-in engine, point at any ACP command, or import a saved definition.
 * Built-in Agents are connected from their own page, not from here.
 */
export function AgentAddDialog({ settings, updateKun, onSelectAgent, onClose, settingsSurface = false }: {
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  onSelectAgent: (id: string) => void
  onClose: () => void
  settingsSurface?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const [state, setState] = useState(readState)
  const [kind, setKind] = useState<Kind>(state.kind)
  const firstOption = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.sessionStorage.setItem(STATE_KEY, JSON.stringify(state)) }
    catch { /* The dialog still works when session storage is blocked. */ }
  }, [state])
  useEffect(() => { if (state.step === 'choose') firstOption.current?.focus() }, [state.step])

  const forget = (): void => {
    if (typeof window === 'undefined') return
    try { window.sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
  }
  const saved = (id: string): void => {
    forget()
    void loadHarnesses(true)
    onSelectAgent(id)
    onClose()
  }

  const content = (
    <div role="dialog" aria-modal="true" aria-label={t('agentAdd.title')} data-agent-add-wizard
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      className={`${settingsSurface ? 'ds-settings-surface ' : ''}fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3 md:p-6`}>
      <div className="flex max-h-[min(90vh,820px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-ds-border px-4 py-3">
          {state.step === 'form' ? (
            <button data-settings-action="ghost" data-settings-size="icon" type="button" onClick={() => setState({ ...state, step: 'choose' })}
              aria-label={t('agentAdd.back')} data-agent-add-back className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover">
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ds-ink">{t('agentAdd.title')}</h2>
          <button data-settings-action="ghost" data-settings-size="icon" type="button" onClick={onClose} aria-label={t('agentAdd.cancel')} data-agent-add-close
            className="rounded-md p-1 text-ds-muted hover:bg-ds-hover"><X className="h-4 w-4" /></button>
        </div>
        <ol className="flex shrink-0 gap-5 border-b border-ds-border-muted px-4 py-2 text-[12px]" aria-label={t('agentCenter.addDialog.steps')}>
          {(['choose', 'form'] as const).map((step, index) => <li key={step} aria-current={state.step === step ? 'step' : undefined}
            className={state.step === step ? 'font-semibold text-ds-ink' : 'text-ds-faint'}>{index + 1} {t(`agentCenter.addDialog.step_${step}`)}</li>)}
        </ol>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state.step === 'choose' ? (
            <div className="space-y-3" data-agent-add-choose>
              <p className="text-[12.5px] leading-[1.6] text-ds-muted">{t('agentCenter.addDialog.intro')}</p>
              <div role="radiogroup" aria-label={t('agentCenter.addDialog.kindLabel')} className="space-y-2">
                {KINDS.map(({ id, icon: Icon }, index) => {
                  const selected = kind === id
                  return <button key={id} type="button" role="radio" aria-checked={selected} ref={index === 0 ? firstOption : undefined}
                    data-agent-add-kind={id} data-agent-add-custom={id === 'acp' || undefined} data-agent-add-import={id === 'import' || undefined}
                    onClick={() => setKind(id)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40 ${selected ? 'border-[var(--ds-control)] bg-ds-card shadow-[0_0_0_1px_var(--ds-control)]' : 'border-ds-border bg-ds-subtle hover:bg-ds-hover'}`}>
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ds-hover text-ds-ink"><Icon aria-hidden size={16} /></span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-ds-ink">{t(`agentCenter.addDialog.kind_${id}.title`)}</span>
                      <span className="mt-0.5 block text-[12px] leading-[1.5] text-ds-muted">{t(`agentCenter.addDialog.kind_${id}.desc`)}</span>
                    </span>
                  </button>
                })}
              </div>
            </div>
          ) : (
            <div data-agent-add-form>
              <AgentCenterCustomForm settings={settings} updateKun={updateKun} t={tSettings} tCommon={t} mode={state.kind} onSaved={saved} />
            </div>
          )}
        </div>
        {state.step === 'choose' ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button type="button" onClick={onClose} className={settingsButtonClass()}>{t('agentCenter.cancel')}</button>
          <button type="button" onClick={() => setState({ step: 'form', kind })} data-agent-add-next className={settingsButtonClass({ variant: 'primary' })}>{t('agentCenter.addDialog.next')}</button>
        </div> : null}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
