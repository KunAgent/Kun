import { useSyncExternalStore } from 'react'
import type {
  DailyNoteDockPayload,
  DailyNoteLinkSummary,
  DailyNoteSendRequest,
  DailyNoteSendResult,
  DailyNoteStartThreadRequest,
  DailyNoteStartThreadResult,
  DailyNoteTargetsSnapshot,
  DailyNoteViewMode
} from '@shared/daily-notes'

const STORAGE_KEY = 'kun.dailyNotes.dock.v1'
const MIN_WIDTH = 288
const MAX_WIDTH = 540
const DEFAULT_WIDTH = 368

export type DailyNotesDockState = {
  open: boolean
  width: number
  preferDocked: boolean
  targetDay: string | null
  targetViewMode: DailyNoteViewMode | null
  focusNonce: number
}

export type DailyNotesInProcessHandlers = {
  sendToKun: (request: DailyNoteSendRequest) => Promise<DailyNoteSendResult>
  startThread: (request: DailyNoteStartThreadRequest) => Promise<DailyNoteStartThreadResult>
  listTargets: () => Promise<DailyNoteTargetsSnapshot>
  openLink: (url: string) => Promise<boolean>
  watchLinks: (urls: string[]) => Promise<Record<string, DailyNoteLinkSummary>>
}

function clampWidth(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, num))
}

function loadInitialState(): DailyNotesDockState {
  if (typeof window === 'undefined') {
    return { open: false, width: DEFAULT_WIDTH, preferDocked: false, targetDay: null, targetViewMode: null, focusNonce: 0 }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { open: false, width: DEFAULT_WIDTH, preferDocked: false, targetDay: null, targetViewMode: null, focusNonce: 0 }
    }
    const parsed = JSON.parse(raw) as Partial<DailyNotesDockState>
    return {
      open: parsed.open === true,
      width: clampWidth(parsed.width),
      preferDocked: parsed.preferDocked === true,
      targetDay: null,
      targetViewMode: null,
      focusNonce: 0
    }
  } catch {
    return { open: false, width: DEFAULT_WIDTH, preferDocked: false, targetDay: null, targetViewMode: null, focusNonce: 0 }
  }
}

let dockState: DailyNotesDockState = loadInitialState()
const listeners = new Set<() => void>()
const summaryListeners = new Set<(summaries: Record<string, DailyNoteLinkSummary>) => void>()
let inProcessHandlers: DailyNotesInProcessHandlers | null = null

function persistState(state: DailyNotesDockState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      open: state.open,
      width: state.width,
      preferDocked: state.preferDocked
    }))
  } catch { /* ignore storage quota errors */ }
}

function emitDockState(): void {
  for (const listener of listeners) listener()
}

export function getDailyNotesDockState(): DailyNotesDockState {
  return dockState
}

export function useDailyNotesDockState(): DailyNotesDockState {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getDailyNotesDockState,
    getDailyNotesDockState
  )
}

export function openDockedDailyNotes(payload?: DailyNoteDockPayload): void {
  dockState = {
    ...dockState,
    open: true,
    preferDocked: true,
    targetDay: payload?.day ?? dockState.targetDay,
    targetViewMode: payload?.viewMode ?? dockState.targetViewMode,
    focusNonce: dockState.focusNonce + 1
  }
  persistState(dockState)
  emitDockState()
}

export function closeDockedDailyNotes(): void {
  if (!dockState.open) return
  dockState = { ...dockState, open: false, targetDay: null, targetViewMode: null }
  persistState(dockState)
  emitDockState()
}

export function setDailyNotesDockWidth(width: number): void {
  const clamped = clampWidth(width)
  if (clamped === dockState.width) return
  dockState = { ...dockState, width: clamped }
  persistState(dockState)
  emitDockState()
}

export async function popoutDockedDailyNotes(): Promise<void> {
  dockState = { ...dockState, open: false, preferDocked: false, targetDay: null, targetViewMode: null }
  persistState(dockState)
  emitDockState()
  await window.kunGui?.openDailyNotes?.()
}

export async function triggerDailyNotesEntry(mode: 'open' | 'toggle' = 'open'): Promise<void> {
  if (typeof window === 'undefined' || !window.kunGui || window.kunGui.isRemoteWeb) return
  if (dockState.open) {
    if (mode === 'toggle') {
      closeDockedDailyNotes()
    } else {
      openDockedDailyNotes()
    }
    return
  }
  if (dockState.preferDocked) {
    await window.kunGui.dailyNotes?.closeWindow?.().catch(() => undefined)
    openDockedDailyNotes()
    return
  }
  if (mode === 'toggle' && typeof window.kunGui.dailyNotes?.toggleWindow === 'function') {
    await window.kunGui.dailyNotes.toggleWindow()
    return
  }
  await window.kunGui.openDailyNotes()
}

export function registerDailyNotesInProcessHandlers(handlers: DailyNotesInProcessHandlers | null): () => void {
  inProcessHandlers = handlers
  return () => {
    if (inProcessHandlers === handlers) inProcessHandlers = null
  }
}

export function getDailyNotesInProcessHandlers(): DailyNotesInProcessHandlers | null {
  return inProcessHandlers
}

export function publishDockedDailyNoteSummaries(summaries: Record<string, DailyNoteLinkSummary>): void {
  for (const listener of summaryListeners) listener(summaries)
}

export function subscribeDockedDailyNoteSummaries(
  listener: (summaries: Record<string, DailyNoteLinkSummary>) => void
): () => void {
  summaryListeners.add(listener)
  return () => { summaryListeners.delete(listener) }
}
