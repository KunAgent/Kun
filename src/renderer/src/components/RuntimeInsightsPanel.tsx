import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  Gauge,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { formatRelativeTime } from '../lib/format-relative-time'
import { workspaceLabelFromPath } from '../lib/workspace-label'

type Props = {
  className?: string
  onCollapse: () => void
}

type Notice = { tone: 'success' | 'error' | 'info'; message: string }
type PanelTab = 'overview' | 'usage' | 'tasks' | 'automations' | 'skills' | 'mcp' | 'sessions'
type UsageGroupBy = 'day' | 'model' | 'provider' | 'thread'
type JsonRecord = Record<string, unknown>

type RuntimeInfo = {
  bind_host?: string
  port?: number
  auth_required?: boolean
  version?: string
}

type WorkspaceStatus = {
  workspace?: string
  git_repo?: boolean
  branch?: string | null
  staged?: number
  unstaged?: number
  untracked?: number
  ahead?: number | null
  behind?: number | null
}

type UsageTotals = {
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  reasoning_tokens?: number
  cost_usd?: number
  turns?: number
}

type UsageBucket = UsageTotals & {
  key?: string
  label?: string
  thread_id?: string
  model?: string
  provider?: string
  day?: string
}

type RuntimeUsage = {
  since?: string | null
  until?: string | null
  group_by?: UsageGroupBy
  totals?: UsageTotals
  buckets?: UsageBucket[]
}

type RuntimeTask = {
  id: string
  status?: string
  prompt_summary?: string
  prompt?: string
  model?: string
  mode?: string
  created_at?: string
  started_at?: string | null
  ended_at?: string | null
  duration_ms?: number | null
  error?: string | null
  thread_id?: string | null
  turn_id?: string | null
}

type TasksResponse = {
  tasks?: RuntimeTask[]
  counts?: Record<string, number>
}

type RuntimeAutomation = {
  id: string
  name?: string
  prompt?: string
  rrule?: string
  cwds?: string[]
  status?: string
  created_at?: string
  updated_at?: string
  next_run_at?: string | null
  last_run_at?: string | null
}

type AutomationRun = {
  id: string
  automation_id?: string
  scheduled_for?: string
  status?: string
  created_at?: string
  started_at?: string | null
  ended_at?: string | null
  task_id?: string | null
  thread_id?: string | null
  turn_id?: string | null
  error?: string | null
}

type SkillEntry = {
  name: string
  description?: string
  path?: string
  enabled?: boolean
}

type SkillsResponse = {
  directory?: string
  warnings?: string[]
  skills?: SkillEntry[]
}

type McpServerEntry = {
  name: string
  enabled?: boolean
  required?: boolean
  command?: string | null
  url?: string | null
  connected?: boolean
  enabled_tools?: string[]
  disabled_tools?: string[]
}

type McpToolEntry = {
  server?: string
  name?: string
  prefixed_name?: string
  description?: string | null
  input_schema?: unknown
}

type RuntimeSession = JsonRecord & {
  id?: string
  title?: string
  created_at?: string
  updated_at?: string
  message_count?: number
  total_tokens?: number
  model?: string
  workspace?: string
  mode?: string
}

const TABS: Array<{ id: PanelTab; icon: typeof Gauge; labelKey: string }> = [
  { id: 'overview', icon: Gauge, labelKey: 'runtimePanelTabOverview' },
  { id: 'usage', icon: BarChart3, labelKey: 'runtimePanelTabUsage' },
  { id: 'tasks', icon: ClipboardList, labelKey: 'runtimePanelTabTasks' },
  { id: 'automations', icon: CalendarClock, labelKey: 'runtimePanelTabAutomations' },
  { id: 'skills', icon: Bot, labelKey: 'runtimePanelTabSkills' },
  { id: 'mcp', icon: Server, labelKey: 'runtimePanelTabMcp' },
  { id: 'sessions', icon: Database, labelKey: 'runtimePanelTabSessions' }
]

function readRuntimeError(body: string, fallback: string): string {
  if (!body.trim()) return fallback
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    if (parsed.error && typeof parsed.error === 'object') {
      const nested = (parsed.error as { message?: unknown }).message
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  } catch {
    /* use raw body */
  }
  return body.trim() || fallback
}

