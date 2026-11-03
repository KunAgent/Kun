import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupAppIpcHandlerTestState, createGate, getAppIpcElectronMock, handlers,
  registerOptions, resetAppIpcHandlerTestState, settings } from './register-app-ipc-handlers.test-support'
import { registerAppIpcHandlers } from './register-app-ipc-handlers'
import { ApprovalConsentVerifier, KUN_APPROVAL_CONSENT_HEADER } from '../../../kun/src/server/approval-consent.js'
import { RemoteClientSender, remoteInvokeEvent } from '../remote/remote-sender'

vi.mock('../main-window', () => ({ trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html' }))
vi.mock('./register-kun-art-ipc', () => ({ registerKunArtIpc: vi.fn() }))
const electron = getAppIpcElectronMock()
const payload = { approvalId: 'approval-secret', decision: 'allow', source: 'user' }

function fixture() {
  const frame = { processId: 10, routingId: 20, detached: false, url: 'http://127.0.0.1:5173/index.html' }
  let destroyed = false
  const contents = { id: 7, mainFrame: frame, isDestroyed: () => destroyed }
  const parent = { isDestroyed: () => destroyed, webContents: contents, isMinimized: () => true,
    isVisible: () => false, isFocused: () => false, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  const current = settings()
  const approval = { id: payload.approvalId, threadId: 'thread', turnId: 'turn', toolName: 'exec_command',
    summary: 'Run a command', status: 'pending', createdAt: '2026-09-30T00:00:00.000Z',
    action: { version: 1, kind: 'command', toolName: 'exec_command', workspace: '/work/project', cwd: '/work/project',
      effects: { network: false, externalWrite: false, processExecution: true, guiAutomation: false },
      arguments: { command: 'truncated preview...' }, targets: [{ kind: 'command', value: 'git status --short' }], reason: 'Inspect the working tree' } }
  const state = { approval, title: 'Fix the application' }
  const leaseRequest = vi.fn(async (_path: string, method?: string, _body?: string, _headers?: Record<string, string>) =>
    ({ ok: true, status: 200, body: method === 'POST' ? '{}' : JSON.stringify(state) }))
  const acquireRuntimeRequestLease = vi.fn(async () => ({ runtimeToken: 'resolved-runtime-secret', request: leaseRequest }))
  const runtimeRequest = vi.fn(), logInfo = vi.fn(), logError = vi.fn()
  const options = registerOptions({ store: { load: vi.fn(async () => current) } as never,
    getMainWindow: () => parent as never, acquireRuntimeRequestLease, runtimeRequest, logInfo, logError })
  return { frame, contents, parent, state, current, options, leaseRequest, acquireRuntimeRequestLease,
    runtimeRequest, logInfo, logError, event: { sender: contents, senderFrame: frame },
    destroy: () => { destroyed = true },
    navigate: () => { contents.mainFrame = { ...frame, processId: 11, routingId: 21 } } }
}
const writes = (f: ReturnType<typeof fixture>) => f.leaseRequest.mock.calls.filter((call) => call[1] === 'POST')
type Choice = import('../../shared/approval-choice').ApprovalChoice

// Both presentations must enforce the same snapshot, sender and exact-choice checks.
describe.each([undefined, 'room'] as const)('single-click tool approval IPC (%s)', (presentation) => {
  const decide = (event: unknown, value: typeof payload & { choice?: Choice } = payload) =>
    handlers.get('approval:decide')!(event, { ...value, ...(presentation ? { presentation } : {}) })
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it.each(['allow', 'deny'])('submits %s once without a dialog or window reveal', async (decision) => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    expect(await decide(f.event, { ...payload, decision })).toMatchObject({ confirmed: true, response: { ok: true } })
    expect(f.acquireRuntimeRequestLease).toHaveBeenCalledOnce()
    expect(writes(f)).toHaveLength(1)
    expect(f.leaseRequest.mock.calls.map((call) => call[1])).toEqual(['GET', 'GET', 'POST'])
    expect(f.runtimeRequest).not.toHaveBeenCalled()
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(f.parent.restore).not.toHaveBeenCalled()
    expect(f.parent.show).not.toHaveBeenCalled()
    expect(f.parent.focus).not.toHaveBeenCalled()
    const [path, method, body, headers] = writes(f)[0]!
    expect({ path, method, body }).toEqual({ path: '/v1/approvals/approval-secret', method: 'POST', body: JSON.stringify({ decision }) })
    const verifier = new ApprovalConsentVerifier('resolved-runtime-secret')
    const consent = { token: headers![KUN_APPROVAL_CONSENT_HEADER], approvalId: payload.approvalId, decision: decision as 'allow' | 'deny' }
    expect(verifier.verifyAndConsume(consent)).toBe(true)
    expect(verifier.verifyAndConsume(consent)).toBe(false)
  })

  it.each(['once', 'always'])('binds the exact provider option %s without another confirmation', async (optionId) => {
    const f = fixture()
    Object.assign(f.state.approval.action, { permissionOptions: [
      { optionId: 'always', name: 'Remember this command', kind: 'allow_always' },
      { optionId: 'once', name: 'Just once', kind: 'allow_once' }
    ] })
    registerAppIpcHandlers(f.options)
    await decide(f.event, { ...payload, choice: { optionId } })
    expect(writes(f)).toHaveLength(1)
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
    const write = writes(f)[0]!
    expect(JSON.parse(write[2]!)).toEqual({ decision: 'allow', choice: { optionId } })
    const verifier = new ApprovalConsentVerifier('resolved-runtime-secret')
    const token = write[3]![KUN_APPROVAL_CONSENT_HEADER]
    expect(verifier.verifyAndConsume({ token, approvalId: payload.approvalId, decision: 'allow', choice: { optionId: 'wrong' } })).toBe(false)
    expect(verifier.verifyAndConsume({ token, approvalId: payload.approvalId, decision: 'allow', choice: { optionId } })).toBe(true)
  })

  it('rejects forged choices, policy allows and untrusted frames', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    await expect(decide(f.event, { ...payload, source: 'policy' })).rejects.toThrow('Runtime-owned')
    await expect(decide({ sender: { id: 99 }, senderFrame: f.frame })).rejects.toThrow('trusted workbench frame')
    expect(f.acquireRuntimeRequestLease).not.toHaveBeenCalled()
    await expect(decide(f.event, { ...payload, choice: { optionId: 'forged' } })).rejects.toThrow('no longer available')
    expect(writes(f)).toEqual([])
  })

  it.each(['status', 'target', 'arguments', 'workspace', 'title', 'options', 'id'] as const)('rejects snapshot changes before submission: %s', async (field) => {
    const f = fixture(); let reads = 0
    f.leaseRequest.mockImplementation(async (_path, method) => {
      if (method === 'GET' && ++reads === 2) {
        if (field === 'status') f.state.approval.status = 'allowed'
        if (field === 'target') f.state.approval.action.targets[0]!.value = 'changed'
        if (field === 'arguments') f.state.approval.action.arguments.command = 'different preview'
        if (field === 'workspace') f.state.approval.action.workspace = '/other'
        if (field === 'title') f.state.title = 'Another task'
        if (field === 'options') Object.assign(f.state.approval.action, { permissionOptions: [] })
        if (field === 'id') f.state.approval.id = 'another-approval'
      }
      return { ok: true, status: 200, body: JSON.stringify(f.state) }
    })
    registerAppIpcHandlers(f.options)
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
    expect(f.logInfo).toHaveBeenCalledWith('approval', expect.any(String), expect.objectContaining({ approvalRef: expect.stringMatching(/^sha256:/) }))
    expect(JSON.stringify(f.logInfo.mock.calls)).not.toContain('approval-secret')
    expect(JSON.stringify(f.logInfo.mock.calls)).not.toContain('git status')
  })

  it.each(['destroy', 'navigate'] as const)('rechecks sender after the final asynchronous read: %s', async (change) => {
    const f = fixture(); let reads = 0
    f.leaseRequest.mockImplementation(async (_path, method) => {
      if (method === 'GET' && ++reads === 2) f[change]()
      return { ok: true, status: 200, body: JSON.stringify(f.state) }
    })
    registerAppIpcHandlers(f.options)
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(reads).toBe(2)
    expect(writes(f)).toEqual([])
  })

  it('revalidates sender after lease acquisition', async () => {
    const f = fixture(), gate = createGate()
    f.acquireRuntimeRequestLease.mockImplementationOnce(async () => { await gate.promise; return { runtimeToken: 'token', request: f.leaseRequest } })
    registerAppIpcHandlers(f.options)
    const result = decide(f.event)
    await vi.waitFor(() => expect(f.acquireRuntimeRequestLease).toHaveBeenCalledOnce())
    f.navigate(); gate.release()
    expect(await result).toEqual({ confirmed: false })
    expect(f.leaseRequest).not.toHaveBeenCalled()
  })

  it('preserves remote confirmation and rejects a disconnected remote sender', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    const sender = new RemoteClientSender('remote-client', () => undefined)
    expect(await decide(remoteInvokeEvent(sender))).toMatchObject({ confirmed: true })
    expect(writes(f)).toHaveLength(1)
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
    f.leaseRequest.mockClear()
    let reads = 0
    f.leaseRequest.mockImplementation(async (_path, method) => {
      if (method === 'GET' && ++reads === 2) sender.destroy()
      return { ok: true, status: 200, body: JSON.stringify(f.state) }
    })
    expect(await decide(remoteInvokeEvent(sender))).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
  })

  it('ignores expired approvals and fails closed on malformed final snapshots', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    f.state.approval.status = 'expired'
    expect(await decide(f.event)).toEqual({ confirmed: false })
    f.state.approval.status = 'pending'
    f.leaseRequest.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(f.state) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: 'invalid-json' })
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
  })

  it('returns a redacted Runtime failure when lease acquisition fails', async () => {
    const f = fixture()
    f.acquireRuntimeRequestLease.mockRejectedValueOnce(new Error('/Users/private-user/runtime failed'))
    registerAppIpcHandlers(f.options)
    const result = await decide(f.event)
    expect(result).toMatchObject({ confirmed: true, response: { ok: false, body: expect.stringContaining('runtime_unhealthy') } })
    expect(JSON.stringify(result)).not.toContain('private-user')
    expect(JSON.stringify(f.logError.mock.calls)).not.toContain('private-user')
  })
})

describe('approval policy boundaries', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('preserves policy denial for Code but does not accept it as a room user decision', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    const decide = handlers.get('approval:decide')!
    expect(await decide(f.event, { ...payload, source: 'policy', decision: 'deny' })).toMatchObject({ confirmed: true })
    expect(writes(f)).toHaveLength(1)
    await expect(decide(f.event, { ...payload, source: 'policy', decision: 'deny', presentation: 'room' })).rejects.toThrow('requires a user decision')
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it.each([false, true])('still requires native confirmation for room permission changes: %s', async (confirmed) => {
    const f = fixture()
    f.leaseRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ revision: 1, mode: 'ask' }) })
    registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockResolvedValueOnce(confirmed)
    const result = await handlers.get('room:permissions:set')!(f.event, {
      roomId: 'room', clientRequestId: 'change', expectedRevision: 1, mode: 'full-access'
    })
    expect(result).toMatchObject({ confirmed })
    expect(electron.showProtectedDialog).toHaveBeenCalledOnce()
    expect(f.leaseRequest.mock.calls.filter((call) => call[1] === 'PUT')).toHaveLength(confirmed ? 1 : 0)
  })
})
