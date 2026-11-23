import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { FIXTURE_REPLY } from './kun-npm-smoke-model.mjs'
import { processAlive, runProcess, smokeEnvironment, startProcess, waitUntil } from './kun-npm-smoke-process.mjs'

export async function exerciseInstalledServer(context) {
  const { node, installed, root, env, config, workspace, check } = context
  let service
  let endpoint
  let identity
  const start = async () => {
    service = startProcess(node, [installed.entry, 'serve', '--config', config, '--data-dir', env.KUN_DATA_DIR, '--port', '0'],
      { cwd: root, env, timeout: 180_000 })
    const ready = await waitUntil(() => {
      if (service.code !== null) throw new Error(`Serve exited: ${service.stderr}`)
      const line = service.stdout.split('\n').find((line) => line.startsWith('KUN_READY '))
      return line ? JSON.parse(line.slice('KUN_READY '.length)) : null
    }, 'installed serve readiness')
    identity = ready.instanceId
    endpoint = `http://${ready.host}:${ready.port}`
    return ready
  }
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${endpoint}${path}`, { method,
      headers: { authorization: `Bearer ${env.KUN_RUNTIME_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    const text = await response.text()
    assert(response.ok, `${method} ${path}: ${response.status} ${text}\n${service?.stderr.slice(-8_000) ?? ''}`)
    return text ? JSON.parse(text) : null
  }
  const stop = async () => {
    if (!service || service.child.exitCode !== null) return
    await request('/v1/runtime/shutdown', 'POST', { instanceId: identity })
    const result = await service.done
    assert.equal(result.code, 0, result.stderr)
    await waitUntil(() => !processAlive(service.child.pid), 'owned serve process exit', 15_000)
    await assert.rejects(fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1_000) }))
  }
  let thread
  try {
    await check('RUN-05.http-thread-lifecycle', async () => {
      await start()
      const denied = await fetch(`${endpoint}/v1/threads`, { signal: AbortSignal.timeout(5_000) })
      assert.equal(denied.status, 401)
      const info = await request('/v1/runtime/info')
      assert.equal(info.instanceId, identity)
      thread = await request('/v1/threads', 'POST', { title: 'npm artifact fixture', workspace,
        model: 'kun-npm-fixture', approvalPolicy: 'never', sandboxMode: 'workspace-write' })
      const accepted = await request(`/v1/threads/${thread.id}/turns`, 'POST', {
        prompt: 'Return fixture marker through HTTP', mode: 'agent', clientSurface: 'api' })
      const turn = await waitUntil(async () => {
        const value = await request(`/v1/threads/${thread.id}/turns/${accepted.turnId}`)
        return !['queued', 'running'].includes(value.status) ? value : null
      }, 'HTTP turn completion')
      assert.equal(turn.status, 'completed', JSON.stringify(turn))
      assert(JSON.stringify(turn).includes(FIXTURE_REPLY))
      const listed = await request('/v1/threads?search=npm%20artifact')
      assert(listed.threads.some((item) => item.id === thread.id))
      const fork = await request(`/v1/threads/${thread.id}/fork`, 'POST', { title: 'npm artifact fork' })
      assert.notEqual(fork.id, thread.id)
      await request(`/v1/sessions/${thread.id}/resume-thread`, 'POST', {})
      await request(`/v1/threads/${fork.id}`, 'PATCH', { status: 'archived' })
      const archived = await request('/v1/threads?archived_only=true')
      assert(archived.threads.some((item) => item.id === fork.id))
      await request('/v1/usage')
      await request(`/v1/workspace/status?path=${encodeURIComponent(workspace)}`)
    })
    await check('RUN-06.sse-replay', async () => {
      const readEvents = async (since) => {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), 10_000)
        let text = ''
        try {
          const response = await fetch(`${endpoint}/v1/threads/${thread.id}/events?since_seq=${since}`, {
            headers: { authorization: `Bearer ${env.KUN_RUNTIME_TOKEN}` }, signal: abort.signal })
          assert(response.ok)
          for await (const bytes of response.body) {
            text += Buffer.from(bytes).toString()
            if (text.includes('event: turn_completed')) break
          }
        } finally { clearTimeout(timer); abort.abort() }
        return text
      }
      const first = await readEvents(0)
      const ids = [...first.matchAll(/^id:\s*(\d+)/gmu)].map((match) => Number(match[1]))
      assert(ids.length > 1, first)
      assert(ids.every((value, index) => index === 0 || value > ids[index - 1]), 'SSE ids must increase')
      assert(first.includes(FIXTURE_REPLY))
      const cursor = ids[Math.floor(ids.length / 2)]
      const replay = await readEvents(cursor)
      const replayIds = [...replay.matchAll(/^id:\s*(\d+)/gmu)].map((match) => Number(match[1]))
      assert(replayIds.length > 0 && replayIds.every((value) => value > cursor), replay)
    })
    await check('LIFE-03.owner-conflict', async () => {
      const second = await runProcess(node, [installed.entry, 'serve', '--config', config, '--port', '0'],
        { cwd: root, env, timeout: 30_000, allowFailure: true })
      assert.notEqual(second.code, 0)
      assert.match(second.stderr + second.stdout, /own|running|conflict|in use|active/iu)
      assert.equal((await request('/v1/runtime/info')).instanceId, identity)
    })
    await check('LIFE-03.isolated-profiles', async () => {
      const directory = join(root, 'parallel profile')
      await mkdir(directory, { recursive: true })
      const parallelEnv = { ...smokeEnvironment(node, directory), PATH: env.PATH }
      const parallelConfig = join(directory, 'config.json')
      const value = JSON.parse(await readFile(config, 'utf8'))
      value.serve.dataDir = parallelEnv.KUN_DATA_DIR
      await writeFile(parallelConfig, JSON.stringify(value))
      const parallel = startProcess(node, [installed.entry, 'serve', '--config', parallelConfig, '--port', '0'],
        { cwd: directory, env: parallelEnv, timeout: 90_000 })
      try {
        const ready = await waitUntil(() => {
          if (parallel.code !== null) throw new Error(`Isolated serve exited: ${parallel.stderr}`)
          const line = parallel.stdout.split('\n').find(line => line.startsWith('KUN_READY '))
          return line ? JSON.parse(line.slice('KUN_READY '.length)) : null
        }, 'independent profile readiness')
        assert.notEqual(ready.instanceId, identity)
        const url = `http://${ready.host}:${ready.port}`
        const headers = { authorization: `Bearer ${parallelEnv.KUN_RUNTIME_TOKEN}`, 'content-type': 'application/json' }
        const info = await fetch(`${url}/v1/runtime/info`, { headers, signal: AbortSignal.timeout(5_000) })
        assert.equal((await info.json()).instanceId, ready.instanceId)
        assert.equal((await request('/v1/runtime/info')).instanceId, identity)
        const pids = await collectOwnedPids(parallelEnv.KUN_MANAGER_CONTROL_DIR)
        const stopped = await fetch(`${url}/v1/runtime/shutdown`, { method: 'POST', headers,
          body: JSON.stringify({ instanceId: ready.instanceId }), signal: AbortSignal.timeout(10_000) })
        assert(stopped.ok)
        assert.equal((await parallel.done).code, 0, parallel.stderr)
        for (const pid of pids) await waitUntil(() => !processAlive(pid), `isolated participant ${pid} exit`, 15_000)
        await assert.rejects(fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) }))
        assert.equal((await request('/v1/runtime/info')).instanceId, identity)
        return { verifiedParticipantCount: pids.length }
      } finally {
        if (parallel.child.exitCode === null) { parallel.child.kill('SIGTERM'); await parallel.done }
      }
    })
    await check('RUN-06.interrupt', async () => {
      const turn = await request(`/v1/threads/${thread.id}/turns`, 'POST', {
        prompt: 'KUN_ARTIFACT_VERIFY_WAIT', mode: 'agent', clientSurface: 'api' })
      await waitUntil(async () => (await request(`/v1/threads/${thread.id}/turns/${turn.turnId}`)).status === 'running', 'running interrupt fixture')
      await request(`/v1/threads/${thread.id}/turns/${turn.turnId}/interrupt`, 'POST', {})
      const stopped = await waitUntil(async () => {
        const value = await request(`/v1/threads/${thread.id}/turns/${turn.turnId}`)
        return !['queued', 'running'].includes(value.status) ? value : null
      }, 'interrupted turn')
      assert(['interrupted', 'cancelled', 'aborted'].includes(stopped.status), JSON.stringify(stopped))
    })
    await check('LIFE-04.attached-tui', async () => {
      const runner = fileURLToPath(new URL('../fixtures/kun-npm/tui-pty.py', import.meta.url))
      const output = await runProcess(process.platform === 'win32' ? 'python' : 'python3', [runner, node, installed.entry, env.KUN_DATA_DIR, workspace, 'attach'], {
        cwd: root, env: { ...env, KUN_CONFIG: config, KUN_TUI_URL: endpoint }, timeout: 90_000 })
      const result = JSON.parse(output.stdout)
      assert.equal(result.exitCode, 0, JSON.stringify(result))
      assert(!result.forcedExit, `Attached TUI did not exit through /quit: ${JSON.stringify(result)}`)
      assert(result.matchedReply, 'Attached TUI did not finish the fixture turn')
      assert(result.sentPrompt, 'Attached TUI must submit a new prompt')
      assert.equal((await request('/v1/runtime/info')).instanceId, identity,
        'Disconnecting a non-owning TUI must not stop or replace its owner')
    })
    await check('LIFE-01.owned-serve-exit', async () => {
      const tracked = await collectOwnedPids(env.KUN_MANAGER_CONTROL_DIR)
      await stop()
      for (const pid of tracked) await waitUntil(() => !processAlive(pid), `owned participant ${pid} exit`, 15_000)
      return { verifiedParticipantCount: tracked.length }
    })
    await check('DATA-01.reopen', async () => {
      await start()
      const reopened = await request(`/v1/threads/${thread.id}`)
      assert(JSON.stringify(reopened).includes(FIXTURE_REPLY))
      assert.equal(reopened.id, thread.id)
      await stop()
    })
    {
      for (const mode of ['tui', 'bare']) await check(`RUN-04.pty-${mode}`, async () => {
        const runner = fileURLToPath(new URL('../fixtures/kun-npm/tui-pty.py', import.meta.url))
        const output = await runProcess(process.platform === 'win32' ? 'python' : 'python3', [runner, node, installed.entry, env.KUN_DATA_DIR, workspace, mode], {
          cwd: root, env: { ...env, KUN_CONFIG: config }, timeout: 90_000 })
        const result = JSON.parse(output.stdout)
        assert.equal(result.exitCode, 0, JSON.stringify(result))
        assert(!result.forcedExit, `Owned TUI did not exit through /quit: ${JSON.stringify(result)}`)
        assert(result.matchedReply, 'TUI did not render the fixture response')
        assert(result.sentPrompt, 'TUI must submit a new prompt')
        assert.equal(result.terminalKind, process.platform === 'win32' ? 'windows-conpty' : 'posix-pty')
        return result
      })
      await exerciseInstalledTuiCancellation(context)
    }
    await check('LIFE-02.startup-failure', async () => {
      const occupied = createServer((_request, response) => response.end('fixture'))
      await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
      const observed = new Set()
      let sampling = Promise.resolve()
      const timer = setInterval(() => {
        sampling = sampling.then(async () => {
          for (const pid of await collectOwnedPids(env.KUN_MANAGER_CONTROL_DIR)) observed.add(pid)
        })
      }, 25)
      try {
        const failure = await runProcess(node, [installed.entry, 'serve', '--config', config,
          '--port', String(occupied.address().port)], { cwd: root, env, timeout: 45_000, allowFailure: true })
        assert.notEqual(failure.code, 0)
        assert.match(failure.stderr, /EADDRINUSE|address already in use/iu)
        assert(observed.size > 0, 'The failure must exercise an actually started Manager')
      } finally {
        clearInterval(timer)
        await sampling
        await new Promise(resolve => occupied.close(resolve))
      }
      for (const pid of observed) await waitUntil(() => !processAlive(pid), `startup failure participant ${pid} exit`, 15_000)
      return { verifiedParticipantCount: observed.size }
    })
    await check('LIFE-02.owner-loss', async () => {
      await start()
      const pids = await collectOwnedPids(env.KUN_MANAGER_CONTROL_DIR)
      assert(pids.length > 0)
      service.child.kill('SIGKILL')
      await service.done
      for (const pid of pids) await waitUntil(() => !processAlive(pid), `crashed owner participant ${pid} exit`, 45_000)
      await assert.rejects(fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1_000) }))
      return { verifiedParticipantCount: pids.length }
    })
  } finally {
    if (service && service.child.exitCode === null) {
      try { await stop() } catch {
        service.child.kill('SIGTERM')
        await service.done
      }
    }
  }
}

