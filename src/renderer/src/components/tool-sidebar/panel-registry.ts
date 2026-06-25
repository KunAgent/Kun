import type { LucideIcon } from 'lucide-react'
import {
  ClipboardList,
  FileEdit,
  FolderOpen,
  Folders,
  Globe2,
  ListTodo,
  Terminal
} from 'lucide-react'
import type { PanelType } from './tool-sidebar-store'

export type PanelMeta = {
  type: PanelType
  labelKey: string
  icon: LucideIcon
  closable: boolean
  showInAddMenu: boolean
}

const PANEL_META: Record<PanelType, PanelMeta> = {
  todo: {
    type: 'todo',
    labelKey: 'rightPanelTodo',
    icon: ListTodo,
    closable: true,
    showInAddMenu: true
  },
  plan: {
    type: 'plan',
    labelKey: 'rightPanelPlan',
    icon: ClipboardList,
    closable: true,
    showInAddMenu: false
  },
  changes: {
    type: 'changes',
    labelKey: 'rightPanelChanges',
    icon: FileEdit,
    closable: true,
    showInAddMenu: true
  },
  browser: {
    type: 'browser',
    labelKey: 'rightPanelBrowser',
    icon: Globe2,
    closable: true,
    showInAddMenu: true
  },
  file: {
    type: 'file',
    labelKey: 'rightPanelFiles',
    icon: FolderOpen,
    closable: true,
    showInAddMenu: false
  },
  terminal: {
    type: 'terminal',
    labelKey: 'rightPanelTerminal',
    icon: Terminal,
    closable: true,
    showInAddMenu: true
  },
  files: {
    type: 'files',
    labelKey: 'rightPanelFilesTree',
    icon: Folders,
    closable: true,
    showInAddMenu: true
  },
  'sdd-ai': {
    type: 'sdd-ai',
    labelKey: 'rightPanelSddAssistant',
    icon: FileEdit,
    closable: true,
    showInAddMenu: false
  }
}

export function getPanelMeta(type: PanelType): PanelMeta {
  return PANEL_META[type]
}

export function getAddMenuPanels(): PanelMeta[] {
  return Object.values(PANEL_META).filter((meta) => meta.showInAddMenu)
}
