import { useEffect, useState, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Bot, Check, Plug, Search, Sparkles, Wrench, X } from 'lucide-react'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { ModelSelect, ReasoningEffortPicker } from './SubagentProfileControls'
import { harnessRowAvailable, harnessRowRunsTurns, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import {
  BUILTIN_TOOL_NAMES,
  loadCapabilityCatalog,
  normalizeStoredReasoning,
  PRESET_COLORS,
  resolveReasoningOptions,
  type CapabilityCatalog
} from './subagent-settings-support'

export function ProfileDialog({
  profile: initial,
  isNew,
  builtin,
  groups,
  onSave,
  onCancel
}: {
  profile: KunSubagentProfileV1
  isNew: boolean
  builtin: boolean
  groups: ModelProviderModelGroup[]
  onSave: (p: KunSubagentProfileV1) => void
  onCancel: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [d, setD] = useState<KunSubagentProfileV1>(initial)
  const [tab, setTab] = useState<'basic' | 'permissions'>('basic')
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const harnessRows = useHarnessStore((state) => state.rows)

  useEffect(() => {
    // P4-02: opening the dialog force-refreshes; waitMs lets an in-flight
    // detection settle so harness options do not stay stuck on 'unknown'.
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])
  const set = <K extends keyof KunSubagentProfileV1>(k: K, v: KunSubagentProfileV1[K]): void =>
    setD((p) => ({ ...p, [k]: v }))

  // Lazily fetch the MCP/skill catalog the first time the Permissions tab opens —
  // avoids a runtime round-trip for users who only edit the basic fields.
  useEffect(() => {
    if (tab !== 'permissions' || catalog || catalogLoading) return
    setCatalogLoading(true)
    void loadCapabilityCatalog().then(setCatalog).finally(() => setCatalogLoading(false))
  }, [tab, catalog, catalogLoading])

  // Drives the "Custom" chip on the Permissions tab: readOnly, or any deny-list set.
  const customized = d.toolPolicy === 'readOnly'
    || Boolean(d.blockedTools?.length || d.blockedMcpServers?.length || d.blockedSkills?.length)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-main shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-ds-border px-4 py-3">
          <Bot className="h-4 w-4 text-ds-muted" />
          <span className="text-sm font-semibold text-ds-heading">
            {isNew ? t('subagentsPanel.newSubagent', 'New subagent') : t('agentsView.editAgent', 'Edit agent')}
          </span>
        </div>
        <div className="flex shrink-0 gap-1 border-b border-ds-border px-3 pt-2">
          <TabButton active={tab === 'basic'} onClick={() => setTab('basic')}>
            {t('agentsView.tabBasic', 'Basic')}
          </TabButton>
          <TabButton
            active={tab === 'permissions'}
            onClick={() => setTab('permissions')}
            badge={customized ? t('agentsView.permScopeCustom', 'Custom') : undefined}
          >
            {t('agentsView.tabPermissions', 'Permissions')}
          </TabButton>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {tab === 'basic' ? (
            <>
          <Field label={t('agentsView.fName', 'Name')}>
            <input
              autoFocus
              value={d.name}
              disabled={builtin}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label={t('agentsView.fDesc', 'Description')}>
            <input
              value={d.description ?? ''}
              onChange={(e) => set('description', e.target.value || undefined)}
              className="w-full rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label={t('agentsView.fColor', 'Color')}>
            <div className="flex gap-2.5">
              {PRESET_COLORS.map((c) => {
                const selected = d.color === c
                return (
                  <button aria-label={`${t('agentsView.fColor', 'Color')}: ${c}`}
                    key={c}
                    type="button"
                    onClick={() => set('color', c)}
                    aria-pressed={selected}
                    className="relative h-8 w-8 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      boxShadow: selected
                        ? `0 0 0 2px var(--ds-surface-card), 0 0 0 4px ${c}, 0 2px 6px ${c}66`
                        : `inset 0 0 0 1px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.15)`
                    }}
                  >
                    {selected && (
                      <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-semibold drop-shadow">
                        ✓
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label={t('agentsView.fMode', 'Mode')}>
            <select
              value={d.mode}
              onChange={(e) => set('mode', e.target.value as KunSubagentProfileV1['mode'])}
              className="w-full rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
            >
              <option value="subagent">{t('agentsView.modeDelegate', 'delegate')}</option>
              <option value="primary">{t('agentsView.modePersona', 'persona')}</option>
              <option value="all">{t('agentsView.modeBoth', 'both')}</option>
            </select>
          </Field>
          <Field label={t('agentsView.fModel', 'Model')}>
            <ModelSelectFull
              value={d.model ?? ''}
              providerId={d.providerId ?? ''}
              groups={groups}
              onChange={(m, pid) => setD((p) => ({ ...p, model: m || undefined, providerId: pid || undefined }))}
            />
          </Field>
          <Field label={t('adeSettings.profileHarness', 'Agent (harness)')}>
            <select
              value={d.harnessId ?? ''}
              onChange={(e) => {
                const harnessId = e.target.value || undefined
                setD((p) => ({
                  ...p,
                  harnessId,
                  credentialMode: harnessId ? p.credentialMode : undefined
                }))
              }}
              className="w-full rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
            >
              <option value="">{t('adeSettings.profileHarnessKun', 'Kun (native loop)')}</option>
              {harnessRows
                .filter((row) => row.definition.id !== 'kun' && harnessRowRunsTurns(row) && harnessRowAvailable(row))
                .map((row) => (
                  <option key={row.definition.id} value={row.definition.id}>
                    {row.definition.displayName}
                  </option>
                ))}
            </select>
          </Field>
          {(() => {
            const row = harnessRows.find((r) => r.definition.id === d.harnessId)
            return row && row.definition.credentialModes.length > 1 ? (
              <Field label={t('adeSettings.profileCredentialMode', 'Credentials')}>
                <select
                  value={d.credentialMode ?? ''}
                  onChange={(e) =>
                    set('credentialMode', (e.target.value || undefined) as KunSubagentProfileV1['credentialMode'])
                  }
                  className="w-full rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
                >
                  <option value="">{t('adeSettings.profileCredentialDefault', 'Harness default')}</option>
                  {row.definition.credentialModes.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </Field>
            ) : null
          })()}
          {d.harnessId ? (
            <Field label={t('adeSettings.profileDelegationNotes', 'Best for')}>
              <textarea
                value={d.delegationNotes ?? ''}
                rows={2}
                placeholder={t(
                  'adeSettings.profileDelegationNotesHint',
                  'What this worker is good at; the manager reads this when picking workers.'
                )}
                onChange={(e) => set('delegationNotes', e.target.value || undefined)}
                className="w-full resize-none rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
              />
            </Field>
          ) : null}
          <Field label={t('subagentsPanel.reasoning', 'Reasoning')}>
            <ReasoningEffortPicker
              value={normalizeStoredReasoning(d.reasoningEffort)}
              options={resolveReasoningOptions(groups, d.model ?? '', d.providerId ?? '')}
              onChange={(effort) =>
                setD((p) => ({ ...p, reasoningEffort: effort === 'off' ? undefined : effort }))
              }
            />
          </Field>
          <Field label={t('agentsView.fSystemPrompt', 'System prompt')}>
            <textarea
              value={d.systemPrompt ?? ''}
              rows={3}
              onChange={(e) => set('systemPrompt', e.target.value || undefined)}
              className="w-full resize-none rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-3 py-1.5 text-sm"
            />
          </Field>
            </>
          ) : (
            <PermissionsTab d={d} setD={setD} catalog={catalog} loading={catalogLoading} t={t} />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-ds-muted hover:text-ds-heading">
            {t('agentsView.cancel', 'Cancel')}
          </button>
          <button data-settings-action="primary" data-settings-size="default"
            type="button"
            onClick={() => onSave({ ...d, name: d.name.trim() || d.id })}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            {isNew ? t('agentsView.create', 'Create') : t('agentsView.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, badge, children }: {
  active: boolean
  onClick: () => void
  badge?: string
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition ${
        active ? 'border-accent text-ds-heading' : 'border-transparent text-ds-muted hover:text-ds-heading'
      }`}
    >
      {children}
      {badge ? (
        <span
          className="rounded-full px-1.5 py-px text-[9.5px] font-semibold"
          style={{ backgroundColor: 'rgba(59,130,216,0.14)', color: '#3b82d8' }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Permission scope editor. The preset segmented control maps to the profile's
 * deny-list fields: readOnly → toolPolicy:'readOnly'; All → inherit + cleared
 * deny-lists; Custom → inherit + per-section block-lists. Everything here only
 * REMOVES capabilities, so the child can never exceed the main agent.
 */
function PermissionsTab({ d, setD, catalog, loading, t }: {
  d: KunSubagentProfileV1
  setD: Dispatch<SetStateAction<KunSubagentProfileV1>>
  catalog: CapabilityCatalog | null
  loading: boolean
  t: TFunction<'common'>
}): ReactElement {
  const [query, setQuery] = useState('')
  const readOnly = d.toolPolicy === 'readOnly'
  const hasDeny = Boolean(d.blockedTools?.length || d.blockedMcpServers?.length || d.blockedSkills?.length)
  const scope: 'readOnly' | 'all' | 'custom' = readOnly ? 'readOnly' : hasDeny ? 'custom' : 'all'

  const setScope = (next: 'readOnly' | 'all' | 'custom'): void => {
    if (next === 'readOnly') { setD((p) => ({ ...p, toolPolicy: 'readOnly' })); return }
    if (next === 'all') {
      setD((p) => ({ ...p, toolPolicy: 'inherit', blockedTools: undefined, blockedMcpServers: undefined, blockedSkills: undefined }))
      return
    }
    setD((p) => ({ ...p, toolPolicy: 'inherit' }))
  }

  const toggle = (key: 'blockedTools' | 'blockedMcpServers' | 'blockedSkills', id: string): void => {
    setD((p) => {
      const cur = new Set(p[key] ?? [])
      if (cur.has(id)) cur.delete(id)
      else cur.add(id)
      const next = [...cur]
      return { ...p, [key]: next.length ? next : undefined }
    })
  }

  const q = query.trim().toLowerCase()
  const tools = BUILTIN_TOOL_NAMES.filter((name) => !q || name.includes(q))
  const servers = (catalog?.mcpServers ?? []).filter((s) => !q || s.id.toLowerCase().includes(q))
  const skills = (catalog?.skills ?? []).filter((s) => !q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))

  const toolsOn = BUILTIN_TOOL_NAMES.length - (d.blockedTools?.length ?? 0)
  const serversTotal = catalog?.mcpServers.length ?? 0
  const serversOn = serversTotal - (d.blockedMcpServers?.length ?? 0)
  const skillsTotal = catalog?.skills.length ?? 0
  const skillsBlocked = d.blockedSkills?.length ?? 0

  const SEG: Array<{ id: 'readOnly' | 'all' | 'custom'; label: string }> = [
    { id: 'readOnly', label: t('agentsView.permScopeReadOnly', 'Read-only') },
    { id: 'all', label: t('agentsView.permScopeAll', 'All') },
    { id: 'custom', label: t('agentsView.permScopeCustom', 'Custom') }
  ]

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-ds-muted">{t('agentsView.permScope', 'Capability scope')}</label>
        <div className="flex gap-1 rounded-lg bg-ds-subtle p-1">
          {SEG.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition ${
                scope === s.id
                  ? 'bg-[var(--ds-surface-elevated)] text-ds-heading shadow-[inset_0_0_0_1px_var(--ds-border)]'
                  : 'text-ds-muted hover:text-ds-heading'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ds-faint">
          {scope === 'readOnly'
            ? t('agentsView.permScopeReadOnlyNote', 'Investigation only: read / grep / find / ls. No MCP or skills.')
            : scope === 'all'
              ? t('agentsView.permScopeAllNote', 'Inherits every capability the main agent has.')
              : t('agentsView.permScopeHint', 'Pick the capabilities this agent may use — never exceeds the main agent.')}
        </p>
      </div>

      {readOnly ? null : (
        <>
          <div className="flex items-center gap-2 rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('agentsView.permSearch', 'Search tools / MCP / skills…')}
              className="w-full bg-transparent text-[12.5px] text-ds-heading outline-none placeholder:text-ds-faint"
            />
          </div>

          <Section
            icon={<Wrench className="h-3.5 w-3.5" />}
            title={t('agentsView.permSecTools', 'Built-in tools')}
            badge={`${toolsOn} / ${BUILTIN_TOOL_NAMES.length}`}
          >
            <div className="flex flex-wrap gap-1.5">
              {tools.map((name) => {
                const on = !d.blockedTools?.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggle('blockedTools', name)}
                    className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                      on
                        ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--ds-accent)]'
                        : 'text-ds-faint line-through hover:text-ds-muted'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section
            icon={<Plug className="h-3.5 w-3.5" />}
            title={t('agentsView.permSecMcp', 'MCP servers')}
            badge={serversTotal ? `${serversOn} / ${serversTotal}` : undefined}
          >
            {loading ? (
              <Hint>{t('agentsView.permLoading', 'Loading capabilities…')}</Hint>
            ) : serversTotal === 0 ? (
              <Hint>{t('agentsView.permNoMcp', 'No MCP servers configured.')}</Hint>
            ) : (
              <div className="space-y-0.5">
                {servers.map((s) => (
                  <CapRow
                    key={s.id}
                    on={!d.blockedMcpServers?.includes(s.id)}
                    onToggle={() => toggle('blockedMcpServers', s.id)}
                    label={s.id}
                    meta={`${s.toolCount} ${t('agentsView.permToolsWord', 'tools')}`}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Sparkles className="h-3.5 w-3.5" />}
            title={t('agentsView.permSecSkills', 'Skills')}
            badge={skillsTotal
              ? (skillsBlocked
                  ? `${t('agentsView.permScopeAll', 'All')} · ${skillsBlocked} ${t('agentsView.permBlocked', 'blocked')}`
                  : t('agentsView.permScopeAll', 'All'))
              : undefined}
          >
            {loading ? (
              <Hint>{t('agentsView.permLoading', 'Loading capabilities…')}</Hint>
            ) : skillsTotal === 0 ? (
              <Hint>{t('agentsView.permNoSkills', 'No skills discovered.')}</Hint>
            ) : (
              <>
                <p className="mb-1.5 text-[11px] text-ds-faint">{t('agentsView.permSkillsInheritNote', 'Inherits all available skills by default; block individually.')}</p>
                <div className="max-h-44 space-y-0.5 overflow-y-auto">
                  {skills.map((s) => (
                    <CapRow
                      key={s.id}
                      on={!d.blockedSkills?.includes(s.id)}
                      onToggle={() => toggle('blockedSkills', s.id)}
                      label={s.name || s.id}
                      meta={s.description}
                    />
                  ))}
                </div>
              </>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ icon, title, badge, children }: {
  icon: ReactNode
  title: string
  badge?: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="rounded-lg border border-ds-border">
      <div className="flex items-center gap-2 border-b border-ds-border px-3 py-2">
        <span className="text-ds-muted">{icon}</span>
        <span className="text-[12.5px] font-medium text-ds-heading">{title}</span>
        {badge ? <span className="ml-auto rounded-full bg-ds-subtle px-2 py-px text-[10.5px] text-ds-muted">{badge}</span> : null}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function CapRow({ on, onToggle, label, meta }: {
  on: boolean
  onToggle: () => void
  label: string
  meta?: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-ds-hover/60"
    >
      <span className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'justify-end bg-accent' : 'justify-start bg-ds-border'}`}>
        <span className="h-3 w-3 rounded-full bg-white" />
      </span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${on ? 'text-ds-heading' : 'text-ds-faint'}`}>{label}</span>
      {meta ? <span className="max-w-[45%] shrink-0 truncate pl-2 text-[10.5px] text-ds-faint">{meta}</span> : null}
    </button>
  )
}

function Hint({ children }: { children: ReactNode }): ReactElement {
  return <p className="text-[11.5px] text-ds-faint">{children}</p>
}

/** Full-width model picker for the dialog (reuses ModelSelect, stretched). */
function ModelSelectFull(props: {
  value: string
  providerId: string
  groups: ModelProviderModelGroup[]
  onChange: (model: string, providerId: string) => void
}): ReactElement {
  return <ModelSelect {...props} stretch />
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement }): ReactElement {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ds-muted">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-ds-faint">{hint}</p> : null}
    </div>
  )
}
