import {
  type AppSettingsPatch
} from '@shared/app-settings'
import type {
  KunRuntimeSettingsSyncStatusPayload,
  SkillRootListItem
} from '@shared/kun-gui-api'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type {
  CoreMemoryRecordJson,
  CoreRuntimeInfoJson
} from '../agent/kun-contract'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { confirmDialog } from '../lib/confirm-dialog'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { loadKunDiagnostics } from '../lib/load-kun-diagnostics'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  coerceRendererSettings
} from './settings-utils'

type InlineNotice = { tone: 'success' | 'error' | 'info'; message: string }

export const DEFAULT_PROJECT_CONFIG_TEXT = `${JSON.stringify({
  version: 1,
  mcp: { servers: {} },
  skills: {
    enabled: true,
    includeConventional: true,
    roots: [],
    disabledIds: []
  }
}, null, 2)}\n`

export function useSettingsDomainOperations(scope: Record<string, any>): Record<string, any> {
  const { t, reloadUiSettings, category, form, setForm, setSkillRootsLoading, setSkillNotice, setMcpConfigPath, mcpConfigText, setMcpConfigText, setMcpConfigExists, mcpLoading, setMcpLoading, mcpLoaded, setMcpLoaded, setMcpBusy, setMcpNotice, projectConfig, setProjectConfig, projectConfigText, setProjectConfigText, setProjectConfigLoading, setProjectConfigBusy, setProjectConfigNotice, runtimeInfo, setRuntimeInfo, toolDiagnostics, setToolDiagnostics, setMemoryDiagnostics, runtimeDiagnosticsNotice, setRuntimeDiagnosticsBusy, setRuntimeDiagnosticsNotice, persistedSettingsRef, agentsSectionRef, skillSectionRef, mcpSectionRef, permissionsSectionRef, compactHomePath, expandHomePath, activeProjectWorkspaceRoot, projectConfigGrantFingerprint } = scope
  const update = scope.update as (partial: AppSettingsPatch) => void
  const setSkillRoots = scope.setSkillRoots as Dispatch<SetStateAction<SkillRootListItem[]>>
  const memoryRecords = scope.memoryRecords as CoreMemoryRecordJson[]
  const setMemoryRecords = scope.setMemoryRecords as Dispatch<SetStateAction<CoreMemoryRecordJson[]>>
  const diagnosticsRequestSequence = useRef(0)
  const refreshSkillRoots = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkillRoots !== 'function') return
    setSkillRootsLoading(true)
    try {
      // Settings is global: list every configured skill root from persisted
      // settings, not the sidebar's currently selected project workspace.
      const result = await window.kunGui.listSkillRoots()
      if (result.ok) setSkillRoots(result.roots)
    } catch {
      /* listing skill roots is best-effort; keep the last known list */
    } finally {
      setSkillRootsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'agents') return
    void refreshSkillRoots()
  }, [category, refreshSkillRoots])

  const loadMcpConfig = async (): Promise<void> => {
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return
    setMcpLoading(true)
    setMcpNotice(null)
    try {
      const config = await window.kunGui.getKunConfigFile()
      setMcpConfigPath(config.path)
      setMcpConfigText(config.content)
      setMcpConfigExists(config.exists)
      setMcpLoaded(true)
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpLoading(false)
    }
  }

  useEffect(() => {
    if (category !== 'agents' || mcpLoaded || mcpLoading) return
    void loadMcpConfig()
  }, [category, mcpLoaded, mcpLoading])

  const openSkillRoot = async (path: string): Promise<void> => {
    if (!path) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.kunGui?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.kunGui.openSkillRoot(path)
    if (!result.ok) {
      setSkillNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const toggleSkillRoot = (root: SkillRootListItem, enabled: boolean): void => {
    const current: string[] = form?.claw.skills.disabledDirs ?? []
    const keys = new Set([root.disableKey, root.id])
    const nextDisabled = enabled
      ? current.filter((entry) => !keys.has(entry))
      : [...new Set([...current, root.disableKey])]
    update({ claw: { skills: { disabledDirs: nextDisabled } } })
    // Optimistically reflect the toggle so the row responds before the
    // debounced save round-trips; skill counts are unaffected by toggling.
    setSkillRoots((roots) =>
      roots.map((item) =>
        item.id === root.id && item.path === root.path ? { ...item, enabled } : item
      )
    )
  }

  const saveMcpConfig = async (): Promise<void> => {
    if (typeof window.kunGui?.setKunConfigFile !== 'function') return
    setMcpBusy(true)
    setMcpNotice(null)
    try {
      const result = await window.kunGui.setKunConfigFile(mcpConfigText)
      setMcpConfigPath(result.path)
      setMcpConfigExists(true)
      setMcpNotice({
        tone: 'success',
        message: t('mcpSaved', { path: compactHomePath(result.path) })
      })
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpBusy(false)
    }
  }

  const openMcpConfigDir = async (): Promise<void> => {
    if (typeof window.kunGui?.openKunConfigDir !== 'function') return
    const result = await window.kunGui.openKunConfigDir()
    if (!result.ok) {
      setMcpNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const loadProjectConfig = useCallback(async (): Promise<void> => {
    if (!activeProjectWorkspaceRoot || typeof window.kunGui?.getKunProjectConfigFile !== 'function') {
      setProjectConfig(null)
      setProjectConfigText(DEFAULT_PROJECT_CONFIG_TEXT)
      return
    }
    setProjectConfigLoading(true)
    setProjectConfigNotice(null)
    try {
      const result = await window.kunGui.getKunProjectConfigFile(activeProjectWorkspaceRoot)
      setProjectConfig(result)
      setProjectConfigText(result.exists ? result.content : DEFAULT_PROJECT_CONFIG_TEXT)
    } catch (error) {
      setProjectConfigNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setProjectConfigLoading(false)
    }
  }, [activeProjectWorkspaceRoot])

  useEffect(() => {
    if (category !== 'agents') return
    void loadProjectConfig()
  }, [category, loadProjectConfig, projectConfigGrantFingerprint])

  const saveProjectConfig = async (): Promise<void> => {
    if (!activeProjectWorkspaceRoot || typeof window.kunGui?.setKunProjectConfigFile !== 'function') return
    setProjectConfigBusy(true)
    setProjectConfigNotice(null)
    try {
      const result = await window.kunGui.setKunProjectConfigFile(
        activeProjectWorkspaceRoot,
        projectConfigText
      )
      setProjectConfig(result)
      setProjectConfigText(result.content)
      setProjectConfigNotice({
        tone: 'success',
        message: result.trust === 'stale'
          ? t('projectConfigSavedStale')
          : t('projectConfigSaved', { path: compactHomePath(result.path) })
      })
    } catch (error) {
      setProjectConfigNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setProjectConfigBusy(false)
    }
  }

  const syncSettingsAfterProjectTrust = async (): Promise<void> => {
    const saved = coerceRendererSettings(await rendererRuntimeClient.getSettings({ forceRefresh: true }))
    persistedSettingsRef.current = saved
    setForm(saved)
    emitRendererSettingsChanged(saved)
    void reloadUiSettings()
  }

  const setProjectConfigTrust = async (trusted: boolean): Promise<void> => {
    if (!activeProjectWorkspaceRoot || typeof window.kunGui?.setKunProjectConfigTrust !== 'function') return
    if (trusted && projectConfig?.status !== 'valid') return
    setProjectConfigBusy(true)
    setProjectConfigNotice(null)
    try {
      const result = await window.kunGui.setKunProjectConfigTrust(
        activeProjectWorkspaceRoot,
        trusted,
        trusted ? projectConfig?.digest : undefined
      )
      setProjectConfig(result)
      setProjectConfigText(result.exists ? result.content : DEFAULT_PROJECT_CONFIG_TEXT)
      if (trusted ? result.trust !== 'trusted' : result.trust !== 'untrusted') return
      await syncSettingsAfterProjectTrust()
      setProjectConfigNotice({
        tone: 'success',
        message: trusted ? t('projectConfigApproved') : t('projectConfigRevoked')
      })
    } catch (error) {
      setProjectConfigNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setProjectConfigBusy(false)
    }
  }

  const openProjectConfigDir = async (): Promise<void> => {
    if (!activeProjectWorkspaceRoot || typeof window.kunGui?.openKunProjectConfigDir !== 'function') return
    const result = await window.kunGui.openKunProjectConfigDir(activeProjectWorkspaceRoot)
    if (!result.ok) {
      setProjectConfigNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const refreshKunDiagnostics = useCallback(async (): Promise<void> => {
    const requestSequence = diagnosticsRequestSequence.current + 1
    diagnosticsRequestSequence.current = requestSequence
    const provider = getProvider()
    setRuntimeDiagnosticsBusy(true)
    setRuntimeDiagnosticsNotice(null)
    try {
      const loaded = await loadKunDiagnostics(provider, { listAllMemories: true })
      if (requestSequence !== diagnosticsRequestSequence.current) return
      if (loaded.runtimeInfo !== undefined) setRuntimeInfo(loaded.runtimeInfo)
      if (loaded.toolDiagnostics !== undefined) setToolDiagnostics(loaded.toolDiagnostics)
      if (loaded.memoryRecords !== undefined) setMemoryRecords(loaded.memoryRecords)
      if (loaded.errors.length > 0) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: loaded.errors.join(' | ')
        })
      }
    } catch (error) {
      if (requestSequence !== diagnosticsRequestSequence.current) return
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      if (requestSequence === diagnosticsRequestSequence.current) {
        setRuntimeDiagnosticsBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    if (category !== 'agents' && category !== 'laboratory' && category !== 'memory') return
    void refreshKunDiagnostics()
  }, [category, refreshKunDiagnostics])

  useEffect(() => {
    if (category !== 'laboratory' || typeof window === 'undefined') return
    let mounted = true
    let latestGeneration = -1
    let latestPhase: 'idle' | 'syncing' | 'terminal' | null = null

    const invalidateBrowserUseCapability = (): void => {
      // A diagnostics request that started before this generation can only
      // describe the previous runtime configuration.
      diagnosticsRequestSequence.current += 1
      setRuntimeInfo((current: CoreRuntimeInfoJson | null) => {
        if (!current?.capabilities.browserUse) return current
        const capabilities = { ...current.capabilities }
        delete capabilities.browserUse
        return { ...current, capabilities }
      })
    }
    const handleStatus = (next: KunRuntimeSettingsSyncStatusPayload): void => {
      if (!mounted || next.generation < latestGeneration) return
      const terminal = next.state === 'synced' || next.state === 'unavailable' || next.state === 'failed'
      const phase = terminal ? 'terminal' : next.state === 'syncing' ? 'syncing' : 'idle'
      if (next.generation > latestGeneration) {
        latestGeneration = next.generation
        latestPhase = null
      }
      // IPC subscription is installed before the status snapshot resolves.
      // Ignore a delayed snapshot (or duplicate event) that would regress a
      // terminal generation back to syncing.
      if (latestPhase === 'terminal') return
      if (latestPhase === phase) return
      if (latestPhase === 'syncing' && phase === 'idle') return
      latestPhase = phase
      if (phase === 'syncing') {
        invalidateBrowserUseCapability()
      } else if (phase === 'terminal') {
        void refreshKunDiagnostics()
      }
    }

    const unsubscribe = typeof window.kunGui?.onRuntimeSettingsSyncStatus === 'function'
      ? window.kunGui.onRuntimeSettingsSyncStatus(handleStatus)
      : undefined
    if (typeof window.kunGui?.getRuntimeSettingsSyncStatus === 'function') {
      void window.kunGui.getRuntimeSettingsSyncStatus().then(handleStatus).catch(() => undefined)
    }
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [category, refreshKunDiagnostics, setRuntimeInfo])

  const refreshMemoryDiagnostics = async (): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.getMemoryDiagnostics !== 'function') return
    try {
      const diagnostics = await provider.getMemoryDiagnostics()
      setMemoryDiagnostics(diagnostics)
    } catch {
      // best-effort; surfaced via runtimeDiagnosticsNotice elsewhere
    }
  }

  useEffect(() => {
    if (category !== 'memory') return
    void refreshMemoryDiagnostics()
  }, [category, memoryRecords])

  const memoryMutationAccess = useCallback((memoryId: string): { workspace?: string; project?: string } => {
    const record = memoryRecords.find((item) => item.id === memoryId)
    if (!record || record.scope === 'user') return {}
    if (record.scope === 'project') {
      return {
        workspace: record.workspace,
        project: record.project ?? record.workspace
      }
    }
    return { workspace: record.workspace }
  }, [memoryRecords])

  const createMemoryRecord = async (input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    targetPath?: string
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
    type?: CoreMemoryRecordJson['type']
    importance?: number
    observedAt?: string
    validFrom?: string
    validTo?: string
    expiresAt?: string
    disabled?: boolean
    sources?: Array<Omit<NonNullable<CoreMemoryRecordJson['sources']>[number], 'id'> & { id?: string }>
  }): Promise<boolean> => {
    const provider = getProvider()
    if (typeof provider.createMemory !== 'function') return false
    try {
      const targetPath = normalizeWorkspaceRoot(expandHomePath(input.targetPath ?? ''))
      const workspace = normalizeWorkspaceRoot(expandHomePath(input.workspace ?? targetPath))
      const project = normalizeWorkspaceRoot(expandHomePath(input.project ?? targetPath))
      const memory = await provider.createMemory({
        content: input.content,
        scope: input.scope,
        tags: input.tags,
        confidence: input.confidence,
        type: input.type,
        importance: input.importance,
        observedAt: input.observedAt,
        validFrom: input.validFrom,
        validTo: input.validTo,
        expiresAt: input.expiresAt,
        disabled: input.disabled,
        sources: input.sources,
        ...(input.scope === 'user' || !workspace ? {} : { workspace }),
        ...(input.scope === 'project' && project ? { project } : {})
      })
      setMemoryRecords((records) => [memory, ...records])
      return true
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const updateMemoryRecord = async (
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; importance?: number; type?: CoreMemoryRecordJson['type']; disabled?: boolean }
  ): Promise<boolean> => {
    const provider = getProvider()
    if (typeof provider.updateMemory !== 'function') return false
    try {
      const memory = await provider.updateMemory(memoryId, patch, memoryMutationAccess(memoryId))
      setMemoryRecords((records) => records.map((record) => (record.id === memoryId ? memory : record)))
      return true
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const setMemoryRecordDisabled = async (memoryId: string, disabled: boolean): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.updateMemory !== 'function') return
    try {
      const memory = await provider.updateMemory(memoryId, { disabled }, memoryMutationAccess(memoryId))
      setMemoryRecords((records) => records.map((record) => record.id === memoryId ? memory : record))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const disableMemoryRecord = async (memoryId: string): Promise<void> => {
    const confirmed = await confirmDialog(
      t('memoryDisableConfirm'),
      t('memoryDisableConfirmDetail')
    )
    if (!confirmed) return
    await setMemoryRecordDisabled(memoryId, true)
  }

  const restoreMemoryRecord = async (memoryId: string): Promise<void> => {
    await setMemoryRecordDisabled(memoryId, false)
  }

  const deleteMemoryRecord = async (memoryId: string): Promise<void> => {
    const confirmed = await confirmDialog(
      t('memoryDeleteConfirm'),
      t('memoryDeleteConfirmDetail')
    )
    if (!confirmed) return
    const provider = getProvider()
    if (typeof provider.deleteMemory !== 'function') return
    try {
      await provider.deleteMemory(memoryId, memoryMutationAccess(memoryId))
      setMemoryRecords((records) => records.filter((record) => record.id !== memoryId))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const scrollToAgentSection = (target: 'agents' | 'skill' | 'mcp' | 'permissions'): void => {
    const refs = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    refs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return { loadMcpConfig, openSkillRoot, toggleSkillRoot, saveMcpConfig, openMcpConfigDir, loadProjectConfig, saveProjectConfig, setProjectConfigTrust, openProjectConfigDir, refreshKunDiagnostics, createMemoryRecord, updateMemoryRecord, disableMemoryRecord, restoreMemoryRecord, deleteMemoryRecord, scrollToAgentSection }
}
