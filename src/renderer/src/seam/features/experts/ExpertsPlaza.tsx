import { useEffect, useState } from 'react'
import { Plus, Power, Trash2 } from 'lucide-react'
import { expertsApi } from '@shared/seam/api'
import { ExpertEditorDialog } from './ExpertEditorDialog'

/**
 * EXT-SEAM: Experts Plaza panel.
 *
 * Lists all experts and teams loaded from experts/plugins, with enable/disable
 * and refresh. Reads through the authenticated /v1/experts endpoints.
 */

interface Expert {
  id: string
  displayName: string
  description: string
  profession: string
  domainTags: string[]
  enabled: boolean
  isCustom: boolean
}

interface ExpertTeam {
  id: string
  displayName: string
  description: string
  members: unknown[]
  enabled: boolean
  isCustom: boolean
}

interface ExpertActivation {
  activeExpertIds: string[]
  activeTeamIds: string[]
}

const EMPTY_ACTIVATION: ExpertActivation = {
  activeExpertIds: [],
  activeTeamIds: []
}

export function ExpertsPlaza(): React.ReactElement {
  const [experts, setExperts] = useState<Expert[]>([])
  const [teams, setTeams] = useState<ExpertTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activation, setActivation] = useState<ExpertActivation>(EMPTY_ACTIVATION)
  const [editorOpen, setEditorOpen] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await expertsApi.list()
      setExperts((result.experts as Expert[]) ?? [])
      setTeams((result.teams as ExpertTeam[]) ?? [])
      setActivation((result.activation as ExpertActivation | undefined) ?? EMPTY_ACTIVATION)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleActivation = async (id: string, active: boolean): Promise<void> => {
    try {
      if (active) {
        await expertsApi.deactivate(id)
      } else {
        await expertsApi.activate(id)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRefresh = async (): Promise<void> => {
    try {
      await expertsApi.refresh()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await expertsApi.deleteExpert(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const filteredExperts = experts.filter(
    (e) =>
      !search ||
      e.displayName?.toLowerCase().includes(search.toLowerCase()) ||
      e.profession?.toLowerCase().includes(search.toLowerCase()) ||
      e.domainTags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  )

  const filteredTeams = teams.filter(
    (t) => !search || t.displayName?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-6 text-ds-text">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">专家与专家团</h1>
          <p className="text-[13px] text-ds-muted">
            {experts.length} 位专家 · {teams.length} 个专家团
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] text-white">
            <Plus className="h-3.5 w-3.5" />新增
          </button>
          <button onClick={handleRefresh} className="rounded-md border border-ds-border-muted bg-ds-card px-3 py-1.5 text-[13px] hover:bg-ds-hover">刷新</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="按名称、职业或标签搜索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full rounded-md border border-ds-border-muted bg-ds-card px-3 py-2 text-[13px]"
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-ds-muted">Loading experts…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredTeams.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-[13px] font-medium text-ds-muted">专家团</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTeams.map((team) => (
                  <ExpertCard
                    key={team.id}
                    id={team.id}
                    title={team.displayName}
                    subtitle={`${team.members?.length ?? 0} members`}
                    description={team.description}
                    tags={[]}
                    active={activation.activeTeamIds.includes(team.id)}
                    isTeam
                    isCustom={team.isCustom}
                    onToggle={() => handleActivation(team.id, activation.activeTeamIds.includes(team.id))}
                    onDelete={team.isCustom ? () => handleDelete(team.id) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-[13px] font-medium text-ds-muted">专家</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredExperts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  id={expert.id}
                  title={expert.displayName}
                  subtitle={expert.profession}
                  description={expert.description}
                  tags={expert.domainTags ?? []}
                  active={activation.activeExpertIds.includes(expert.id)}
                  isCustom={expert.isCustom}
                  onToggle={() => handleActivation(expert.id, activation.activeExpertIds.includes(expert.id))}
                  onDelete={expert.isCustom ? () => handleDelete(expert.id) : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      {editorOpen ? <ExpertEditorDialog onClose={() => setEditorOpen(false)} onCreated={load} /> : null}
    </div>
  )
}

interface ExpertCardProps {
  id: string
  title: string
  subtitle: string
  description: string
  tags: string[]
  active: boolean
  isTeam?: boolean
  isCustom?: boolean
  onToggle: () => void
  onDelete?: () => void
}

function ExpertCard(props: ExpertCardProps): React.ReactElement {
  return (
    <div className="flex flex-col rounded-lg border border-ds-border-muted bg-ds-card p-4 transition-colors hover:border-accent/40">
      <div className="mb-2 flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{props.title || props.id}</h3>
          {props.subtitle && <p className="truncate text-[12px] text-ds-muted">{props.subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.isTeam && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">Team</span>
          )}
          {props.isCustom && (
            <span className="rounded bg-ds-hover px-1.5 py-0.5 text-[10px] text-ds-muted">Custom</span>
          )}
          <button
            type="button"
            onClick={props.onToggle}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
              props.active
                ? 'border-emerald-400/50 bg-emerald-500/12 text-emerald-500'
                : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
            aria-label={props.active ? `Deactivate ${props.title}` : `Activate ${props.title}`}
            title={props.active ? 'Deactivate' : 'Activate'}
          >
            <Power className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          {props.onDelete ? (
            <button type="button" onClick={props.onDelete} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-red-500/10 hover:text-red-400" aria-label={`删除 ${props.title}`} title="删除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {props.description && (
        <p className="mb-3 line-clamp-2 text-[12px] text-ds-muted">{props.description}</p>
      )}
      {props.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {props.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded bg-ds-hover px-1.5 py-0.5 text-[10px] text-ds-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between">
        <span className={`text-[11px] ${props.active ? 'text-emerald-500' : 'text-ds-muted'}`}>
          {props.active ? '已加入对话选择' : '未激活'}
        </span>
      </div>
    </div>
  )
}
