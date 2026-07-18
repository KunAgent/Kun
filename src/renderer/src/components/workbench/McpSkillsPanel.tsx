import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { KunProjectConfigFileResult, SkillListItem } from '@shared/kun-gui-api'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import {
  MCP_SKILLS_PAGE_SIZE,
  clampPage,
  filterMcpSkillsEntries,
  mcpEntriesFromConfig,
  normalizeDisabledSkillIds,
  pageEntries,
  paginationItems,
  projectDisabledSkillIds,
  setMcpEntryEnabled,
  setProjectSkillEnabled,
  skillEntries,
  type McpSkillsCategory,
  type McpSkillsPanelEntry,
  type McpSkillsScope,
  type McpSkillsStatusFilter
} from './mcp-skills-panel-model'

const EMPTY_GLOBAL_MCP = '{\n  "servers": {}\n}\n'
const EMPTY_PROJECT_CONFIG = '{\n  "version": 1,\n  "mcp": {\n    "servers": {}\n  },\n  "skills": {\n    "enabled": true,\n    "includeConventional": true,\n    "roots": [],\n    "disabledIds": []\n  }\n}\n'

type Props = {
  workspaceRoot?: string
  onOpenSettings: () => void
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function normalizeForCompare(value: readonly string[]): string[] {
  return [...new Set(value)].sort()
}

export function McpSkillsPanel({ workspaceRoot = '', onOpenSettings }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [scope, setScope] = useState<McpSkillsScope>('project')
  const [category, setCategory] = useState<McpSkillsCategory>('mcp')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<McpSkillsStatusFilter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [projectState, setProjectState] = useState<KunProjectConfigFileResult | null>(null)
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [globalMcpText, setGlobalMcpText] = useState(EMPTY_GLOBAL_MCP)
  const [savedGlobalMcpText, setSavedGlobalMcpText] = useState(EMPTY_GLOBAL_MCP)
  const [projectText, setProjectText] = useState(EMPTY_PROJECT_CONFIG)
  const [savedProjectText, setSavedProjectText] = useState(EMPTY_PROJECT_CONFIG)
  const [globalDisabledIds, setGlobalDisabledIds] = useState<string[]>([])
  const [savedGlobalDisabledIds, setSavedGlobalDisabledIds] = useState<string[]>([])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setNotice(null)
    try {
      const api = window.kunGui
      const [settings, globalConfig, listedSkills, projectConfig] = await Promise.all([
        rendererRuntimeClient.getSettings({ forceRefresh: true }),
        api.getKunConfigFile(),
        api.listSkills(workspaceRoot || undefined),
        workspaceRoot ? api.getKunProjectConfigFile(workspaceRoot) : Promise.resolve(null)
      ])
      const globalText = globalConfig.content.trim() ? globalConfig.content : EMPTY_GLOBAL_MCP
      const projectDraft = projectConfig?.content.trim() ? projectConfig.content : EMPTY_PROJECT_CONFIG
      const disabledIds = normalizeDisabledSkillIds(settings.disabledSkillIds)
      setGlobalMcpText(globalText)
      setSavedGlobalMcpText(globalText)
      setProjectText(projectDraft)
      setSavedProjectText(projectDraft)
      setGlobalDisabledIds(disabledIds)
      setSavedGlobalDisabledIds(disabledIds)
      setProjectState(projectConfig)
      if (listedSkills.ok) setSkills(listedSkills.skills)
      else throw new Error(listedSkills.message)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [scope, category, query, statusFilter])

  const parsed = useMemo((): { entries: McpSkillsPanelEntry[]; error: string | null } => {
    try {
      if (category === 'mcp') {
        return {
          entries: mcpEntriesFromConfig(scope === 'project' ? projectText : globalMcpText, scope),
          error: null
        }
      }
      const disabled = scope === 'project'
        ? projectDisabledSkillIds(projectText)
        : globalDisabledIds
      return { entries: skillEntries(skills, scope, disabled), error: null }
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [category, globalDisabledIds, globalMcpText, projectText, scope, skills])

  const filtered = useMemo(
    () => filterMcpSkillsEntries(parsed.entries, query, statusFilter),
    [parsed.entries, query, statusFilter]
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / MCP_SKILLS_PAGE_SIZE))
  const safePage = clampPage(page, filtered.length)
  const visibleEntries = pageEntries(filtered, safePage)
  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [page, safePage])

  const globalSkillsDirty = !sameStrings(
    normalizeForCompare(globalDisabledIds),
    normalizeForCompare(savedGlobalDisabledIds)
  )
  const dirty = scope === 'project'
    ? projectText !== savedProjectText
    : globalMcpText !== savedGlobalMcpText || globalSkillsDirty

  const toggleEntry = (entry: McpSkillsPanelEntry): void => {
    setNotice(null)
    try {
      if (category === 'mcp') {
        if (scope === 'project') {
          setProjectText((current) => setMcpEntryEnabled(current, 'project', entry.id, !entry.enabled))
        } else {
          setGlobalMcpText((current) => setMcpEntryEnabled(current, 'global', entry.id, !entry.enabled))
        }
        return
      }
      if (scope === 'project') {
        setProjectText((current) => setProjectSkillEnabled(current, entry.id, !entry.enabled))
      } else {
        setGlobalDisabledIds((current) => entry.enabled
          ? [...new Set([...current, entry.id])]
          : current.filter((id) => id !== entry.id))
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const save = async (): Promise<void> => {
    if (!dirty || parsed.error) return
    setSaving(true)
    setNotice(null)
    try {
      if (scope === 'project') {
        if (!workspaceRoot) throw new Error(t('mcpSkillsPanel.workspaceRequired'))
        const result = await window.kunGui.setKunProjectConfigFile(workspaceRoot, projectText)
        const content = result.content.trim() ? result.content : EMPTY_PROJECT_CONFIG
        setProjectState(result)
        setProjectText(content)
        setSavedProjectText(content)
      } else {
        if (globalMcpText !== savedGlobalMcpText) {
          await window.kunGui.setKunConfigFile(globalMcpText)
          setSavedGlobalMcpText(globalMcpText)
        }
        if (globalSkillsDirty) {
          const settings: AppSettingsV1 = await rendererRuntimeClient.setSettings({
            disabledSkillIds: normalizeForCompare(globalDisabledIds)
          })
          const savedIds = normalizeDisabledSkillIds(settings.disabledSkillIds)
          setGlobalDisabledIds(savedIds)
          setSavedGlobalDisabledIds(savedIds)
          useChatStore.setState({ disabledSkillIds: savedIds })
        }
      }
      setNotice({ tone: 'success', message: t('mcpSkillsPanel.saved') })
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const openConfigDirectory = async (): Promise<void> => {
    try {
      const result = scope === 'project'
        ? workspaceRoot
          ? await window.kunGui.openKunProjectConfigDir(workspaceRoot)
          : { ok: false as const, message: t('mcpSkillsPanel.workspaceRequired') }
        : await window.kunGui.openKunConfigDir()
      if (!result.ok) throw new Error(result.message ?? t('mcpSkillsPanel.openFailed'))
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const scopeLabel = scope === 'project' ? t('mcpSkillsPanel.projectBadge') : t('mcpSkillsPanel.globalBadge')
  const workspaceName = workspaceRoot.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? ''
  const trustLabel = projectState?.trust === 'trusted'
    ? t('mcpSkillsPanel.trusted')
    : projectState?.trust === 'stale'
      ? t('mcpSkillsPanel.stale')
      : t('mcpSkillsPanel.untrusted')
  const firstVisible = filtered.length === 0 ? 0 : (safePage - 1) * MCP_SKILLS_PAGE_SIZE + 1
  const lastVisible = Math.min(filtered.length, safePage * MCP_SKILLS_PAGE_SIZE)

  return (
    <div className="ds-no-drag flex h-full min-h-0 flex-col bg-ds-sidebar text-ds-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
        <div className="grid grid-cols-2 rounded-xl border border-ds-border-muted bg-ds-surface-subtle p-1">
          {(['project', 'global'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setScope(candidate)}
              className={`rounded-[9px] px-3 py-2 text-[12.5px] font-semibold transition ${
                scope === candidate
                  ? 'border border-ds-border bg-ds-card text-ds-ink shadow-sm'
                  : 'border border-transparent text-ds-muted hover:text-ds-ink'
              }`}
              aria-pressed={scope === candidate}
            >
              {candidate === 'project' ? t('mcpSkillsPanel.projectScope') : t('mcpSkillsPanel.globalScope')}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-ds-border-muted bg-ds-card/65 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-ds-faint">
                {scope === 'project' ? t('mcpSkillsPanel.currentWorkspace') : t('mcpSkillsPanel.globalConfig')}
              </div>
              <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                {scope === 'project' ? workspaceName || t('mcpSkillsPanel.noWorkspace') : '~/.kun'}
              </div>
            </div>
            {scope === 'project' && workspaceRoot ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" strokeWidth={1.9} />
                {trustLabel}
              </span>
            ) : (
              <span className="rounded-full bg-ds-hover px-2 py-1 text-[10.5px] font-semibold text-ds-muted">
                {scopeLabel}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-2 border-b border-ds-border-muted">
          <div className="flex min-w-0 items-center gap-4">
            {(['mcp', 'skills'] as const).map((candidate) => {
              let count = 0
              try {
                count = candidate === 'mcp'
                  ? mcpEntriesFromConfig(scope === 'project' ? projectText : globalMcpText, scope).length
                  : skillEntries(
                      skills,
                      scope,
                      scope === 'project' ? projectDisabledSkillIds(projectText) : globalDisabledIds
                    ).length
              } catch {
                count = 0
              }
              return (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setCategory(candidate)}
                  className={`relative pb-2 text-[12.5px] font-semibold transition ${
                    category === candidate ? 'text-ds-ink' : 'text-ds-muted hover:text-ds-ink'
                  }`}
                  aria-pressed={category === candidate}
                >
                  {candidate === 'mcp' ? t('mcpSkillsPanel.mcpTab') : t('mcpSkillsPanel.skillsTab')}
                  <span className="ml-1.5 rounded-full bg-ds-hover px-1.5 py-0.5 text-[10px] text-ds-muted">{count}</span>
                  {category === candidate ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mb-1.5 inline-flex shrink-0 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1.5 text-[11px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {category === 'mcp' ? <Plus className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
            {category === 'mcp' ? t('mcpSkillsPanel.addMcp') : t('mcpSkillsPanel.manageSkills')}
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2 text-ds-muted focus-within:border-ds-border-strong">
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={category === 'mcp' ? t('mcpSkillsPanel.searchMcp') : t('mcpSkillsPanel.searchSkills')}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
            />
          </label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as McpSkillsStatusFilter)}
            aria-label={t('mcpSkillsPanel.statusFilter')}
            className="w-[7.25rem] rounded-xl border border-ds-border-muted bg-ds-card px-2 text-[11.5px] font-medium text-ds-muted outline-none"
          >
            <option value="all">{t('mcpSkillsPanel.allStatus')}</option>
            <option value="enabled">{t('mcpSkillsPanel.enabledOnly')}</option>
            <option value="disabled">{t('mcpSkillsPanel.disabledOnly')}</option>
          </select>
        </div>

        {notice ? (
          <div className={`mt-3 rounded-lg px-3 py-2 text-[11.5px] ${
            notice.tone === 'error'
              ? 'bg-red-500/10 text-red-700 dark:text-red-300'
              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          }`} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.message}
          </div>
        ) : null}
        {parsed.error ? (
          <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-700 dark:text-red-300" role="alert">
            {parsed.error}
          </div>
        ) : null}

        <div className="mt-3 overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card/70">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-[12px] text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('mcpSkillsPanel.loading')}
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-ds-muted">
              <Blocks className="h-5 w-5 text-ds-faint" strokeWidth={1.6} />
              {scope === 'project' && !workspaceRoot
                ? t('mcpSkillsPanel.workspaceRequired')
                : t('mcpSkillsPanel.empty')}
            </div>
          ) : visibleEntries.map((entry) => (
            <div key={`${entry.sourceScope}:${entry.id}`} className="flex min-h-[58px] items-center gap-3 border-b border-ds-border-muted px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-ds-ink">{entry.name}</div>
                <div className="mt-0.5 truncate text-[10.5px] text-ds-faint">{entry.description || entry.id}</div>
              </div>
              <span className="shrink-0 rounded-md bg-ds-hover px-1.5 py-0.5 text-[10px] font-semibold text-ds-muted">
                {entry.sourceScope === 'project' ? t('mcpSkillsPanel.projectBadge') : t('mcpSkillsPanel.globalBadge')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={entry.enabled}
                aria-label={t('mcpSkillsPanel.toggleEntry', { name: entry.name })}
                onClick={() => toggleEntry(entry)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${entry.enabled ? 'bg-accent' : 'bg-ds-border-strong'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${entry.enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex min-h-8 items-center justify-between gap-3 text-[11px] text-ds-muted">
          <span>{t('mcpSkillsPanel.range', { first: firstVisible, last: lastVisible, total: filtered.length })}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              aria-label={t('mcpSkillsPanel.previousPage')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-card text-ds-muted disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {paginationItems(safePage, totalPages).map((item, index) => item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="px-1 text-ds-faint">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                aria-current={item === safePage ? 'page' : undefined}
                className={`h-7 min-w-7 rounded-lg border px-1 text-[11px] font-semibold ${
                  item === safePage
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-ds-border-muted bg-ds-card text-ds-muted'
                }`}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              aria-label={t('mcpSkillsPanel.nextPage')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-card text-ds-muted disabled:opacity-35"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-ds-border-muted bg-ds-card/70 p-3">
        <button
          type="button"
          onClick={() => void openConfigDirectory()}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t('mcpSkillsPanel.openConfig')}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || Boolean(parsed.error)}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[12px] font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t('mcpSkillsPanel.saveChanges')}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          aria-label={t('mcpSkillsPanel.refresh')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}
