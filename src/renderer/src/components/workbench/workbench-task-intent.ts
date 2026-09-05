import { useSyncExternalStore } from 'react'
import type { DesignTaskComposerProfile } from '../chat/FloatingComposerTaskProfile'
import type { ComposerTaskSurface } from '../chat/FloatingComposerTaskSurfacePicker'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { workspaceRootScopeKey } from '../../lib/workspace-path'

export type WorkbenchTaskIntentDraft = {
  surface: ComposerTaskSurface
  profile: DesignTaskComposerProfile
  codeExecution?: {
    mode: 'plan' | 'agent' | 'auto'
    orchestration: 'direct' | 'graph'
  }
}

const TASK_DRAFT_STORAGE_KEY = 'kun.composer.taskDraft.v1'
export const DEFAULT_WORKBENCH_DESIGN_PROFILE: DesignTaskComposerProfile = {
  outputMedium: 'html',
  target: 'web',
  preset: 'none'
}

let revision = 0
const listeners = new Set<() => void>()

export function workbenchTaskIntentScope(
  threadId: string | null,
  workspaceRoot: string
): string {
  return threadId
    ? `thread:${threadId}`
    : `workspace:${workspaceRootScopeKey(workspaceRoot)}`
}

function readDrafts(): Record<string, WorkbenchTaskIntentDraft> {
  try {
    const raw = readBrowserStorageItem(TASK_DRAFT_STORAGE_KEY)
    return raw ? JSON.parse(raw) as Record<string, WorkbenchTaskIntentDraft> : {}
  } catch {
    return {}
  }
}

export function hasWorkbenchTaskIntent(scope: string): boolean {
  const draft = readDrafts()[scope]
  return Boolean(draft && (draft.surface === 'code' || draft.surface === 'design'))
}

export function readWorkbenchTaskIntent(
  scope: string,
  _workspaceRoot: string
): WorkbenchTaskIntentDraft {
  const drafts = readDrafts()
  const draft = drafts[scope]
  if (!draft || (draft.surface !== 'code' && draft.surface !== 'design')) {
    return { surface: 'code', profile: DEFAULT_WORKBENCH_DESIGN_PROFILE }
  }
  return {
    surface: draft.surface,
    profile: { ...DEFAULT_WORKBENCH_DESIGN_PROFILE, ...draft.profile },
    ...(draft.codeExecution ? { codeExecution: { ...draft.codeExecution } } : {})
  }
}

export function writeWorkbenchTaskIntent(
  scope: string,
  draft: WorkbenchTaskIntentDraft
): void {
  const drafts = readDrafts()
  drafts[scope] = {
    surface: draft.surface,
    profile: { ...draft.profile },
    ...(draft.codeExecution ? { codeExecution: { ...draft.codeExecution } } : {})
  }
  writeBrowserStorageItem(TASK_DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  revision += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWorkbenchTaskIntent(
  scope: string,
  workspaceRoot: string
): WorkbenchTaskIntentDraft {
  useSyncExternalStore(subscribe, () => revision, () => revision)
  return readWorkbenchTaskIntent(scope, workspaceRoot)
}
