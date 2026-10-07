'use strict'
const { chmod, mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const CODING_AGENT_PROFILE = Object.freeze({ harnessId: 'opencode', credentialMode: 'native-login' })
const CODING_AGENT_MODEL = 'opencode-fixture/model'
const CODING_AGENT_REPLY = 'OpenCode 离线回复'

/** Consent for exactly the offline OpenCode stub; no real account or provider is involved. */
async function configureCodingAgentFixture(settings, stubPath, home, environment) {
  // Credential evidence for the local stub only; it never reaches a service.
  const data = environment.XDG_DATA_HOME || join(home, '.local', 'share')
  await mkdir(join(data, 'opencode'), { recursive: true })
  await writeFile(join(data, 'opencode', 'auth.json'),
    JSON.stringify({ fixture: { type: 'api', key: 'opencode-offline-fixture-no-service-access' } }))
  const harnesses = settings.agents.kun.harnesses
  harnesses.binaryPaths = { ...(harnesses.binaryPaths ?? {}), opencode: stubPath }
  harnesses.enabledProfiles = [{ ...CODING_AGENT_PROFILE }]
  harnesses.defaults = { ...(harnesses.defaults ?? {}),
    opencode: { credentialMode: CODING_AGENT_PROFILE.credentialMode, model: CODING_AGENT_MODEL } }
}

/**
 * Real ACP subprocess with deterministic offline output. Every prompt answers
 * with the session mode it ran under, so the smoke can prove that group
 * discussion pinned OpenCode's read-only plan mode.
 */
async function writeOpenCodeStub(root, auditFile) {
  await mkdir(root, { recursive: true })
  const path = join(root, 'opencode-fixture')
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('opencode 1.1.47'); process.exit(0) }
const fs = require('node:fs')
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const audit = (entry) => fs.appendFileSync(${JSON.stringify(auditFile)}, JSON.stringify({ ...entry, pid: process.pid }) + '\\n')
const sessions = new Map()
const session = (id) => { if (!sessions.has(id)) sessions.set(id, { mode: 'build', model: ${JSON.stringify(CODING_AGENT_MODEL)} }); return sessions.get(id) }
let next = 0
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result })
  if (msg.method === 'initialize') return reply({ protocolVersion: 1,
    agentInfo: { name: 'OpenCode offline fixture', version: '1.1.47' }, agentCapabilities: { loadSession: true }, authMethods: [] })
  if (msg.method === 'session/new' || msg.method === 'session/load') {
    const id = msg.params?.sessionId ?? 'opencode-session-' + (++next)
    const state = session(id)
    audit({ method: msg.method, sessionId: id, cwd: msg.params?.cwd })
    return reply({ sessionId: id,
      modes: { currentModeId: state.mode, availableModes: [{ id: 'plan', name: 'Plan' }, { id: 'build', name: 'Build' }] },
      models: { currentModelId: state.model, availableModels: [{ modelId: ${JSON.stringify(CODING_AGENT_MODEL)}, name: 'OpenCode fixture model' }] } })
  }
  if (msg.method === 'session/set_mode') { session(msg.params.sessionId).mode = msg.params.modeId; return reply({}) }
  if (msg.method === 'session/set_model') { session(msg.params.sessionId).model = msg.params.modelId; return reply({}) }
  if (msg.method === 'session/prompt') {
    const state = session(msg.params.sessionId)
    const text = (msg.params.prompt ?? []).map((part) => part.text ?? '').join('\\n')
    audit({ method: msg.method, sessionId: msg.params.sessionId, mode: state.mode, model: state.model, text: text.slice(-4000) })
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ${JSON.stringify(CODING_AGENT_REPLY)} + '：模式 ' + state.mode + '，模型 ' + state.model + '。' } } } })
    return reply({ stopReason: 'end_turn' })
  }
  reply({})
})
`)
  await chmod(path, 0o755)
  if (process.platform === 'win32') {
    const launcher = `${path}.cmd`
    await writeFile(launcher, `@echo off\r\n"${process.execPath}" "${path}" %*\r\n`)
    return launcher
  }
  return path
}

module.exports = { CODING_AGENT_PROFILE, CODING_AGENT_MODEL, CODING_AGENT_REPLY, configureCodingAgentFixture, writeOpenCodeStub }
