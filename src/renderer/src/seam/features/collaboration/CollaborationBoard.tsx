import { useEffect, useState } from 'react'
import { Play, RefreshCw, Square, Check } from 'lucide-react'
import { collaborationApi } from '@shared/seam/api'

type CollaborationPlan = {
  id: string
  title: string
  description: string
  status: string
  tasks: Array<{ id: string; title: string; status: string }>
}

export function CollaborationBoard(): React.ReactElement {
  const [plans, setPlans] = useState<CollaborationPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await collaborationApi.listPlans()
      setPlans((response.plans as CollaborationPlan[] | undefined) ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      setError(null)
      await action()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-6 text-ds-text">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Collaboration</h1>
          <p className="text-[13px] text-ds-muted">{plans.length} plans</p>
        </div>
        <button type="button" title="Refresh plans" aria-label="Refresh plans" onClick={() => void load()} className="rounded-md border border-ds-border-muted p-2 hover:bg-ds-hover">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      {error ? <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</div> : null}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-ds-muted">Loading...</div>
      ) : plans.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-ds-muted">No collaboration plans</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-ds-border-muted bg-ds-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[14px] font-medium">{plan.title}</h2>
                  <p className="mt-1 line-clamp-2 text-[12px] text-ds-muted">{plan.description}</p>
                </div>
                <span className="shrink-0 rounded bg-ds-hover px-2 py-1 text-[11px] text-ds-muted">{plan.status}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ds-muted">{plan.tasks.length} tasks</span>
                <div className="flex gap-1">
                  {plan.status === 'draft' ? <IconAction label="Confirm plan" icon={<Check className="h-4 w-4" />} onClick={() => void runAction(() => collaborationApi.confirmPlan(plan.id))} /> : null}
                  {plan.status === 'confirmed' ? <IconAction label="Start plan" icon={<Play className="h-4 w-4" />} onClick={() => void runAction(() => collaborationApi.startPlan(plan.id))} /> : null}
                  {plan.status !== 'completed' && plan.status !== 'cancelled' ? <IconAction label="Cancel plan" icon={<Square className="h-4 w-4" />} onClick={() => void runAction(() => collaborationApi.cancelPlan(plan.id))} /> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IconAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }): React.ReactElement {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="rounded-md border border-ds-border-muted p-1.5 hover:bg-ds-hover">{icon}</button>
}
