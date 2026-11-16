import { useEffect } from 'react'
import { create } from 'zustand'
import type {
  ColabAccelerator,
  ColabConnectionView,
  ColabSessionView,
  ColabStateSnapshot
} from '@shared/colab/colab-types'

export const OPEN_COLAB_PANEL_EVENT = 'kun:open-colab-panel'

export type OpenColabPanelOptions = {
  expandConnections?: boolean
  openAddAccount?: boolean
  openRunDialog?: boolean
  focusSessionId?: string
}

export function openColabPanel(options?: OpenColabPanelOptions): void {
  const store = useColabStore.getState()
  if (options?.expandConnections || options?.openAddAccount) {
    store.setConnectionsExpanded(true)
  }
  if (options?.openAddAccount) {
    store.openAddAccount()
  }
  if (options?.openRunDialog) {
    store.openRunDialog()
  }
  if (options?.focusSessionId) {
    store.setFocusedSessionId(options.focusSessionId)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_COLAB_PANEL_EVENT, { detail: options ?? {} }))
  }
}

export function normalizeColabWorkspaceKey(workspaceRoot: string | undefined | null): string {
  return (workspaceRoot ?? '').trim().replace(/[\\/]+$/, '')
}

export function isColabSessionRunning(session: ColabSessionView): boolean {
  return ['provisioning', 'uploading', 'installing', 'running', 'disconnected'].includes(
    session.phase
  )
}

export function selectWorkspaceActiveConnection(
  snapshot: ColabStateSnapshot,
  workspaceRoot: string | undefined
): ColabConnectionView | null {
  const key = normalizeColabWorkspaceKey(workspaceRoot)
  const explicitId = key ? snapshot.workspaceConnections[key] : undefined
  if (explicitId) {
    const matched = snapshot.connections.find((c) => c.id === explicitId)
    if (matched) return matched
  }
  return snapshot.connections.find((c) => c.status === 'connected') ?? snapshot.connections[0] ?? null
}

export function selectWorkspaceSessions(
  snapshot: ColabStateSnapshot,
  workspaceRoot: string | undefined
): ColabSessionView[] {
  const key = normalizeColabWorkspaceKey(workspaceRoot)
  if (!key) return snapshot.sessions
  return snapshot.sessions.filter((s) => normalizeColabWorkspaceKey(s.workspaceRoot) === key)
}

export function selectAllRunningSessions(snapshot: ColabStateSnapshot): ColabSessionView[] {
  return snapshot.sessions.filter(isColabSessionRunning)
}

export function formatColabDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatColabBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export type ColabToastAction = {
  label: string
  run: () => void
}

export type ColabPanelToast = {
  id: number
  text: string
  action?: ColabToastAction
}

const HIGHLIGHT_MS = 2_000

const EMPTY_SNAPSHOT: ColabStateSnapshot = {
  cli: { state: 'missing', version: null, pythonVersion: null, venvPath: '' },
  connections: [],
  workspaceConnections: {},
  oauthPending: null,
  lastLoginOutcome: null,
  sessions: [],
  untrackedSessions: [],
  lastRunsByWorkspace: {}
}

type ColabStoreState = {
  snapshot: ColabStateSnapshot
  hydrated: boolean
  connectionsExpanded: boolean
  addAccountOpen: boolean
  reauthConnectionId: string | null
  newlyCreatedConnectionId: string | null
  highlightedConnectionId: string | null
  pendingSwitchTargetId: string | null
  runDialogOpen: boolean
  runDialogAcceleratorOverride: ColabAccelerator | null
  focusedSessionId: string | null
  toast: ColabPanelToast | null
  applySnapshot: (snapshot: ColabStateSnapshot) => void
  refreshSnapshot: () => Promise<void>
  setConnectionsExpanded: (expanded: boolean) => void
  openAddAccount: (reauthConnectionId?: string) => void
  closeAddAccount: () => void
  highlightConnection: (connectionId: string) => void
  setPendingSwitchTargetId: (connectionId: string | null) => void
  openRunDialog: (accelerator?: ColabAccelerator) => void
  closeRunDialog: () => void
  setFocusedSessionId: (sessionId: string | null) => void
  showToast: (text: string, action?: ColabToastAction) => void
  dismissToast: () => void
}

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null
let subscribedUnsub: (() => void) | null = null

