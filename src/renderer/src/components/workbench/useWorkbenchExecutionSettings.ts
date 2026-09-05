import { useCallback, useEffect, useState } from 'react'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import type { ComposerExecutionSettings } from '../chat/FloatingComposer'

type UseWorkbenchExecutionSettingsInput = {
  setError: (message: string | null) => void
  onSettingsUpdated: () => void
}

export function useWorkbenchExecutionSettings({
  setError,
  onSettingsUpdated
}: UseWorkbenchExecutionSettingsInput) {
  const [composerExecutionSettings, setComposerExecutionSettings] =
    useState<ComposerExecutionSettings | null>(null)
  const [composerExecutionApplying, setComposerExecutionApplying] = useState(false)
  const setStoreComposerExecutionSettings = useChatStore((s) => s.setComposerExecutionSettings)

  // Mirror every settled execution-settings value into the chat store so the
  // send path can freeze the composer state at enqueue time. Null (before the
  // first load) keeps sends on the runtime defaults.
  const syncStoreExecutionSettings = useCallback((settings: ComposerExecutionSettings | null): void => {
    setStoreComposerExecutionSettings(settings)
  }, [setStoreComposerExecutionSettings])

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient.getSettings()
      .then((settings) => {
        if (cancelled) return
        const loaded: ComposerExecutionSettings = {
          approvalPolicy: settings.agents.kun.approvalPolicy,
          sandboxMode: settings.agents.kun.sandboxMode,
          approvalReviewer: settings.agents.kun.approvalReviewer
        }
        setComposerExecutionSettings(loaded)
        syncStoreExecutionSettings(loaded)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [syncStoreExecutionSettings])

  const updateComposerExecutionSettings = useCallback((patch: Partial<ComposerExecutionSettings>): void => {
    if (!composerExecutionSettings || composerExecutionApplying) return
    const previous = composerExecutionSettings
    const next = { ...previous, ...patch }
    setComposerExecutionSettings(next)
    setComposerExecutionApplying(true)
    void rendererRuntimeClient.setSettings({
      agents: {
        kun: {
          ...(patch.approvalPolicy ? { approvalPolicy: patch.approvalPolicy as ApprovalPolicy } : {}),
          ...(patch.sandboxMode ? { sandboxMode: patch.sandboxMode as SandboxMode } : {}),
          ...(patch.approvalReviewer
            ? { approvalReviewer: patch.approvalReviewer as ApprovalReviewer }
            : {})
        }
      }
    }).then((settings) => {
      const saved: ComposerExecutionSettings = {
        approvalPolicy: settings.agents.kun.approvalPolicy,
        sandboxMode: settings.agents.kun.sandboxMode,
        approvalReviewer: settings.agents.kun.approvalReviewer
      }
      setComposerExecutionSettings(saved)
      syncStoreExecutionSettings(saved)
      onSettingsUpdated()
    }).catch((error: unknown) => {
      setComposerExecutionSettings(previous)
      syncStoreExecutionSettings(previous)
      setError(error instanceof Error ? error.message : String(error))
    }).finally(() => setComposerExecutionApplying(false))
  }, [composerExecutionApplying, composerExecutionSettings, onSettingsUpdated, setError, syncStoreExecutionSettings])

  return {
    composerExecutionSettings,
    composerExecutionApplying,
    updateComposerExecutionSettings
  }
}
