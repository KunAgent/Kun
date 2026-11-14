import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { artifactProfile, artifactServer, artifactTurn, connectArtifactServer, jsonFile, processBirth, processTree } from './kun-npm-artifact-runtime.mjs'
import { delay, processAlive, startProcess, waitUntil } from './kun-npm-smoke-process.mjs'

const fixture = name => fileURLToPath(new URL(`../fixtures/kun-npm/${name}`, import.meta.url))
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
async function traceRows(root) {
  try { return (await readFile(join(root, 'trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
function portOpen(port) {
  return new Promise((done, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); done(true) })
    socket.once('error', error => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') done(false)
      else if (error.code === 'ECONNRESET') done(true) // Recheck; a reset is not proof that the listener has closed.
      else reject(error)
    })
    socket.once('timeout', () => { socket.destroy(); reject(Error('TCP probe timed out')) })
  })
}

export async function exerciseArtifactLifecycle(context) {
  for (const mode of ['serve', 'tui', 'attached', 'owner-loss']) {
    await context.check(`${mode === 'owner-loss' ? 'LIFE-02' : 'LIFE-01'}.${mode}-shutdown-order`, async () => {
      const profile = await artifactProfile(context, `lifecycle-${mode}`)
      const listenersTrace = join(profile.root, 'listener-events.jsonl')
      profile.env.NODE_OPTIONS = `--import=${pathToFileURL(fixture('observe-listeners.mjs')).href}`
      profile.env.KUN_NPM_LIFECYCLE_TRACE = listenersTrace
      profile.env.KUN_NPM_WORK_PROCESS_SNAPSHOT = join(profile.root, 'work-processes.json')
      const participantsRoot = join(profile.root, 'participants')
      context.modelOptions.lifecycleCommand = [context.node, fixture('lifecycle-process.mjs'), participantsRoot, 'shell']
        .map(shellQuote).join(' ')
      if (process.platform === 'win32') {
        const command = '& ' + [context.node, fixture('lifecycle-process.mjs'), participantsRoot, 'shell']
          .map(value => `'${value.replaceAll("'", "''")}'`).join(' ')
        context.modelOptions.lifecycleCommand = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
          Buffer.from(command, 'utf16le').toString('base64')
      }
      profile.value.capabilities = { mcp: { enabled: true, servers: { artifact: {
        enabled: true, transport: 'stdio', command: context.node,
        args: [fixture('mcp-server.mjs'), '--lifecycle-root', participantsRoot], trustScope: 'user', timeoutMs: 10_000
      } } } }
      await writeFile(profile.config, JSON.stringify(profile.value))
      const control = join(profile.root, 'quit-tui')
      let server, driver, terminal, participants = [], monitor, monitorError, monitoring = true
      const evidence = { mode, runtimeListenerClosedBeforeManager: false, runtimeExitedBeforeManager: false }
      try {
        if (mode !== 'tui') server = await artifactServer(context, profile)
        if (mode === 'tui' || mode === 'attached') {
          driver = startProcess(process.platform === 'win32' ? 'python' : 'python3', [fixture('tui-pty.py'), context.node, context.installed.entry,
            profile.env.KUN_DATA_DIR, profile.workspace, mode === 'tui' ? 'controlled' : 'attach-controlled'],
          { cwd: profile.root, env: { ...profile.env, KUN_CONFIG: profile.config,
            KUN_TUI_SMOKE_CONTROL_FILE: control, ...(server ? { KUN_TUI_URL: server.url } : {}) }, timeout: 90_000 })
          terminal = await waitUntil(() => jsonFile(control + '.ready.json').catch(() => null), 'real TUI readiness', 30_000)
          assert(terminal.matchedReply)
          terminal.birth = processBirth(terminal.pid)
          if (!server) server = await connectArtifactServer(undefined,
            await jsonFile(join(profile.env.KUN_DATA_DIR, 'runtime.json')), profile)
        }
        await writeFile(join(participantsRoot, 'manager-probe.json'), JSON.stringify({
          url: server.manager.baseUrl, instanceId: server.manager.instanceId
        }))
        const run = await artifactTurn(server, profile, 'KUN_ARTIFACT_VERIFY_LIFECYCLE: Start the fixture work processes.')
        participants = await waitUntil(async () => {
          const live = (await traceRows(participantsRoot)).filter(row => row.event === 'ready' && processAlive(row.pid))
          return ['shell', 'shell-child', 'mcp', 'mcp-child'].every(role => live.some(row => row.role === role)) ? live : null
        }, 'live shell, MCP and grandchildren', 20_000)
        for (const participant of participants) {
          participant.birth = processBirth(participant.pid)
          assert(participant.birth, 'Participant must have an observed process birth identity')
          assert(await portOpen(participant.port), 'Participant listener must actually be open')
        }
        assert.equal((await server.api(run.path)).status, 'running')
        await writeFile(profile.env.KUN_NPM_WORK_PROCESS_SNAPSHOT, JSON.stringify(participants.map(value => value.pid)))
        const stack = processTree([server.ready.pid, server.manager.pid, ...(terminal ? [terminal.pid] : [])])
        const managerBirth = processBirth(server.manager.pid)
        const runtimeBirth = processBirth(server.ready.pid)
        assert(managerBirth && runtimeBirth)
        monitor = (async () => {
          while (monitoring && processAlive(server.manager.pid)) {
            if (!processAlive(server.ready.pid)) evidence.runtimeExitedBeforeManager = true
            if (!await portOpen(server.ready.port)) {
              try {
                const health = await fetch(server.manager.baseUrl + '/health', { signal: AbortSignal.timeout(500) })
                if (health.ok && (await health.json()).instanceId === server.manager.instanceId)
                  evidence.runtimeListenerClosedBeforeManager = true
              } catch { /* An unobserved ordering is a failed assertion below. */ }
            }
            await delay(5)
          }
        })().catch(error => { monitorError = error })
        if (mode === 'tui') {
          await writeFile(control, 'quit\n')
          const result = await driver.done
          assert.equal(result.code, 0, result.stderr)
          const tui = JSON.parse(result.stdout)
          assert.equal(tui.exitCode, 0, JSON.stringify(tui))
          assert(!tui.forcedExit, 'Owned TUI must exit through its normal /quit path')
          await waitUntil(() => !processAlive(server.manager.pid), 'TUI Manager exit', 20_000)
        } else if (mode === 'owner-loss') {
          server.service.child.kill('SIGKILL')
          await server.service.done
          await waitUntil(() => !processAlive(server.manager.pid), 'crashed owner Manager cleanup', 40_000)
        } else await server.stop()
        if (mode === 'attached') {
          evidence.attachedDidNotExtendOwner = !processAlive(server.manager.pid)
          await writeFile(control, 'quit\n')
          const result = await driver.done
          assert.equal(result.code, 0, result.stderr)
          const tui = JSON.parse(result.stdout)
          assert(!tui.forcedExit, 'Detached client must finish without a watchdog kill')
          evidence.attachedExitCode = tui.exitCode
        }
        monitoring = false
        await monitor
        if (monitorError) throw monitorError
        for (const participant of participants) {
          await waitUntil(() => !processAlive(participant.pid), `work participant ${participant.pid} exit`, mode === 'owner-loss' ? 30_000 : 15_000)
          assert(!await portOpen(participant.port), 'Work listener was left open')
        }
        const rows = await traceRows(participantsRoot)
        for (const participant of participants) {
          if (process.platform === 'win32') continue // Job termination is verified by PID/listener state at Manager close, not POSIX callbacks.
          const stopping = rows.find(row => row.event === 'stopping' && row.pid === participant.pid)
          assert(stopping, `Missing cleanup evidence for ${participant.role}`)
          if (mode !== 'owner-loss') assert(stopping.managerAvailable,
            `Manager was unavailable during ${participant.role} cleanup`)
          assert(rows.some(row => row.event === 'exit' && row.pid === participant.pid), 'Participant did not record normal exit')
        }
        const listenerEvents = (await readFile(listenersTrace, 'utf8')).trim().split('\n').map(JSON.parse)
        const runtimeClosed = listenerEvents.findIndex(row => row.event === 'listener-closed' && row.pid === server.ready.pid && row.port === server.ready.port)
        const managerClosed = listenerEvents.findIndex(row => row.event === 'listener-closed' && row.pid === server.manager.pid && row.port === server.manager.port)
        const runtimeExit = listenerEvents.findIndex(row => row.event === 'process-exit' && row.pid === server.ready.pid)
        if (mode === 'owner-loss') assert(evidence.runtimeExitedBeforeManager,
          'Crashed Runtime must exit before Manager; work descendants use the existing independent guard budget')
        else {
          assert(runtimeClosed >= 0 && managerClosed > runtimeClosed, 'Runtime listener must close before Manager listener')
          assert.equal(listenerEvents[managerClosed].liveWorkPids.length, 0, 'Manager closed before live work descendants')
          evidence.runtimeListenerClosedBeforeManager = true
        }
        if (mode === 'tui') assert(runtimeExit >= 0 && managerClosed > runtimeExit,
          'TUI must await its Runtime process before stopping Manager')
        await waitUntil(() => !processAlive(server.ready.pid), 'Runtime process exit')
        for (const process of stack) await waitUntil(() => processBirth(process.pid) !== process.birth,
          `stack process ${process.pid} (${process.birth}) exit`, mode === 'owner-loss' ? 30_000 : 15_000)
        return { ...evidence, runtime: { pid: server.ready.pid, birth: runtimeBirth },
          manager: { pid: server.manager.pid, birth: managerBirth },
          ownerSharesRuntimeProcess: mode !== 'tui', verifiedStack: stack,
          processExitVerification: 'Captured PID and birth identity; a reused PID is a different process',
          listenerEvents,
          shutdownContract: mode === 'owner-loss'
            ? 'Runtime exited before Manager; work descendants were reclaimed by the independent owner-loss guard'
            : 'Work drained with Manager reachable; Runtime listener closed before Manager',
          participants: participants.map(({ pid, role, birth, port }) => ({ pid, role, birth, port })),
          trace: rows.filter(row => participants.some(participant => participant.pid === row.pid)) }
      } finally {
        monitoring = false
        await monitor?.catch(() => undefined)
        if (terminal && processBirth(terminal.pid) === terminal.birth) {
          try { process.kill(terminal.pid, 'SIGTERM') } catch { /* exited */ }
        }
        if (driver) await driver.done
        if (server?.service?.child.exitCode === null && server.service.child.signalCode === null) {
          try { await server.stop() } catch { server.service.child.kill('SIGTERM'); await server.service.done }
        }
      }
    })
  }
  await context.check('LIFE-02.manager-readiness-failure', async () => {
    const profile = await artifactProfile(context, 'manager-startup-failure')
    const preload = join(profile.root, 'fail-manager.mjs')
    await writeFile(preload, `import {basename} from 'node:path'; if (basename(process.argv[1]??'')==='manager-entry.js') { await new Promise(done => setTimeout(done, 500)); process.stderr.write('Fixture Manager readiness failure\\n'); process.exit(78) }\n`)
    const service = startProcess(context.launch.command, [...context.launch.args, 'serve', '--config', profile.config, '--port', '0'],
      { cwd: profile.root, env: { ...profile.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` }, timeout: 45_000 })
    const observed = new Map()
    let sampling = true
    const sample = (async () => {
      while (sampling) {
        for (const row of processTree([service.child.pid])) if (row.pid !== service.child.pid) observed.set(row.pid, row)
        await delay(20)
      }
    })()
    try {
      const result = await service.done
      assert(!result.timedOut, 'Manager readiness failure exceeded the product cleanup budget')
      assert.notEqual(result.code, 0)
      assert((await readFile(join(profile.env.KUN_MANAGER_CONTROL_DIR, 'manager.log'), 'utf8'))
        .includes('Fixture Manager readiness failure'), 'Fault must run inside the actual Manager process')
      assert(observed.size > 0, 'Fault must exercise an actually launched Manager/guard')
      for (const row of observed.values()) await waitUntil(() => processBirth(row.pid) !== row.birth,
        `failed startup child ${row.pid} (${row.birth}) cleanup`, 15_000)
      return { exitCode: result.code, observedProcesses: [...observed.values()] }
    } finally { sampling = false; await sample }
  })
}