export async function exerciseInstalledTuiCancellation(context) {
  const { node, installed, root, env, config, workspace, check } = context
  await check('RUN-04.pty-cancel', async () => {
    const directory = join(root, 'tui cancellation profile')
    await mkdir(directory, { recursive: true })
    const isolated = { ...smokeEnvironment(node, directory), PATH: env.PATH }
    const value = JSON.parse(await readFile(config, 'utf8'))
    value.serve.dataDir = isolated.KUN_DATA_DIR
    const path = join(directory, 'config.json')
    await writeFile(path, JSON.stringify(value))
    const runner = fileURLToPath(new URL('../fixtures/kun-npm/tui-pty.py', import.meta.url))
    const output = await runProcess(process.platform === 'win32' ? 'python' : 'python3', [runner, node, installed.entry, isolated.KUN_DATA_DIR, workspace, 'cancel'],
      { cwd: root, env: { ...isolated, KUN_CONFIG: path }, timeout: 90_000 })
    const result = JSON.parse(output.stdout)
    assert.equal(result.exitCode, 0, JSON.stringify(result))
    assert(!result.forcedExit, `Cancellation TUI did not exit through /quit: ${JSON.stringify(result)}`)
    assert(result.cancellationVerified, 'Terminal input did not interrupt the active turn through the real TUI')
    return result
  })
}

async function collectOwnedPids(control) {
  const pids = new Set()
  const pending = [control]
  while (pending.length) {
    const path = pending.pop()
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) pending.push(file)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(await readFile(file, 'utf8'))
          if (Number.isInteger(record.pid) && record.pid > 0) pids.add(record.pid)
        } catch { /* Only validated parseable participant records are observations. */ }
      }
    }
  }
  return [...pids]
}
