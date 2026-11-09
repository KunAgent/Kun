import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { access } from 'node:fs/promises'
import { installerRecoveryIdentity, trustedCommonRecoveryFile } from './installer-recovery-identity'
import { encodePowershellCommand, powershellHelperDeadline } from './one-shot-helper-script'

export type PrivilegedUpdateMatch = { oldVersion: string; newVersion: string; installDir?: string }
export type PrivilegedUpdateRequest = PrivilegedUpdateMatch & {
  operation: 'inspect' | 'finalize'; nonce: string; appGuid: string; executable: string;
  productName: string; scope: 'all'; target: string; pendingResult: string; runningVersion: string
}
export type PrivilegedUpdateReply = { request: PrivilegedUpdateRequest; outcome: 'inspected' | 'finalized'; transaction: Record<string, unknown> }

/** No result files: both a fresh capability response and the actual RunAs exit are required. */
export async function privilegedUpdateOperation(
  operation: PrivilegedUpdateRequest['operation'], match: PrivilegedUpdateMatch,
  deps: { spawnHelper?: typeof spawn; timeoutMs?: number } = {}
): Promise<PrivilegedUpdateReply> {
  const identity = installerRecoveryIdentity()
  if (!app.isPackaged || !match.oldVersion || !match.newVersion || !match.installDir) throw new Error('Packaged update identity is required.')
  const target = win32.dirname(identity.executable)
  const root = win32.join(target, 'resources', 'installer-recovery')
  const script = win32.join(root, 'windows-installer-migration-privileged.ps1')
  // Never elevate a script selected by a recovery record or the working directory.
  if (!await trustedCommonRecoveryFile(target, identity.executable) ||
      !await trustedCommonRecoveryFile(win32.join(target, 'resources'), root)) {
    throw new Error('The all-users application installation is not immutable.')
  }
  await access(script)
  for (const name of ['privileged', 'paths', 'journal', 'filesystem', 'actions', 'recovery-env', 'transaction']) {
    if (!await trustedCommonRecoveryFile(root, win32.join(root, `windows-installer-migration-${name}.ps1`))) {
      throw new Error('Privileged updater scripts are not administrator-owned and immutable.')
    }
  }
  const request: PrivilegedUpdateRequest = { ...match, ...identity, operation, nonce: randomUUID(), scope: 'all', target,
    pendingResult: join(app.getPath('userData'), 'pending-update-result.json'), runningVersion: app.getVersion() }
  const pipeName = `kun-update-operation-${randomUUID()}`
  // Darwin Unix sockets have a short path limit; retain the full UUID entropy without the long pipe prefix.
  const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}`
    : join(tmpdir(), `ku-${pipeName.slice('kun-update-operation-'.length).replaceAll('-', '')}.sock`)
  const token = randomUUID()
  const sockets = new Set<Socket>()
  let child: ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let complete!: (reply: PrivilegedUpdateReply) => void
  let fail!: (error: Error) => void
  const response = new Promise<PrivilegedUpdateReply>((resolve, reject) => { complete = resolve; fail = reject })
  void response.catch(() => undefined)
  const server = createServer((socket) => {
    sockets.add(socket)
    let data = ''
    socket.setEncoding('utf8')
    socket.on('error', fail)
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', (chunk: string) => {
      data += chunk
      if (data.length > 1_000_000) { fail(new Error('Oversized privileged update response.')); return }
      if (!data.includes('\n')) return
      try {
        const value = JSON.parse(data.slice(0, data.indexOf('\n')))
        const expected = operation === 'inspect' ? 'inspected' : 'finalized'
        const same = (actual: unknown, expectedPath: string | undefined) => typeof actual === 'string' &&
          Boolean(expectedPath) && win32.normalize(actual).toLowerCase() === win32.normalize(expectedPath!).toLowerCase()
        const oldPayload = ['prepared', 'rolled_back'].includes(value.transaction?.Phase)
        const canonicalTarget = win32.join(win32.dirname(request.installDir!), request.productName)
        if (value.token !== token || value.outcome !== expected || !value.transaction ||
            value.transaction.SchemaVersion !== 4 || value.transaction.AppGuid !== request.appGuid ||
            value.transaction.InstallMode !== 'all' || value.transaction.OldVersion !== request.oldVersion ||
            value.transaction.NewVersion !== request.newVersion || !same(value.transaction.Source, request.installDir) ||
            !same(oldPayload ? value.transaction.Source : value.transaction.Target, request.target) ||
            request.runningVersion !== (oldPayload ? request.oldVersion : request.newVersion) ||
            (!same(value.transaction.Target, request.installDir) && !same(value.transaction.Target, canonicalTarget)) ||
            Object.keys(request).some((key) => value.request?.[key] !== request[key as keyof PrivilegedUpdateRequest]) ||
            Object.keys(value.request ?? {}).length !== Object.keys(request).length) throw new Error('Unbound privileged update response.')
        complete(value)
        socket.end()
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipePath, resolve) })
    server.on('error', fail)
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Privileged update operation timed out.')), deps.timeoutMs ?? 45_000)
    })
    void deadline.catch(() => undefined)
    const quote = (value: string) => `'${value.replace(/'/gu, "''")}'`
    const encodedRequest = Buffer.from(JSON.stringify(request)).toString('base64')
    const coordinator = `${powershellHelperDeadline()}\n& ${quote(script)} -RequestBase64 '${encodedRequest}' -PipeName '${pipeName}' -Token '${token}'\nexit $LASTEXITCODE`
    const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const command = `${powershellHelperDeadline()}\n$p=Start-Process -FilePath ${quote(powershell)} -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodePowershellCommand(coordinator)}' -ErrorAction Stop\n$null=$p.Handle\n$p.WaitForExit()\nif ($null -eq $p.ExitCode) { exit 1 }; exit $p.ExitCode`
    child = (deps.spawnHelper ?? spawn)(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowershellCommand(command)],
      { windowsHide: true, stdio: 'ignore', detached: false })
    const exited = new Promise<void>((resolve, reject) => {
      child!.once('error', reject)
      child!.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Privileged update launcher exited with ${code}.`)))
    })
    void exited.catch((error) => fail(error))
    const [reply] = await Promise.race([Promise.all([response, exited]), deadline])
    return reply
  } finally {
    if (timer) clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
    server.close()
    child?.kill()
  }
}
