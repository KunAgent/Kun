import { useEffect, useRef, useState } from 'react'
import type { SkillListItem } from '@shared/kun-gui-api'
import type { CoreRuntimeInfoJson, CoreRuntimeSkillJson } from '../../agent/kun-contract'
import { getProvider } from '../../agent/registry'

function mergeSkillCommands(
  runtimeSkills: CoreRuntimeSkillJson[],
  localSkills: SkillListItem[]
): CoreRuntimeSkillJson[] {
  const merged = new Map<string, CoreRuntimeSkillJson>()
  for (const skill of localSkills) {
    merged.set(skill.id, {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      root: skill.root,
      legacy: skill.legacy,
      scope: skill.scope
    })
  }
  for (const skill of runtimeSkills) {
    const existing = merged.get(skill.id)
    merged.set(skill.id, existing ? {
      ...skill,
      ...existing,
      triggers: skill.triggers ?? existing.triggers,
      allowedTools: skill.allowedTools ?? existing.allowedTools
    } : skill)
  }
  return [...merged.values()]
}

function skillMenuJustOpened(wasOpen: boolean, isOpen: boolean): boolean {
  return !wasOpen && isOpen
}

async function loadSkillCommands(
  runtimeReady: boolean,
  activeSkillWorkspace: string
): Promise<CoreRuntimeSkillJson[]> {
  const provider = getProvider()
  const localSkillsTask = typeof window !== 'undefined' && typeof window.kunGui?.listSkills === 'function'
    ? window.kunGui.listSkills(activeSkillWorkspace || undefined)
    : Promise.resolve({ ok: true as const, skills: [], validationErrors: [] })
  const [runtimeResult, localSkillsResult] = await Promise.allSettled([
    runtimeReady && provider.listSkills ? provider.listSkills() : Promise.resolve([]),
    localSkillsTask
  ])
  const runtimeSkillList = runtimeResult.status === 'fulfilled' ? runtimeResult.value : []
  const localSkillList =
    localSkillsResult.status === 'fulfilled' && localSkillsResult.value.ok
      ? localSkillsResult.value.skills
      : []
  return mergeSkillCommands(runtimeSkillList, localSkillList)
}

export function useWorkbenchRuntimeMetadata(input: {
  activeSkillWorkspace: string
  runtimeConnection: string
  skillMenuOpen: boolean
}): {
  runtimeInfo: CoreRuntimeInfoJson | null
  runtimeSkills: CoreRuntimeSkillJson[]
} {
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [runtimeSkills, setRuntimeSkills] = useState<CoreRuntimeSkillJson[]>([])
  const skillMenuOpenRef = useRef(input.skillMenuOpen)

  useEffect(() => {
    let cancelled = false
    const runtimeReady = input.runtimeConnection === 'ready'
    if (!runtimeReady) setRuntimeInfo(null)
    const provider = getProvider()
    void Promise.allSettled([
      runtimeReady && provider.getRuntimeInfo ? provider.getRuntimeInfo() : Promise.resolve(null),
      loadSkillCommands(runtimeReady, input.activeSkillWorkspace)
    ])
      .then(([runtimeResult, skillsResult]) => {
        if (cancelled) return
        setRuntimeInfo(runtimeResult.status === 'fulfilled' ? runtimeResult.value : null)
        setRuntimeSkills(skillsResult.status === 'fulfilled' ? skillsResult.value : [])
      })
      .catch(() => {
        if (!cancelled) {
          if (!runtimeReady) setRuntimeInfo(null)
          setRuntimeSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [input.activeSkillWorkspace, input.runtimeConnection])

  useEffect(() => {
    const opened = skillMenuJustOpened(skillMenuOpenRef.current, input.skillMenuOpen)
    skillMenuOpenRef.current = input.skillMenuOpen
    if (!opened) return
    let cancelled = false
    void loadSkillCommands(
      input.runtimeConnection === 'ready',
      input.activeSkillWorkspace
    ).then((skills) => {
      if (!cancelled) setRuntimeSkills(skills)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [input.activeSkillWorkspace, input.runtimeConnection, input.skillMenuOpen])

  return { runtimeInfo, runtimeSkills }
}
