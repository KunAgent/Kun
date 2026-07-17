import { useEffect, useState } from 'react'
import { designApi } from '@shared/seam/api'

/**
 * EXT-SEAM: Design library browser panel.
 *
 * Shows design libraries, components, assets, and skills.
 */

interface DesignLibrary {
  id: string
  name: string
  version: string
  description: string
  componentsCount: number
  assetsCount: number
}

interface Skill {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  difficulty: string
}

export function DesignLibraryBrowser(): React.ReactElement {
  const [libraries, setLibraries] = useState<DesignLibrary[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'libraries' | 'skills'>('libraries')

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [librariesRes, skillsRes] = await Promise.all([
        designApi.listLibraries(),
        designApi.listSkills()
      ])
      setLibraries((librariesRes.libraries as DesignLibrary[]) ?? [])
      setSkills((skillsRes.skills as Skill[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-6 text-ds-text">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Design System</h1>
          <p className="text-[13px] text-ds-muted">
            {libraries.length} libraries · {skills.length} skills
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('libraries')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              view === 'libraries'
                ? 'bg-accent text-white'
                : 'border border-ds-border-muted bg-ds-card hover:bg-ds-hover'
            }`}
          >
            Libraries
          </button>
          <button
            onClick={() => setView('skills')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              view === 'skills'
                ? 'bg-accent text-white'
                : 'border border-ds-border-muted bg-ds-card hover:bg-ds-hover'
            }`}
          >
            Skills
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
          {view === 'libraries' ? (
            <LibrariesList libraries={libraries} />
          ) : (
            <SkillsList skills={skills} />
          )}
        </div>
      )}
    </div>
  )
}

function LibrariesList({ libraries }: { libraries: DesignLibrary[] }): React.ReactElement {
  if (libraries.length === 0) {
    return <div className="text-center text-[13px] text-ds-muted">No design libraries found</div>
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {libraries.map((lib) => (
        <div
          key={lib.id}
          className="rounded-lg border border-ds-border-muted bg-ds-card p-4 transition-colors hover:border-accent/40"
        >
          <div className="mb-2">
            <h3 className="font-medium">{lib.name}</h3>
            <p className="text-[12px] text-ds-muted">v{lib.version}</p>
          </div>
          {lib.description && (
            <p className="mb-3 line-clamp-2 text-[12px] text-ds-muted">{lib.description}</p>
          )}
          <div className="flex gap-3 text-[11px] text-ds-muted">
            <span>{lib.componentsCount} components</span>
            <span>{lib.assetsCount} assets</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillsList({ skills }: { skills: Skill[] }): React.ReactElement {
  if (skills.length === 0) {
    return <div className="text-center text-[13px] text-ds-muted">No skills found</div>
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="rounded-lg border border-ds-border-muted bg-ds-card p-4 transition-colors hover:border-accent/40"
        >
          <div className="mb-2 flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="truncate font-medium">{skill.name}</h3>
              <p className="text-[12px] text-ds-muted">{skill.category}</p>
            </div>
            <span className="shrink-0 rounded bg-ds-hover px-1.5 py-0.5 text-[10px] text-ds-muted">
              {skill.difficulty}
            </span>
          </div>
          {skill.description && (
            <p className="mb-3 line-clamp-2 text-[12px] text-ds-muted">{skill.description}</p>
          )}
          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded bg-ds-hover px-1.5 py-0.5 text-[10px] text-ds-muted">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
