import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const DesktopInstanceIdentitySchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  execPath: z.string().min(1).max(4_096),
  appPath: z.string().min(1).max(4_096),
  appVersion: z.string().min(1).max(128),
  startedAt: z.string().datetime()
})
export type DesktopInstanceIdentity = z.infer<typeof DesktopInstanceIdentitySchema>

export function desktopInstanceIdentityPath(userDataPath: string): string {
  return join(userDataPath, 'desktop-instance.json')
}

export function canonicalFilePath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return value
  }
}

export function captureDesktopInstanceIdentity(input: {
  pid: number
  execPath: string
  appPath: string
  appVersion: string
  startedAt?: string
}): DesktopInstanceIdentity {
  return DesktopInstanceIdentitySchema.parse({
    version: 1,
    pid: input.pid,
    execPath: input.execPath,
    appPath: input.appPath,
    appVersion: input.appVersion,
    startedAt: input.startedAt ?? new Date().toISOString()
  })
}

export function writeDesktopInstanceIdentity(
  userDataPath: string,
  identity: DesktopInstanceIdentity
): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(desktopInstanceIdentityPath(userDataPath), `${JSON.stringify(identity)}\n`, 'utf8')
}

export function readDesktopInstanceIdentity(userDataPath: string): DesktopInstanceIdentity | null {
  try {
    return DesktopInstanceIdentitySchema.parse(
      JSON.parse(readFileSync(desktopInstanceIdentityPath(userDataPath), 'utf8'))
    )
  } catch {
    return null
  }
}

export type DesktopInstanceLockDecision =
  | { action: 'reuse' }
  | { action: 'conflict'; current: DesktopInstanceIdentity; recorded: DesktopInstanceIdentity }

export function decideDesktopInstanceLock(
  current: DesktopInstanceIdentity,
  recorded: DesktopInstanceIdentity | null
): DesktopInstanceLockDecision {
  if (!recorded) return { action: 'reuse' }
  const samePath = canonicalFilePath(current.execPath) === canonicalFilePath(recorded.execPath)
    && canonicalFilePath(current.appPath) === canonicalFilePath(recorded.appPath)
  if (samePath && current.appVersion === recorded.appVersion) return { action: 'reuse' }
  return { action: 'conflict', current, recorded }
}

export function formatDesktopInstanceConflictMessage(
  current: DesktopInstanceIdentity,
  recorded: DesktopInstanceIdentity
): string {
  return [
    'Kun is already running from a different app path or version.',
    `Running: ${recorded.appVersion} (${recorded.appPath})`,
    `This launch: ${current.appVersion} (${current.appPath})`,
    'Quit the other Kun window, then open this app again. This launch will not start a second workbench.'
  ].join('\n')
}
