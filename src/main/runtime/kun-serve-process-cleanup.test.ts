import { describe, expect, it, vi } from 'vitest'
import {
  PROCESS_TABLE_TIMEOUT_MS,
  WINDOWS_PROCESS_CANDIDATE_SCRIPT,
  clearHistoricalKunServeProcesses,
  inspectCurrentUserProcess,
  listCurrentUserProcesses,
  looksLikeKunServeCommand,
  looksLikeKunServeProcess,
  parseUnixProcessSnapshot,
  parseWindowsProcessSnapshot,
  windowsCurrentUserProcessScript,
  type KunServeProcessSnapshot
} from './kun-serve-process-cleanup'

describe('Kun serve process snapshot parsing', () => {
  it('keeps only current-UID Unix processes and their full commands', () => {
    const stdout = [
      '  101     1   501 /usr/local/bin/node /old/serve-entry.js serve --port 18899',
      '  102     1   502 /usr/local/bin/node /other/serve-entry.js serve --port 18898',
      '  bad row',
      '  103   101   501 kun-runtime'
    ].join('\n')

    expect(parseUnixProcessSnapshot(stdout, 501)).toEqual([
      {
        pid: 101,
        parentPid: 1,
        command: '/usr/local/bin/node /old/serve-entry.js serve --port 18899'
      },
      { pid: 103, parentPid: 101, command: 'kun-runtime' }
    ])
  })

  it('accepts both one-object and array-shaped Windows JSON', () => {
    expect(parseWindowsProcessSnapshot(JSON.stringify({
      ProcessId: 201,
      ParentProcessId: 10,
      ExecutablePath: 'C:\\Program Files\\Kun\\Kun.exe',
      CommandLine: '"C:\\Program Files\\Kun\\Kun.exe" serve'
    }))).toEqual([{
      pid: 201,
      parentPid: 10,
      executable: 'C:\\Program Files\\Kun\\Kun.exe',
      command: '"C:\\Program Files\\Kun\\Kun.exe" serve'
    }])

    expect(parseWindowsProcessSnapshot(JSON.stringify([
      { ProcessId: 202, ParentProcessId: 10, CommandLine: null },
      { ProcessId: 203, ParentProcessId: 10, CommandLine: 'kun-runtime' }
    ]))).toEqual([{ pid: 203, parentPid: 10, command: 'kun-runtime' }])
  })

  it('uses UID-filtered ps on Unix and owner-free candidate CIM on Windows', async () => {
    const unixRun = vi.fn(async () => ({ stdout: '' }))
    await listCurrentUserProcesses({
      platform: 'linux',
      currentUid: 501,
      run: unixRun
    })
    expect(unixRun).toHaveBeenCalledWith(
      'ps',
      ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'uid=', '-o', 'command='],
      expect.objectContaining({ windowsHide: true, timeout: 1_800_000 })
    )

    const windowsRun = vi.fn(async () => ({ stdout: '[]' }))
    await listCurrentUserProcesses({ platform: 'win32', run: windowsRun })
    expect(windowsRun).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_CANDIDATE_SCRIPT],
      expect.objectContaining({ windowsHide: true, timeout: 1_800_000 })
    )
    expect(PROCESS_TABLE_TIMEOUT_MS).toBe(1_800_000)
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).toContain('-Filter')
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).toContain("Name = 'node.exe'")
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).toContain("Name = 'electron.exe'")
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).toContain("Name LIKE 'kun%.exe'")
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).not.toContain('GetOwnerSid')
    expect(WINDOWS_PROCESS_CANDIDATE_SCRIPT).not.toContain('$currentSid')
  })

  it('verifies current-user ownership through an exact Windows PID query', async () => {
    const snapshot = {
      ProcessId: 204,
      ParentProcessId: 10,
      ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
      CommandLine: 'node C:\\Kun\\serve-entry.js serve'
    }
    const windowsRun = vi.fn(async () => ({ stdout: JSON.stringify(snapshot) }))

    await expect(inspectCurrentUserProcess(204, {
      platform: 'win32',
      run: windowsRun
    })).resolves.toEqual({
      pid: 204,
      parentPid: 10,
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      command: 'node C:\\Kun\\serve-entry.js serve'
    })

    const script = windowsCurrentUserProcessScript(204)
    expect(script).toContain('ProcessId = 204')
    expect(script).toContain('GetOwnerSid')
    expect(script).toContain('$currentSid')
    expect(windowsRun).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      expect.objectContaining({ timeout: 1_800_000 })
    )
  })

  it('re-verifies an exact Unix PID with the current UID', async () => {
    const unixRun = vi.fn(async () => ({
      stdout: '  205    1  501 /usr/local/bin/node /Kun/serve-entry.js serve\n'
    }))

    await expect(inspectCurrentUserProcess(205, {
      platform: 'linux',
      currentUid: 501,
      run: unixRun
    })).resolves.toEqual({
      pid: 205,
      parentPid: 1,
      command: '/usr/local/bin/node /Kun/serve-entry.js serve'
    })
    expect(unixRun).toHaveBeenCalledWith(
      'ps',
      ['-p', '205', '-o', 'pid=', '-o', 'ppid=', '-o', 'uid=', '-o', 'command='],
      expect.objectContaining({ timeout: 1_800_000 })
    )
  })

  it('does not query owners for unrelated processes in a Node-heavy Windows snapshot', async () => {
    const unrelated = Array.from({ length: 37 }, (_, index) => ({
      ProcessId: 1_000 + index,
      ParentProcessId: 10,
      ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
      CommandLine: `node C:\\tools\\mcp-${index}.js`
    }))
    const kun = {
      ProcessId: 2_000,
      ParentProcessId: 10,
      ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
      CommandLine: 'node C:\\Kun\\serve-entry.js serve --port 18899'
    }
    const windowsRun = vi.fn(async (_command: string, args: string[]) => {
      const script = args[3] ?? ''
      if (script === WINDOWS_PROCESS_CANDIDATE_SCRIPT) {
        return { stdout: JSON.stringify([...unrelated, kun]) }
      }
      if (script.includes('ProcessId = 2000')) return { stdout: JSON.stringify(kun) }
      throw new Error(`unexpected owner query: ${script}`)
    })

    await expect(listCurrentUserProcesses({
      platform: 'win32',
      run: windowsRun
    })).resolves.toEqual([{
      pid: 2_000,
      parentPid: 10,
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      command: 'node C:\\Kun\\serve-entry.js serve --port 18899'
    }])

    const ownerQueries = windowsRun.mock.calls
      .map((call) => call[1][3] ?? '')
      .filter((script) => script.includes('GetOwnerSid'))
    expect(ownerQueries).toHaveLength(1)
    expect(ownerQueries[0]).toContain('ProcessId = 2000')
  })

  it('drops a strict Windows candidate when exact-PID ownership cannot be verified', async () => {
    const kun = {
      ProcessId: 2_001,
      ParentProcessId: 10,
      ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
      CommandLine: 'node C:\\Kun\\serve-entry.js serve'
    }
    const windowsRun = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args[3] === WINDOWS_PROCESS_CANDIDATE_SCRIPT ? JSON.stringify(kun) : ''
    }))

    await expect(listCurrentUserProcesses({
      platform: 'win32',
      run: windowsRun
    })).resolves.toEqual([])
  })
})

