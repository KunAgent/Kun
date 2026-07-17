import { useEffect, useState } from 'react'
import { automationApi } from '@shared/seam/api'

/**
 * EXT-SEAM: Automation dashboard panel.
 *
 * Shows automation tasks, approvals, and digital employees.
 */

interface AutomationTask {
  id: string
  type: string
  status: string
  createdAt: string
  completedAt?: string
  payload: unknown
}

interface Approval {
  id: string
  taskId: string
  status: string
  createdAt: string
  risk: unknown
}

export function AutomationDashboard(): React.ReactElement {
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'tasks' | 'approvals'>('tasks')

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [tasksRes, approvalsRes] = await Promise.all([
        automationApi.listTasks(),
        automationApi.listApprovals()
      ])
      setTasks((tasksRes.tasks as AutomationTask[]) ?? [])
      setApprovals((approvalsRes.approvals as Approval[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleApprove = async (id: string): Promise<void> => {
    try {
      await automationApi.approve(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleReject = async (id: string): Promise<void> => {
    try {
      await automationApi.reject(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-6 text-ds-text">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Automation</h1>
          <p className="text-[13px] text-ds-muted">
            {tasks.length} tasks · {approvals.filter(a => a.status === 'pending').length} pending approvals
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('tasks')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              view === 'tasks'
                ? 'bg-accent text-white'
                : 'border border-ds-border-muted bg-ds-card hover:bg-ds-hover'
            }`}
          >
            Tasks
          </button>
          <button
            onClick={() => setView('approvals')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              view === 'approvals'
                ? 'bg-accent text-white'
                : 'border border-ds-border-muted bg-ds-card hover:bg-ds-hover'
            }`}
          >
            Approvals
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-ds-muted">Loading…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'tasks' ? (
            <TasksList tasks={tasks} />
          ) : (
            <ApprovalsList approvals={approvals} onApprove={handleApprove} onReject={handleReject} />
          )}
        </div>
      )}
    </div>
  )
}

function TasksList({ tasks }: { tasks: AutomationTask[] }): React.ReactElement {
  if (tasks.length === 0) {
    return <div className="text-center text-[13px] text-ds-muted">No tasks yet</div>
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="rounded-lg border border-ds-border-muted bg-ds-card p-4"
        >
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="font-medium">{task.type}</h3>
              <p className="text-[12px] text-ds-muted">{task.id}</p>
            </div>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${
                task.status === 'completed'
                  ? 'bg-green-500/15 text-green-400'
                  : task.status === 'failed'
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-ds-hover text-ds-muted'
              }`}
            >
              {task.status}
            </span>
          </div>
          <p className="text-[12px] text-ds-muted">
            Created {new Date(task.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  )
}

interface ApprovalsListProps {
  approvals: Approval[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
}

function ApprovalsList({ approvals, onApprove, onReject }: ApprovalsListProps): React.ReactElement {
  const pending = approvals.filter((a) => a.status === 'pending')

  if (pending.length === 0) {
    return <div className="text-center text-[13px] text-ds-muted">No pending approvals</div>
  }

  return (
    <div className="space-y-3">
      {pending.map((approval) => (
        <div
          key={approval.id}
          className="rounded-lg border border-ds-border-muted bg-ds-card p-4"
        >
          <div className="mb-3">
            <h3 className="font-medium">Task {approval.taskId}</h3>
            <p className="text-[12px] text-ds-muted">
              Requested {new Date(approval.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(approval.id)}
              className="rounded border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-[13px] text-green-400 hover:bg-green-500/20"
            >
              Approve
            </button>
            <button
              onClick={() => onReject(approval.id)}
              className="rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[13px] text-red-400 hover:bg-red-500/20"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
