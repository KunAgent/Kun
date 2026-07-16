import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, RotateCcw, Square, UsersRound, X } from 'lucide-react'
import { collaborationApi } from '@shared/seam/api'

type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'paused' | 'interrupted' | 'retrying' | 'clarification_needed' | 'completed' | 'failed' | 'cancelled'
type Task = {
  id: string
  title: string
  assignedExpertId?: string
  status: TaskStatus
  result?: string
  error?: string
  attempt?: number
}
type Plan = {
  id: string
  expertTeamId: string
  title: string
  status: string
  createdAt: string
  tasks: Task[]
}

export function summarizeTeamProgress(tasks: readonly Pick<Task, 'status'>[]): {
  total: number; running: number; interrupted: number; completed: number
} {
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'in_progress' || task.status === 'retrying').length,
    interrupted: tasks.filter((task) => task.status === 'interrupted' || task.status === 'failed').length,
    completed: tasks.filter((task) => task.status === 'completed').length
  }
}

export function taskControlActions(status: TaskStatus): Array<'interrupt' | 'retry'> {
  if (status === 'in_progress' || status === 'retrying' || status === 'clarification_needed') return ['interrupt']
  if (status === 'interrupted' || status === 'failed' || status === 'paused') return ['retry']
  return []
}

export function ExpertTeamProgressDrawer({ teamId, label }: { teamId: string; label: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const response = await collaborationApi.listPlans()
      setPlans(((response.plans as Plan[] | undefined) ?? []).filter((plan) => plan.expertTeamId === teamId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [teamId])

  useEffect(() => { void load() }, [load])
  const plan = useMemo(
    () => [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [plans]
  )
  const summary = summarizeTeamProgress(plan?.tasks ?? [])

  const controlTask = async (task: Task, action: 'interrupt' | 'retry'): Promise<void> => {
    if (!plan) return
    setBusy(true)
    try {
      if (action === 'interrupt') await collaborationApi.interruptTask(task.id, plan.id)
      else await collaborationApi.retryTask(task.id, plan.id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  const interruptAll = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    try {
      await collaborationApi.cancelPlan(plan.id, 'user_interrupted_team')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-auto w-full max-w-[46rem]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center gap-2 rounded-full border border-ds-border bg-white px-3 text-[13px] text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] dark:bg-ds-card" aria-expanded={open} aria-label={`查看 ${label} 实时进展`}>
        <UsersRound className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-left font-medium text-ds-ink">{label}</span>
        {plan ? <span className="shrink-0 tabular-nums">{summary.completed}/{summary.total} 完成 · {summary.running} 进行中</span> : <span className="shrink-0">暂无任务</span>}
      </button>
      {open ? (
        <div className="mt-2 max-h-[min(420px,55vh)] overflow-hidden rounded-lg border border-ds-border bg-ds-card shadow-xl">
          <div className="flex h-11 items-center justify-between border-b border-ds-border-muted px-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ds-ink">{plan?.title ?? label}</div>
              <div className="text-[11px] text-ds-muted">{plan?.status ?? '等待创建任务'}</div>
            </div>
            <div className="flex items-center gap-1">
              {plan && !['completed', 'cancelled', 'failed'].includes(plan.status) ? <IconButton label="中断专家团全部任务" onClick={() => void interruptAll()} disabled={busy}><Square className="h-3.5 w-3.5" /></IconButton> : null}
              <IconButton label="刷新进展" onClick={() => void load()} disabled={busy}><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /></IconButton>
              <IconButton label="关闭进展" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></IconButton>
            </div>
          </div>
          {error ? <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{error}</div> : null}
          <div className="max-h-[340px] overflow-y-auto">
            {(plan?.tasks ?? []).map((task) => {
              const actions = taskControlActions(task.status)
              return (
                <div key={task.id} className="flex min-h-14 items-center gap-3 border-b border-ds-border-muted px-3 py-2 last:border-b-0">
                  <div className={`h-2 w-2 shrink-0 rounded-full ${statusColor(task.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2 text-[12px]"><span className="truncate font-medium text-ds-ink">{task.title}</span><span className="shrink-0 text-ds-faint">{task.assignedExpertId ?? '未分配'}</span></div>
                    <div className="truncate text-[11px] text-ds-muted">{task.error ?? task.result ?? `${task.status} · 第 ${task.attempt ?? 0} 次尝试`}</div>
                  </div>
                  {actions.includes('interrupt') ? <IconButton label={`中断 ${task.title}`} onClick={() => void controlTask(task, 'interrupt')} disabled={busy}><Square className="h-3.5 w-3.5" /></IconButton> : null}
                  {actions.includes('retry') ? <IconButton label={`继续 ${task.title}`} onClick={() => void controlTask(task, 'retry')} disabled={busy}><RotateCcw className="h-3.5 w-3.5" /></IconButton> : null}
                </div>
              )
            })}
            {!plan ? <div className="px-3 py-8 text-center text-[12px] text-ds-muted">发送专家团任务后将在这里显示实时进展。</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): React.ReactElement {
  return <button type="button" disabled={props.disabled} onClick={props.onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50" aria-label={props.label} title={props.label}>{props.children}</button>
}

function statusColor(status: TaskStatus): string {
  if (status === 'completed') return 'bg-emerald-500'
  if (status === 'in_progress' || status === 'retrying') return 'bg-sky-500'
  if (status === 'failed' || status === 'interrupted') return 'bg-red-500'
  if (status === 'clarification_needed' || status === 'paused') return 'bg-amber-500'
  return 'bg-ds-faint'
}
