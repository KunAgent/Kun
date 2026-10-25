/**
 * Terminal-dock helpers beyond the PTY lifecycle: detected shells, the
 * foreground process of a session (close confirmation) and opening the
 * operating system's own terminal at a directory.
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { IpcMain } from 'electron'
import { z } from 'zod'
import { TERMINAL_MAX_CWD_LENGTH, TERMINAL_MAX_SESSION_ID_LENGTH } from '../../shared/terminal'
import { detectTerminalShells } from './terminal-shell-integration'
import type { TerminalPtyController } from './terminal-pty-ipc'

const sessionIdSchema = z.string().trim().min(1).max(TERMINAL_MAX_SESSION_ID_LENGTH)
const cwdSchema = z.string().trim().min(1).max(TERMINAL_MAX_CWD_LENGTH)

type SystemTerminalCommand = { file: string; args: string[] }

/** Candidate commands that open a native terminal window at `cwd`. */
export function systemTerminalCommands(cwd: string, platform: NodeJS.Platform = process.platform): SystemTerminalCommand[] {
  if (platform === 'darwin') return [{ file: 'open', args: ['-a', 'Terminal', cwd] }]
  if (platform === 'win32') {
    return [
      { file: 'wt.exe', args: ['-d', cwd] },
      { file: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/K', `cd /d "${cwd.replace(/"/g, '')}"`] }
    ]
  }
  return [
    { file: 'x-terminal-emulator', args: ['--working-directory', cwd] },
    { file: 'gnome-terminal', args: ['--working-directory', cwd] },
    { file: 'konsole', args: ['--workdir', cwd] },
    { file: 'xterm', args: [] }
  ]
}

function launchDetached(command: SystemTerminalCommand, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command.file, command.args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

export async function openSystemTerminal(cwd: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (!isAbsolute(cwd)) return false
  try {
    if (!statSync(cwd).isDirectory()) return false
  } catch {
    return false
  }
  for (const command of systemTerminalCommands(cwd, platform)) {
    if (await launchDetached(command, cwd)) return true
  }
  return false
}

export function registerTerminalDockIpc(ipcMain: IpcMain, controller: TerminalPtyController): void {
  ipcMain.handle('terminal:shells', () => detectTerminalShells())
  ipcMain.handle('terminal:process-info', (_event, sessionId: unknown) =>
    controller.processInfo(sessionIdSchema.parse(sessionId)))
  ipcMain.handle('terminal:open-system', (_event, cwd: unknown) => openSystemTerminal(cwdSchema.parse(cwd)))
}