describe('Kun serve process matching', () => {
  it.each([
    ['kun-runtime', ''],
    ['kun-dv-runtime', ''],
    ['/usr/local/bin/node /Applications/Kun/serve-entry.js serve --port 18899', ''],
    ['"/Applications/Kun.app/Contents/MacOS/Kun" "/old/serve-entry.js" serve --port 18899', ''],
    ['"C:\\Program Files\\Kun\\Kun.exe" "C:\\old\\serve-entry.js" serve --port 18899', 'C:\\Program Files\\Kun\\Kun.exe'],
    ['C:\\tools\\kun-cli.exe serve --port 18899', 'C:\\tools\\kun-cli.exe']
  ])('matches a real serve command: %s', (command, executable) => {
    expect(looksLikeKunServeCommand(command, executable)).toBe(true)
  })

  it.each([
    ['kun-service-manager', ''],
    ['/Applications/Kun.app/Contents/MacOS/Kun', ''],
    ['/usr/local/bin/node unrelated-service.js serve', ''],
    ['/bin/sh -c "node /old/serve-entry.js serve"', ''],
    ['python worker.py --label kun-runtime', ''],
    ['node /old/serve-entry.js status', ''],
    ['C:\\Program Files\\Kun\\Kun.exe --type=utility serve', 'C:\\Program Files\\Kun\\Kun.exe']
  ])('rejects an unrelated command: %s', (command, executable) => {
    expect(looksLikeKunServeCommand(command, executable)).toBe(false)
  })

  it('always excludes the current Electron PID', () => {
    expect(looksLikeKunServeProcess({
      pid: 500,
      parentPid: 1,
      command: 'kun-runtime'
    }, 500)).toBe(false)
  })
})

describe('historical Kun serve cleanup', () => {
  const processes: KunServeProcessSnapshot[] = [
    { pid: 301, parentPid: 1, command: 'kun-runtime' },
    { pid: 302, parentPid: 1, command: '/usr/bin/node /old/serve-entry.js serve --port 19000' },
    { pid: 303, parentPid: 1, command: '/usr/bin/node unrelated.js' }
  ]

  it('terminates verified matches and tolerates a process that already exited', async () => {
    const listProcesses = vi.fn(async () => processes)
    const waitForExit = vi.fn(async (pid: number) => pid === 302)
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => verify())
    const log = vi.fn(async () => undefined)

    await expect(clearHistoricalKunServeProcesses({
      currentPid: 999,
      listProcesses,
      waitForExit,
      terminate,
      log
    })).resolves.toEqual({
      matchedPids: [301, 302],
      terminatedPids: [301],
      alreadyExitedPids: [302],
      failedPids: []
    })

    expect(terminate).toHaveBeenCalledOnce()
    expect(terminate.mock.calls[0]?.[0]).toBe(301)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('scan found 2'))
  })

  it('fails closed when a matched PID changes identity before signaling', async () => {
    const listProcesses = vi.fn(async () => [
      { pid: 401, parentPid: 1, command: 'kun-runtime' }
    ])
    const inspectProcess = vi.fn(async () => ({
      pid: 401,
      parentPid: 1,
      command: '/usr/bin/node unrelated.js'
    }))
    const waitForExit = vi.fn(async () => false)
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      expect(await verify()).toBe(false)
      return false
    })

    await expect(clearHistoricalKunServeProcesses({
      currentPid: 999,
      listProcesses,
      inspectProcess,
      waitForExit,
      terminate,
      log: vi.fn(async () => undefined)
    })).rejects.toThrow(/401.*replacement was not started/i)

    expect(terminate).toHaveBeenCalledOnce()
    expect(inspectProcess).toHaveBeenCalledWith(401)
  })
})
