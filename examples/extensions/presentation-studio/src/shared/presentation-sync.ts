export type PresentationChangeSource = 'command' | 'tool'

export type PresentationChangeAction = 'ignore' | 'refresh-current' | 'follow-tool'

export interface PresentationChangeState {
  hasProject: boolean
  activePath: string
  currentRevision: number
  changePath: string
  changeRevision: number
  source: PresentationChangeSource
}

export interface PresentationFileCandidate {
  path: string
  modifiedAt: string
}

const PRESENTATION_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.kun-ppt\.html$/u

export function decidePresentationChange(state: PresentationChangeState): PresentationChangeAction {
  if (state.source === 'tool' && (!state.hasProject || state.changePath !== state.activePath)) {
    return 'follow-tool'
  }
  if (
    !state.hasProject ||
    state.changePath !== state.activePath ||
    state.changeRevision <= state.currentRevision
  ) {
    return 'ignore'
  }
  return 'refresh-current'
}

export function presentationPathsFromWorkspaceEntries(
  entries: readonly Record<string, unknown>[]
): string[] {
  return entries.flatMap((entry) =>
    entry.type === 'file' &&
    typeof entry.name === 'string' &&
    entry.name.length <= 240 &&
    PRESENTATION_PATH_PATTERN.test(entry.name)
      ? [entry.name]
      : [])
}

export function latestPresentationPath(
  candidates: readonly PresentationFileCandidate[]
): string | undefined {
  return [...candidates]
    .filter(({ path }) => path.length <= 240 && PRESENTATION_PATH_PATTERN.test(path))
    .sort((left, right) => {
      const modified = Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt)
      return Number.isFinite(modified) && modified !== 0
        ? modified
        : left.path.localeCompare(right.path)
    })[0]?.path
}