// The "new" badge and row highlight are transient confirmation cues, not state.
function scheduleHighlightReset(): void {
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    useColabStore.setState({ newlyCreatedConnectionId: null, highlightedConnectionId: null })
  }, HIGHLIGHT_MS)
}

export const useColabStore = create<ColabStoreState>((set) => ({
  snapshot: EMPTY_SNAPSHOT,
  hydrated: false,
  connectionsExpanded: false,
  addAccountOpen: false,
  reauthConnectionId: null,
  newlyCreatedConnectionId: null,
  highlightedConnectionId: null,
  pendingSwitchTargetId: null,
  runDialogOpen: false,
  runDialogAcceleratorOverride: null,
  focusedSessionId: null,
  toast: null,
  applySnapshot: (nextSnapshot) =>
    set((state) => {
      const outcome = nextSnapshot.lastLoginOutcome
      let newlyCreatedConnectionId = state.newlyCreatedConnectionId
      let highlightedConnectionId = state.highlightedConnectionId
      let addAccountOpen = state.addAccountOpen
      let reauthConnectionId = state.reauthConnectionId
      if (outcome && outcome.ok) {
        addAccountOpen = false
        reauthConnectionId = null
        if (outcome.kind === 'created' && newlyCreatedConnectionId !== outcome.connection.id) {
          newlyCreatedConnectionId = outcome.connection.id
          highlightedConnectionId = outcome.connection.id
          scheduleHighlightReset()
        }
      }
      return {
        snapshot: nextSnapshot,
        hydrated: true,
        addAccountOpen,
        reauthConnectionId,
        newlyCreatedConnectionId,
        highlightedConnectionId
      }
    }),
  refreshSnapshot: async () => {
    if (typeof window === 'undefined' || typeof window.kunGui?.colabGetSnapshot !== 'function') {
      return
    }
    try {
      const snap = await window.kunGui.colabGetSnapshot()
      useColabStore.getState().applySnapshot(snap)
    } catch {
      // Ignore snapshot fetch failure when host is unavailable.
    }
  },
  setConnectionsExpanded: (connectionsExpanded) => set({ connectionsExpanded }),
  openAddAccount: (reauthConnectionId) =>
    set({
      connectionsExpanded: true,
      addAccountOpen: true,
      reauthConnectionId: reauthConnectionId ?? null
    }),
  closeAddAccount: () => set({ addAccountOpen: false, reauthConnectionId: null }),
  highlightConnection: (connectionId) => {
    set({ connectionsExpanded: true, highlightedConnectionId: connectionId })
    scheduleHighlightReset()
  },
  setPendingSwitchTargetId: (pendingSwitchTargetId) => set({ pendingSwitchTargetId }),
  openRunDialog: (accelerator) =>
    set({
      runDialogOpen: true,
      runDialogAcceleratorOverride: accelerator ?? null
    }),
  closeRunDialog: () => set({ runDialogOpen: false, runDialogAcceleratorOverride: null }),
  setFocusedSessionId: (focusedSessionId) => set({ focusedSessionId }),
  showToast: (text, action) => {
    toastSeq += 1
    const id = toastSeq
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { id, text, ...(action ? { action } : {}) } })
    toastTimer = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : s))
    }, 5_000)
  },
  dismissToast: () => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: null })
  }
}))

export function ensureColabSubscription(): void {
  if (subscribedUnsub || typeof window === 'undefined') return
  const api = window.kunGui
  if (!api || typeof api.onColabStateChanged !== 'function') return
  subscribedUnsub = api.onColabStateChanged((snapshot) => {
    useColabStore.getState().applySnapshot(snapshot)
  })
  void useColabStore.getState().refreshSnapshot()
}

export function useColabSubscription(): void {
  useEffect(() => {
    ensureColabSubscription()
  }, [])
}