async function requestJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') {
    throw new Error('Runtime bridge unavailable')
  }
  const r = await window.dsGui.runtimeRequest(
    path,
    method,
    body == null ? undefined : JSON.stringify(body)
  )
  if (!r.ok) {
    throw new Error(readRuntimeError(r.body, `${method} ${path} failed (${r.status || 0})`))
  }
  if (!r.body.trim()) return undefined as T
  return JSON.parse(r.body) as T
}

function buildQuery(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function readArray<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const value = (payload as JsonRecord)[key]
  return Array.isArray(value) ? (value as T[]) : []
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatCount(value: unknown): string {
  return new Intl.NumberFormat().format(numberValue(value))
}

function formatCost(value: unknown): string {
  return `$${numberValue(value).toFixed(4)}`
}

function cacheHitRate(value: UsageTotals): number | null {
  const input = numberValue(value.input_tokens)
  if (input <= 0) return null
  return numberValue(value.cached_tokens) / input
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

function formatTime(value: string | null | undefined, locale: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return formatRelativeTime(value, locale)
}

function statusTone(status: string | undefined): string {
  const normalized = status?.toLowerCase() ?? ''
  if (['completed', 'success', 'active', 'connected', 'enabled'].includes(normalized)) {
    return 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (['running', 'queued', 'in_progress', 'started'].includes(normalized)) {
    return 'border-sky-300/50 bg-sky-500/10 text-sky-700 dark:text-sky-200'
  }
  if (['failed', 'error', 'canceled', 'cancelled', 'paused', 'disabled'].includes(normalized)) {
    return 'border-amber-300/50 bg-amber-500/10 text-amber-800 dark:text-amber-100'
  }
  return 'border-ds-border bg-ds-subtle text-ds-muted'
}

function StatusPill({ value }: { value?: string | boolean | null }): ReactElement {
  const label = typeof value === 'boolean' ? (value ? 'enabled' : 'disabled') : value || '-'
  return (
    <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(label)}`}>
      {label}
    </span>
  )
}

function sessionId(session: RuntimeSession): string {
  return typeof session.id === 'string' ? session.id : ''
}

function sessionTitle(session: RuntimeSession): string {
  const title = typeof session.title === 'string' ? session.title.trim() : ''
  return title || sessionId(session).slice(0, 12) || 'Session'
}

function bucketKey(bucket: UsageBucket, index: number): string {
  return (
    bucket.label ||
    bucket.key ||
    bucket.day ||
    bucket.model ||
    bucket.provider ||
    bucket.thread_id ||
    String(index + 1)
  )
}

export function RuntimeInsightsPanel({ className = '', onCollapse }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const selectThread = useChatStore((s) => s.selectThread)
  const resumeSessionIntoThread = useChatStore((s) => s.resumeSessionIntoThread)

  const [activeTab, setActiveTab] = useState<PanelTab>('overview')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null)
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('day')
  const [usage, setUsage] = useState<RuntimeUsage | null>(null)
  const [tasks, setTasks] = useState<RuntimeTask[]>([])
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({})
  const [automations, setAutomations] = useState<RuntimeAutomation[]>([])
  const [automationRuns, setAutomationRuns] = useState<Record<string, AutomationRun[]>>({})
  const [skillsResponse, setSkillsResponse] = useState<SkillsResponse | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([])
  const [mcpTools, setMcpTools] = useState<McpToolEntry[]>([])
  const [mcpServerFilter, setMcpServerFilter] = useState('')
  const [sessions, setSessions] = useState<RuntimeSession[]>([])
  const [sessionSearch, setSessionSearch] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskModel, setTaskModel] = useState('')
  const [taskMode, setTaskMode] = useState<'agent' | 'plan'>('agent')
  const [automationName, setAutomationName] = useState('')
  const [automationPrompt, setAutomationPrompt] = useState('')
  const [automationRrule, setAutomationRrule] = useState('FREQ=DAILY;INTERVAL=1')
  const [automationCwds, setAutomationCwds] = useState(workspaceRoot)

  useEffect(() => {
    if (!automationCwds.trim() && workspaceRoot.trim()) setAutomationCwds(workspaceRoot)
  }, [automationCwds, workspaceRoot])

  const usageTotals = usage?.totals ?? {}
  const dirtyFiles =
    numberValue(workspaceStatus?.staged) +
    numberValue(workspaceStatus?.unstaged) +
    numberValue(workspaceStatus?.untracked)

  const run = useCallback(async (work: () => Promise<void>, success?: string): Promise<void> => {
    setLoading(true)
    setNotice(null)
    try {
      await work()
      if (success) setNotice({ tone: 'success', message: success })
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshOverview = useCallback(async (): Promise<void> => {
    const [info, workspace, usageData] = await Promise.all([
      requestJson<RuntimeInfo>('/v1/runtime/info'),
      requestJson<WorkspaceStatus>('/v1/workspace/status'),
      requestJson<RuntimeUsage>('/v1/usage?group_by=day')
    ])
    setRuntimeInfo(info)
    setWorkspaceStatus(workspace)
    setUsage(usageData)
  }, [])

  const refreshUsage = useCallback(async (): Promise<void> => {
    const data = await requestJson<RuntimeUsage>(`/v1/usage${buildQuery({ group_by: usageGroupBy })}`)
    setUsage(data)
  }, [usageGroupBy])

  const refreshTasks = useCallback(async (): Promise<void> => {
    const data = await requestJson<TasksResponse>('/v1/tasks?limit=50')
    setTasks(Array.isArray(data.tasks) ? data.tasks : [])
    setTaskCounts(data.counts ?? {})
  }, [])

  const refreshAutomations = useCallback(async (): Promise<void> => {
    const data = await requestJson<unknown>('/v1/automations')
    setAutomations(readArray<RuntimeAutomation>(data, 'automations'))
  }, [])

  const refreshSkills = useCallback(async (): Promise<void> => {
    const data = await requestJson<SkillsResponse>('/v1/skills')
    setSkillsResponse(data)
  }, [])

  const refreshMcp = useCallback(async (): Promise<void> => {
    const [serversPayload, toolsPayload] = await Promise.all([
      requestJson<unknown>('/v1/apps/mcp/servers'),
      requestJson<unknown>(`/v1/apps/mcp/tools${buildQuery({ server: mcpServerFilter })}`)
    ])
    setMcpServers(readArray<McpServerEntry>(serversPayload, 'servers'))
    setMcpTools(readArray<McpToolEntry>(toolsPayload, 'tools'))
  }, [mcpServerFilter])

  const refreshSessions = useCallback(async (): Promise<void> => {
    const data = await requestJson<unknown>(
      `/v1/sessions${buildQuery({ limit: 50, search: sessionSearch })}`
    )
    setSessions(readArray<RuntimeSession>(data, 'sessions'))
  }, [sessionSearch])

  const refreshActiveTab = useCallback(async (): Promise<void> => {
    if (activeTab === 'overview') return refreshOverview()
    if (activeTab === 'usage') return refreshUsage()
    if (activeTab === 'tasks') return refreshTasks()
    if (activeTab === 'automations') return refreshAutomations()
    if (activeTab === 'skills') return refreshSkills()
    if (activeTab === 'mcp') return refreshMcp()
    return refreshSessions()
  }, [
    activeTab,
    refreshAutomations,
    refreshMcp,
    refreshOverview,
    refreshSessions,
    refreshSkills,
    refreshTasks,
    refreshUsage
  ])

  useEffect(() => {
    void run(refreshActiveTab)
  }, [refreshActiveTab, run])

  const createTask = async (): Promise<void> => {
    const prompt = taskPrompt.trim()
    if (!prompt) return
    await run(async () => {
      await requestJson<RuntimeTask>('/v1/tasks', 'POST', {
        prompt,
        workspace: workspaceRoot.trim() || undefined,
        model: taskModel.trim() || undefined,
        mode: taskMode
      })
      setTaskPrompt('')
      await refreshTasks()
    }, t('runtimePanelTaskCreated'))
  }

  const cancelTask = async (taskId: string): Promise<void> => {
    await run(async () => {
      await requestJson<RuntimeTask>(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, 'POST', {})
      await refreshTasks()
    })
  }

  const createAutomation = async (): Promise<void> => {
    const name = automationName.trim()
    const prompt = automationPrompt.trim()
    const rrule = automationRrule.trim()
    if (!name || !prompt || !rrule) return
    await run(async () => {
      const cwds = automationCwds
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
      await requestJson<RuntimeAutomation>('/v1/automations', 'POST', {
        name,
        prompt,
        rrule,
        cwds: cwds.length ? cwds : undefined,
        status: 'active'
      })
      setAutomationName('')
      setAutomationPrompt('')
      await refreshAutomations()
    }, t('runtimePanelAutomationCreated'))
  }

  const automationAction = async (
    automationId: string,
    action: 'run' | 'pause' | 'resume' | 'delete'
  ): Promise<void> => {
    await run(async () => {
      if (action === 'delete') {
        await requestJson<void>(`/v1/automations/${encodeURIComponent(automationId)}`, 'DELETE')
      } else {
        await requestJson<unknown>(
          `/v1/automations/${encodeURIComponent(automationId)}/${action}`,
          'POST',
          {}
        )
      }
      await refreshAutomations()
    })
  }

  const loadAutomationRuns = async (automationId: string): Promise<void> => {
    await run(async () => {
      const data = await requestJson<unknown>(
        `/v1/automations/${encodeURIComponent(automationId)}/runs?limit=5`
      )
      setAutomationRuns((prev) => ({
        ...prev,
        [automationId]: readArray<AutomationRun>(data, 'runs')
      }))
    })
  }

  const setSkillEnabled = async (skill: SkillEntry, enabled: boolean): Promise<void> => {
    await run(async () => {
      await requestJson<unknown>(`/v1/skills/${encodeURIComponent(skill.name)}`, 'POST', {
        enabled
      })
      await refreshSkills()
    })
  }

  const deleteSession = async (id: string): Promise<void> => {
    await run(async () => {
      await requestJson<void>(`/v1/sessions/${encodeURIComponent(id)}`, 'DELETE')
      await refreshSessions()
    })
  }

  const resumeSession = async (id: string): Promise<void> => {
    await run(async () => {
      const threadId = await resumeSessionIntoThread(id)
      if (!threadId) throw new Error(t('runtimePanelSessionResumeFailed'))
    }, t('runtimePanelSessionResumed'))
  }

  const openThread = async (threadId: string | null | undefined): Promise<void> => {
    if (!threadId) return
    await selectThread(threadId)
  }

  const filteredSkills = useMemo(
    () => [...(skillsResponse?.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [skillsResponse]
  )

  return (
    <aside className={`ds-no-drag flex h-full min-h-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="shrink-0 border-b border-ds-border px-3 py-3">
        <div className="rounded-xl border border-ds-border bg-ds-card/80 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent-soft text-accent">
                <Gauge className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-semibold text-ds-ink">{t('runtimePanelTitle')}</h2>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-faint">
                  <CheckCircle2
                    className={`h-3.5 w-3.5 shrink-0 ${runtimeInfo ? 'text-emerald-500' : 'text-ds-faint'}`}
                    strokeWidth={1.9}
                  />
                  <span className="truncate">CodeWhale / HTTP</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void run(refreshActiveTab)}
                disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                title={t('runtimePanelRefresh')}
                aria-label={t('runtimePanelRefresh')}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
                )}
              </button>
              <button
                type="button"
                onClick={onCollapse}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                title={t('rightPanelCollapse')}
                aria-label={t('rightPanelCollapse')}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <HeaderStat label={t('runtimePanelVersion')} value={runtimeInfo?.version || '-'} />
            <HeaderStat
              label={t('runtimePanelEndpoint')}
              value={
                runtimeInfo
                  ? `${runtimeInfo.bind_host ?? '127.0.0.1'}:${runtimeInfo.port ?? '-'}`
                  : '-'
              }
            />
            <HeaderStat label={t('runtimePanelCost')} value={formatCost(usageTotals.cost_usd)} />
          </div>
        </div>
      </header>

      <nav className="grid shrink-0 grid-cols-4 gap-1 border-b border-ds-border px-3 py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition ${
                active
                  ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_rgba(0,136,255,0.12)]'
                  : 'text-ds-faint hover:bg-ds-hover/70 hover:text-ds-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              <span className="truncate">{t(tab.labelKey)}</span>
            </button>
          )
        })}
      </nav>

      {notice ? (
        <div
          className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${
            notice.tone === 'error'
              ? 'border-red-300/60 bg-red-500/10 text-red-800 dark:text-red-100'
              : notice.tone === 'success'
                ? 'border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100'
                : 'border-sky-300/60 bg-sky-500/10 text-sky-800 dark:text-sky-100'
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'overview' ? renderOverview() : null}
        {activeTab === 'usage' ? renderUsage() : null}
        {activeTab === 'tasks' ? renderTasks() : null}
        {activeTab === 'automations' ? renderAutomations() : null}
        {activeTab === 'skills' ? renderSkills() : null}
        {activeTab === 'mcp' ? renderMcp() : null}
        {activeTab === 'sessions' ? renderSessions() : null}
      </div>
    </aside>
  )

  function renderOverview(): ReactElement {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-ds-border bg-ds-card/80 p-3 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-ds-ink">{t('runtimePanelUsage')}</h3>
              <div className="mt-1 text-[24px] font-semibold tracking-normal text-ds-ink">
                {formatCost(usageTotals.cost_usd)}
              </div>
            </div>
            <StatusPill value={`${formatCount(usageTotals.turns)} ${t('runtimePanelTurns')}`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label={t('runtimePanelInputTokens')} value={formatCount(usageTotals.input_tokens)} />
            <MiniStat label={t('runtimePanelOutputTokens')} value={formatCount(usageTotals.output_tokens)} />
            <MiniStat label={t('runtimePanelCachedTokens')} value={formatCount(usageTotals.cached_tokens)} />
            <MiniStat label={t('runtimePanelCacheHit')} value={formatPercent(cacheHitRate(usageTotals))} />
          </div>
        </section>

        <section className="rounded-xl border border-ds-border bg-ds-card/80 p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ds-ink">{t('runtimePanelWorkspace')}</h3>
            <StatusPill value={workspaceStatus?.git_repo ? 'git' : 'plain'} />
          </div>
          <div className="min-w-0 truncate text-[12.5px] text-ds-muted" title={workspaceStatus?.workspace}>
            {workspaceStatus?.workspace || workspaceRoot || '-'}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <MiniStat label={t('runtimePanelBranch')} value={workspaceStatus?.branch || '-'} />
            <MiniStat label={t('runtimePanelStaged')} value={formatCount(workspaceStatus?.staged)} />
            <MiniStat label={t('runtimePanelUntracked')} value={formatCount(workspaceStatus?.untracked)} />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Metric label={t('runtimePanelAuth')} value={runtimeInfo?.auth_required ? 'Bearer' : 'off'} />
          <Metric label={t('runtimePanelGitDirty')} value={formatCount(dirtyFiles)} />
        </div>
      </div>
    )
  }

  function renderUsage(): ReactElement {
    const buckets = usage?.buckets ?? []
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <select
            value={usageGroupBy}
            onChange={(event) => setUsageGroupBy(event.target.value as UsageGroupBy)}
            className="h-9 rounded-lg border border-ds-border bg-ds-elevated px-2.5 text-[13px] text-ds-ink outline-none"
          >
            <option value="day">{t('runtimePanelGroupDay')}</option>
            <option value="model">{t('runtimePanelGroupModel')}</option>
            <option value="provider">{t('runtimePanelGroupProvider')}</option>
            <option value="thread">{t('runtimePanelGroupThread')}</option>
          </select>
          <Metric label={t('runtimePanelCost')} value={formatCost(usageTotals.cost_usd)} compact />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t('runtimePanelTurns')} value={formatCount(usageTotals.turns)} />
          <MiniStat label={t('runtimePanelInputTokens')} value={formatCount(usageTotals.input_tokens)} />
          <MiniStat label={t('runtimePanelOutputTokens')} value={formatCount(usageTotals.output_tokens)} />
          <MiniStat label={t('runtimePanelCacheHit')} value={formatPercent(cacheHitRate(usageTotals))} />
        </div>

        <div className="overflow-hidden rounded-lg border border-ds-border">
          {buckets.length === 0 ? (
            <EmptyState label={t('runtimePanelEmpty')} />
          ) : (
            buckets.map((bucket, index) => (
              <div
                key={`${bucketKey(bucket, index)}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-ds-border px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-ds-ink">
                    {bucketKey(bucket, index)}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ds-faint">
                    {formatCount(bucket.input_tokens)} / {formatCount(bucket.output_tokens)} · {t('runtimePanelCacheHit')}{' '}
                    {formatPercent(cacheHitRate(bucket))}
                  </div>
                </div>
                <div className="text-right text-[12px] font-semibold text-ds-muted">
                  {formatCost(bucket.cost_usd)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  function renderTasks(): ReactElement {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
          <textarea
            value={taskPrompt}
            onChange={(event) => setTaskPrompt(event.target.value)}
            rows={3}
            placeholder={t('runtimePanelTaskPrompt')}
            className="w-full resize-none rounded-lg border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-accent/35"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={taskModel}
              onChange={(event) => setTaskModel(event.target.value)}
              placeholder={t('runtimePanelModelAuto')}
              className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-elevated px-2.5 py-2 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
            />
            <select
              value={taskMode}
              onChange={(event) => setTaskMode(event.target.value as 'agent' | 'plan')}
              className="h-9 rounded-lg border border-ds-border bg-ds-elevated px-2 text-[12.5px] text-ds-ink outline-none"
            >
              <option value="agent">agent</option>
              <option value="plan">plan</option>
            </select>
            <button
              type="button"
              onClick={() => void createTask()}
              disabled={!taskPrompt.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              title={t('runtimePanelRunTask')}
              aria-label={t('runtimePanelRunTask')}
            >
              <Play className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {Object.entries(taskCounts).map(([key, value]) => (
            <StatusPill key={key} value={`${key}: ${value}`} />
          ))}
        </div>

        <div className="space-y-2">
          {tasks.length === 0 ? (
            <EmptyState label={t('runtimePanelEmpty')} />
          ) : (
            tasks.map((task) => {
              const cancellable = ['queued', 'running', 'in_progress', 'started'].includes(
                task.status?.toLowerCase() ?? ''
              )
              return (
                <section key={task.id} className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-[13px] font-medium text-ds-ink">
                        {task.prompt_summary || task.prompt || task.id}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-ds-faint">
                        <span>{task.model || '-'}</span>
                        <span>{task.mode || '-'}</span>
                        <span>{formatTime(task.created_at, i18n.language)}</span>
                      </div>
                    </div>
                    <StatusPill value={task.status} />
                  </div>
                  {task.error ? <p className="mt-2 text-[12px] text-red-600">{task.error}</p> : null}
                  <div className="mt-2 flex justify-end gap-1">
                    {task.thread_id ? (
                      <IconButton
                        label={t('runtimePanelOpenThread')}
                        onClick={() => void openThread(task.thread_id)}
                        icon={<RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      />
                    ) : null}
                    {cancellable ? (
                      <IconButton
                        label={t('runtimePanelCancelTask')}
                        onClick={() => void cancelTask(task.id)}
                        icon={<X className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      />
                    ) : null}
                  </div>
                </section>
              )
            })
          )}
        </div>
      </div>
    )
  }

  function renderAutomations(): ReactElement {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
          <input
            value={automationName}
            onChange={(event) => setAutomationName(event.target.value)}
            placeholder={t('runtimePanelAutomationName')}
            className="mb-2 h-9 w-full rounded-lg border border-ds-border bg-ds-elevated px-3 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          <textarea
            value={automationPrompt}
            onChange={(event) => setAutomationPrompt(event.target.value)}
            rows={3}
            placeholder={t('runtimePanelAutomationPrompt')}
            className="w-full resize-none rounded-lg border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          <input
            value={automationRrule}
            onChange={(event) => setAutomationRrule(event.target.value)}
            className="mt-2 h-9 w-full rounded-lg border border-ds-border bg-ds-elevated px-3 text-[12.5px] text-ds-ink outline-none"
          />
          <input
            value={automationCwds}
            onChange={(event) => setAutomationCwds(event.target.value)}
            placeholder={workspaceRoot}
            className="mt-2 h-9 w-full rounded-lg border border-ds-border bg-ds-elevated px-3 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          <button
            type="button"
            onClick={() => void createAutomation()}
            disabled={!automationName.trim() || !automationPrompt.trim() || !automationRrule.trim() || loading}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CalendarClock className="h-4 w-4" strokeWidth={1.9} />
            {t('runtimePanelCreateAutomation')}
          </button>
        </section>

        <div className="space-y-2">
          {automations.length === 0 ? (
            <EmptyState label={t('runtimePanelEmpty')} />
          ) : (
            automations.map((automation) => {
              const runs = automationRuns[automation.id] ?? []
              const paused = automation.status?.toLowerCase() === 'paused'
              return (
                <section key={automation.id} className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ds-ink">
                        {automation.name || automation.id}
                      </div>
                      <div className="mt-1 text-[11.5px] text-ds-faint">
                        {t('runtimePanelNextRun')}: {formatTime(automation.next_run_at, i18n.language)}
                      </div>
                    </div>
                    <StatusPill value={automation.status} />
                  </div>
                  <div className="mt-2 truncate text-[12px] text-ds-muted" title={automation.rrule}>
                    {automation.rrule || '-'}
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    <IconButton
                      label={t('runtimePanelRunNow')}
                      onClick={() => void automationAction(automation.id, 'run')}
                      icon={<Play className="h-3.5 w-3.5" strokeWidth={1.9} />}
                    />
                    <IconButton
                      label={paused ? t('runtimePanelResume') : t('runtimePanelPause')}
                      onClick={() => void automationAction(automation.id, paused ? 'resume' : 'pause')}
                      icon={
                        paused ? (
                          <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
                        ) : (
                          <Pause className="h-3.5 w-3.5" strokeWidth={1.9} />
                        )
                      }
                    />
                    <IconButton
                      label={t('runtimePanelRuns')}
                      onClick={() => void loadAutomationRuns(automation.id)}
                      icon={<ClipboardList className="h-3.5 w-3.5" strokeWidth={1.9} />}
                    />
                    <IconButton
                      label={t('runtimePanelDelete')}
                      onClick={() => {
                        if (window.confirm(t('runtimePanelDeleteConfirm'))) {
                          void automationAction(automation.id, 'delete')
                        }
                      }}
                      icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      danger
                    />
                  </div>
                  {runs.length > 0 ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-ds-border-muted">
                      {runs.map((runItem) => (
                        <div
                          key={runItem.id}
                          className="flex items-center justify-between gap-2 border-b border-ds-border-muted px-2 py-1.5 last:border-b-0"
                        >
                          <span className="min-w-0 truncate text-[11.5px] text-ds-muted">
                            {formatTime(runItem.created_at ?? runItem.scheduled_for, i18n.language)}
                          </span>
                          <StatusPill value={runItem.status} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })
          )}
        </div>
      </div>
    )
  }

  function renderSkills(): ReactElement {
    return (
      <div className="space-y-3">
        {skillsResponse?.directory ? (
          <div className="truncate rounded-lg border border-ds-border bg-ds-card/70 px-3 py-2 text-[12px] text-ds-muted">
            {skillsResponse.directory}
          </div>
        ) : null}
        {skillsResponse?.warnings?.map((warning) => (
          <div key={warning} className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-100">
            {warning}
          </div>
        ))}
        {filteredSkills.length === 0 ? (
          <EmptyState label={t('runtimePanelEmpty')} />
        ) : (
          filteredSkills.map((skill) => (
            <section key={skill.name} className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-ds-ink">{skill.name}</div>
                  {skill.description ? (
                    <p className="mt-1 line-clamp-2 text-[12px] text-ds-muted">{skill.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void setSkillEnabled(skill, !skill.enabled)}
                  className={`flex h-7 w-12 shrink-0 items-center rounded-full border px-0.5 transition ${
                    skill.enabled
                      ? 'justify-end border-accent/30 bg-accent/20'
                      : 'justify-start border-ds-border bg-ds-subtle'
                  }`}
                  aria-label={skill.enabled ? t('runtimePanelDisable') : t('runtimePanelEnable')}
                  title={skill.enabled ? t('runtimePanelDisable') : t('runtimePanelEnable')}
                >
                  <span className="h-5 w-5 rounded-full bg-ds-elevated shadow-sm" />
                </button>
              </div>
              {skill.path ? (
                <div className="mt-2 truncate text-[11.5px] text-ds-faint" title={skill.path}>
                  {skill.path}
                </div>
              ) : null}
            </section>
          ))
        )}
      </div>
    )
  }

  function renderMcp(): ReactElement {
    return (
      <div className="space-y-4">
        <select
          value={mcpServerFilter}
          onChange={(event) => setMcpServerFilter(event.target.value)}
          className="h-9 w-full rounded-lg border border-ds-border bg-ds-elevated px-2.5 text-[13px] text-ds-ink outline-none"
        >
          <option value="">{t('runtimePanelAllServers')}</option>
          {mcpServers.map((server) => (
            <option key={server.name} value={server.name}>
              {server.name}
            </option>
          ))}
        </select>

        <section className="space-y-2">
          {mcpServers.length === 0 ? (
            <EmptyState label={t('runtimePanelEmpty')} />
          ) : (
            mcpServers.map((server) => (
              <div key={server.name} className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ds-ink">{server.name}</div>
                    <div className="mt-1 truncate text-[11.5px] text-ds-faint">
                      {server.url || server.command || '-'}
                    </div>
                  </div>
                  <StatusPill value={server.connected ? 'connected' : server.enabled ? 'enabled' : 'disabled'} />
                </div>
                <div className="mt-2 flex gap-2 text-[11.5px] text-ds-faint">
                  <span>{t('runtimePanelEnabledTools')}: {server.enabled_tools?.length ?? 0}</span>
                  <span>{t('runtimePanelDisabledTools')}: {server.disabled_tools?.length ?? 0}</span>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
            {t('runtimePanelTools')}
          </h3>
          {mcpTools.length === 0 ? (
            <EmptyState label={t('runtimePanelEmpty')} />
          ) : (
            mcpTools.map((tool, index) => (
              <div
                key={`${tool.server}-${tool.prefixed_name || tool.name}-${index}`}
                className="rounded-lg border border-ds-border bg-ds-card/70 p-3"
              >
                <div className="flex items-start gap-2">
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold text-ds-ink">
                      {tool.prefixed_name || tool.name || '-'}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-ds-faint">{tool.server || '-'}</div>
                    {tool.description ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-ds-muted">{tool.description}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    )
  }

  function renderSessions(): ReactElement {
    return (
      <div className="space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint" strokeWidth={1.8} />
          <input
            value={sessionSearch}
            onChange={(event) => setSessionSearch(event.target.value)}
            placeholder={t('runtimePanelSearchSessions')}
            className="h-9 w-full rounded-lg border border-ds-border bg-ds-elevated pl-8 pr-3 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </label>

        {sessions.length === 0 ? (
          <EmptyState label={t('runtimePanelEmpty')} />
        ) : (
          sessions.map((session) => {
            const id = sessionId(session)
            return (
              <section key={id} className="rounded-lg border border-ds-border bg-ds-card/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ds-ink">{sessionTitle(session)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-ds-faint">
                      <span>{session.model || '-'}</span>
                      <span>{session.mode || '-'}</span>
                      <span>{formatTime(session.updated_at, i18n.language)}</span>
                    </div>
                  </div>
                  <StatusPill value={`${formatCount(session.message_count)} msg`} />
                </div>
                {typeof session.workspace === 'string' && session.workspace ? (
                  <div className="mt-2 truncate text-[12px] text-ds-muted" title={session.workspace}>
                    {workspaceLabelFromPath(session.workspace)}
                  </div>
                ) : null}
                <div className="mt-2 flex justify-end gap-1">
                  <IconButton
                    label={t('runtimePanelResumeSession')}
                    onClick={() => void resumeSession(id)}
                    icon={<Play className="h-3.5 w-3.5" strokeWidth={1.9} />}
                  />
                  <IconButton
                    label={t('runtimePanelDelete')}
                    onClick={() => {
                      if (window.confirm(t('runtimePanelDeleteConfirm'))) void deleteSession(id)
                    }}
                    icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
                    danger
                  />
                </div>
              </section>
            )
          })
        )}
      </div>
    )
  }
}

function HeaderStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-subtle px-2.5 py-2">
      <div className="truncate text-[10.5px] font-medium uppercase tracking-[0.08em] text-ds-faint">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] font-semibold text-ds-ink" title={value}>
        {value}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  compact = false
}: {
  label: string
  value: string
  compact?: boolean
}): ReactElement {
  return (
    <div className={`rounded-lg border border-ds-border bg-ds-card/70 ${compact ? 'px-3 py-1.5' : 'p-3'}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ds-faint">{label}</div>
      <div className="mt-1 truncate text-[14px] font-semibold text-ds-ink" title={value}>
        {value}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg bg-ds-subtle px-2.5 py-2">
      <div className="truncate text-[11px] text-ds-faint">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] font-semibold text-ds-ink" title={value}>
        {value}
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  icon,
  danger = false
}: {
  label: string
  onClick: () => void
  icon: ReactElement
  danger?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover ${
        danger ? 'hover:text-red-600' : 'hover:text-ds-ink'
      }`}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  )
}

function EmptyState({ label }: { label: string }): ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-ds-border px-3 py-6 text-center text-[12.5px] text-ds-faint">
      {label}
    </div>
  )
}
