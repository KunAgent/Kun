import { useMemo } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { harnessRowAvailable, harnessRowRunsTurns, useHarnessStore } from '../../store/harness-store'

/*
 * Dispatchable agents of a manager session: the ready, turn-capable harness
 * rows the manager can hand work to. Terminal-only agents and one-to-one or
 * worker threads never show them. The composer tray surfaces them twice: as
 * the Dispatch segment while the session has no workers yet, and as the
 * footer of the Workers sheet once it does. Both open the Agent Center
 * (Settings > agentsHarnesses), where the dispatchable set is managed.
 */

/** How many names the tray spells out before "+n". */
export const DISPATCHABLE_NAMES_SHOWN = 3

type DispatchThread = Pick<NormalizedThread, 'workspaceMode' | 'executionUnit' | 'harnessId'>

/** A manager session: ADE workspace, not an execution unit, not bound to one harness. */
export function isDispatchManagerThread(
  thread: DispatchThread | null | undefined,
  enabled: boolean
): boolean {
  return enabled === true &&
    thread?.workspaceMode === 'ade' &&
    !thread.executionUnit &&
    !thread.harnessId
}

export function dispatchableAgentNames(rows: readonly AdeHarnessRow[]): string[] {
  return rows
    .filter((row) => harnessRowRunsTurns(row) && harnessRowAvailable(row))
    .map((row) => row.definition.displayName)
}

/** The first names plus how many more there are. */
export function splitDispatchableNames(
  names: readonly string[],
  shown: number = DISPATCHABLE_NAMES_SHOWN
): { shown: string[]; extra: number } {
  const visible = names.slice(0, Math.max(0, shown))
  return { shown: visible, extra: names.length - visible.length }
}

/** "Claude Code · Codex · OpenCode +2" */
export function formatDispatchableNames(
  names: readonly string[],
  shown: number = DISPATCHABLE_NAMES_SHOWN
): string {
  const split = splitDispatchableNames(names, shown)
  return split.shown.join(' · ') + (split.extra > 0 ? ` +${split.extra}` : '')
}

/**
 * Opens the Agent Center ("管理 Agent"): through the composer's own
 * `openSettings` when the render context carries one, else the store's.
 */
export function openAgentCenter(openSettings?: unknown): void {
  if (typeof openSettings === 'function') {
    ;(openSettings as (section: 'agentsHarnesses') => void)('agentsHarnesses')
    return
  }
  useChatStore.getState().openSettings('agentsHarnesses')
}

const NO_NAMES: readonly string[] = []

/**
 * Dispatchable agent names, read only while `active`. The selector returns a
 * joined string, so unrelated harness-row updates (probes, model catalogs)
 * never re-render the tray.
 */
export function useDispatchableAgentNames(active: boolean): readonly string[] {
  const key = useHarnessStore((state) => (active ? dispatchableAgentNames(state.rows).join('\n') : ''))
  return useMemo(() => (key ? key.split('\n') : NO_NAMES), [key])
}
