import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SkillListItem, SkillRootListItem } from '@shared/kun-gui-api'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { loadPreferredSkillRootId, savePreferredSkillRootId, type SkillRootId } from '../../lib/skill-root-preference'
import { useChatStore } from '../../store/chat-store'
import { skillRootOptionsFromRoots } from '../plugin-marketplace-catalog'
import { normalizeDisabledSkillIds, normalizeSkillId, type SkillRootOption } from '../plugin-marketplace-config'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** Discovered skills, the skill roots, the install target and enable state. */
export function usePluginSkills({ t, workspaceRoot, active }: { t: Translate; workspaceRoot: string; active: boolean }) {
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [roots, setRoots] = useState<SkillRootListItem[]>([])
  const [disabledIds, setDisabledIds] = useState<string[]>([])
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null)
  const [rootId, setRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())

  const refreshSkills = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkills !== 'function') {
      setSkills([])
      setError(t('pluginSkillScanUnavailable'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.kunGui.listSkills(workspaceRoot || undefined)
      if (!result.ok) {
        setSkills([])
        setError(result.message)
        return
      }
      setSkills(result.skills)
      if (result.validationErrors.length > 0) setError(result.validationErrors[0]?.message ?? t('pluginSkillScanPartial'))
    } catch (cause) {
      setSkills([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [t, workspaceRoot])

  const refreshRoots = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkillRoots !== 'function') {
      setRoots([])
      return
    }
    try {
      const result = await window.kunGui.listSkillRoots(workspaceRoot || undefined)
      setRoots(result.ok ? result.roots : [])
    } catch {
      setRoots([])
    }
  }, [workspaceRoot])

  const refresh = useCallback(() => Promise.all([refreshSkills(), refreshRoots()]), [refreshRoots, refreshSkills])

  useEffect(() => {
    if (!active) return
    void refresh()
  }, [active, refresh])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void rendererRuntimeClient.getSettings({ forceRefresh: true })
      .then((settings) => {
        if (!cancelled) setDisabledIds(normalizeDisabledSkillIds(settings.disabledSkillIds))
      })
      .catch(() => {
        if (!cancelled) setDisabledIds([])
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const rootOptions = useMemo<SkillRootOption[]>(() => skillRootOptionsFromRoots(roots, t), [roots, t])
  const selectedRoot = rootOptions.find((option) => option.id === rootId) ??
    rootOptions.find((option) => option.enabled) ??
    rootOptions[0]

  useEffect(() => {
    if (rootOptions.length === 0) return
    if (rootOptions.some((option) => option.id === rootId)) {
      savePreferredSkillRootId(rootId)
      return
    }
    const fallback = rootOptions.find((option) => option.enabled) ?? rootOptions[0]
    if (fallback && fallback.id !== rootId) setRootId(fallback.id)
  }, [rootId, rootOptions])

  /** Persists the enable state; throws so the caller can report the failure. */
  const setEnabled = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    const normalizedId = normalizeSkillId(id)
    if (!normalizedId) return
    setToggleBusyId(normalizedId)
    try {
      const next = enabled
        ? disabledIds.filter((item) => item !== normalizedId)
        : [...new Set([...disabledIds, normalizedId])]
      const settings = await rendererRuntimeClient.setSettings({ disabledSkillIds: next })
      const normalized = normalizeDisabledSkillIds(settings.disabledSkillIds)
      setDisabledIds(normalized)
      useChatStore.setState({ disabledSkillIds: normalized })
    } finally {
      setToggleBusyId(null)
    }
  }, [disabledIds])

  return {
    skills,
    loading,
    error,
    roots,
    rootOptions,
    selectedRoot,
    setRootId,
    disabledIds,
    toggleBusyId,
    refresh,
    setEnabled
  }
}

export type PluginSkillsState = ReturnType<typeof usePluginSkills>
