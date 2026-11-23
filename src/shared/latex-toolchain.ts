import type { LatexEngine, LatexResult, LatexTools } from './latex-project'

export type LatexInstallPhase = 'idle' | 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'configuring' | 'ready' | 'failed' | 'cancelled'
export type LatexToolchainState = {
  jobId: string | null
  phase: LatexInstallPhase
  version: string | null
  downloadedBytes: number
  totalBytes: number
  log: string
  error: string | null
}
export const latexInstallationActive = (phase: LatexInstallPhase): boolean =>
  ['resolving', 'downloading', 'verifying', 'extracting', 'configuring'].includes(phase)

export type LatexToolchainStatus = {
  state: LatexToolchainState
  tools: LatexTools
  platform: string
  supported: boolean
  installRoot: string
}
export type KunGuiLatexToolchainApi = {
  latexToolchainStatus: (input: { engine: LatexEngine; toolDirectory?: string }) => Promise<LatexResult<LatexToolchainStatus>>
  latexInstallTools: () => Promise<LatexResult<{ state: LatexToolchainState }>>
  latexCancelToolInstall: (input: { jobId: string }) => Promise<LatexResult<Record<never, never>>>
  latexChooseToolDirectory: () => Promise<LatexResult<{ toolDirectory?: string; canceled?: boolean }>>
  onLatexToolchainState: (handler: (state: LatexToolchainState) => void) => () => void
}
