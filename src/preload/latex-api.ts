import { ipcRenderer } from 'electron'
import type { KunGuiLatexApi } from '../shared/latex-project'

export const latexApi: KunGuiLatexApi = {
  latexToolchainStatus: (input) => ipcRenderer.invoke('latex:toolchain-status', input),
  latexInstallTools: () => ipcRenderer.invoke('latex:install-tools', {}),
  latexCancelToolInstall: (input) => ipcRenderer.invoke('latex:cancel-tool-install', input),
  latexChooseToolDirectory: () => ipcRenderer.invoke('latex:choose-tool-directory', {}),
  onLatexToolchainState: (handler) => {
    const wrapped = (_: Electron.IpcRendererEvent, state: Parameters<typeof handler>[0]) => handler(state)
    ipcRenderer.on('latex:toolchain-state', wrapped)
    return () => ipcRenderer.removeListener('latex:toolchain-state', wrapped)
  },
  latexReadProject: (input) => ipcRenderer.invoke('latex:read-project', input),
  latexConfigure: (input) => ipcRenderer.invoke('latex:configure', input),
  latexCreate: (input) => ipcRenderer.invoke('latex:create', input),
  latexImport: (input) => ipcRenderer.invoke('latex:import', input),
  latexReadSource: (input) => ipcRenderer.invoke('latex:read-source', input),
  latexSave: (input) => ipcRenderer.invoke('latex:save', input),
  latexDetectTools: (input) => ipcRenderer.invoke('latex:detect-tools', input),
  latexPickTools: (input) => ipcRenderer.invoke('latex:pick-tools', input),
  latexBuild: (input) => ipcRenderer.invoke('latex:build', input),
  latexAbortBuild: (input) => ipcRenderer.invoke('latex:abort-build', input),
  latexReadPdf: (input) => ipcRenderer.invoke('latex:read-pdf', input),
  latexSync: (input) => ipcRenderer.invoke('latex:sync', input),
  latexProposeFix: (input) => ipcRenderer.invoke('latex:propose-fix', input),
  latexExport: (input) => ipcRenderer.invoke('latex:export', input),
  onLatexBuildLog: (handler) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: Parameters<typeof handler>[0]) => handler(event)
    ipcRenderer.on('latex:build-log', wrapped)
    return () => ipcRenderer.removeListener('latex:build-log', wrapped)
  }
}
