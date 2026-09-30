import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupAppIpcHandlerTestState, createGate, getAppIpcElectronMock, handlers,
  registerOptions, resetAppIpcHandlerTestState, settings } from './register-app-ipc-handlers.test-support'
import { registerAppIpcHandlers } from './register-app-ipc-handlers'
import { ApprovalConsentVerifier, KUN_APPROVAL_CONSENT_HEADER } from '../../../kun/src/server/approval-consent.js'
import { RemoteClientSender, remoteInvokeEvent } from '../remote/remote-sender'

vi.mock('../main-window', () => ({ trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html' }))
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
const decide = (event: unknown, value = payload) => handlers.get('approval:decide')!(event, value)
const writes = (f: ReturnType<typeof fixture>) => f.leaseRequest.mock.calls.filter((call) => call[1] === 'POST')

describe('protected tool approval IPC', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('rejects policy allows and untrusted frames before acquiring any runtime authority', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    await expect(decide(f.event, { ...payload, source: 'policy' })).rejects.toThrow('Runtime-owned')
    await expect(decide({ sender: { id: 99 }, senderFrame: f.frame })).rejects.toThrow('trusted workbench frame')
    expect(f.acquireRuntimeRequestLease).not.toHaveBeenCalled()
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it('loads authoritative details using one lease and cancellation never writes a decision', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockResolvedValueOnce(false)
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(f.acquireRuntimeRequestLease).toHaveBeenCalledOnce()
    expect(f.leaseRequest).toHaveBeenCalledWith('/v1/approvals/approval-secret', 'GET')
    expect(writes(f)).toEqual([])
    expect(f.runtimeRequest).not.toHaveBeenCalled()
    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(electron.showProtectedDialog).toHaveBeenCalledWith(f.parent, expect.objectContaining({
      body: 'git status --short', subtitle: 'Fix the application · exec_command', workspace: '/work/project',
      details: expect.stringContaining('truncated preview'), confirmLabel: 'Allow once'
    }), expect.any(Function))
  })

  it('issues a one-shot token from that same lease only after confirmation and final snapshot validation', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockResolvedValueOnce(true)
    expect(await decide(f.event)).toMatchObject({ confirmed: true, response: { ok: true } })
    expect(f.acquireRuntimeRequestLease).toHaveBeenCalledOnce()
    expect(writes(f)).toHaveLength(1)
    const [path, method, body, headers] = writes(f)[0]!
    expect({ path, method, body }).toEqual({ path: '/v1/approvals/approval-secret', method: 'POST', body: '{"decision":"allow"}' })
    const token = headers![KUN_APPROVAL_CONSENT_HEADER]
    expect(token).toMatch(/^v1\./)
    const verifier = new ApprovalConsentVerifier('resolved-runtime-secret')
    expect(verifier.verifyAndConsume({ token, approvalId: payload.approvalId, decision: 'allow' })).toBe(true)
    expect(verifier.verifyAndConsume({ token, approvalId: payload.approvalId, decision: 'allow' })).toBe(false)
    expect(f.leaseRequest.mock.calls.at(-2)?.[1]).toBe('GET')
  })

  it('reveals the parent and keeps the hashed approval reference only in logs', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockResolvedValueOnce(false)
    await decide(f.event)
    expect(f.parent.restore).toHaveBeenCalledOnce(); expect(f.parent.show).toHaveBeenCalledOnce(); expect(f.parent.focus).toHaveBeenCalledOnce()
    expect(f.logInfo).toHaveBeenCalledWith('approval', 'Opening protected approval dialog.', expect.objectContaining({
      approvalRef: expect.stringMatching(/^sha256:[a-f0-9]{16}$/), windowBeforeReveal: expect.objectContaining({ minimized: true, visible: false })
    }))
    expect(JSON.stringify(electron.showProtectedDialog.mock.calls)).not.toContain('sha256:')
    expect(JSON.stringify(f.logInfo.mock.calls)).not.toContain('approval-secret')
    expect(JSON.stringify(f.logInfo.mock.calls)).not.toContain('git status')
  })

  it.each(['destroy', 'navigate'] as const)('does not submit when the parent/sender changes: %s', async (change) => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockImplementationOnce(async () => { f[change](); return true })
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
  })

  it.each(['status', 'target', 'arguments', 'workspace', 'title'] as const)('rejects a changed pending snapshot after confirmation: %s', async (field) => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockImplementationOnce(async () => {
      if (field === 'status') f.state.approval.status = 'allowed'
      if (field === 'target') f.state.approval.action.targets[0]!.value = 'rm -rf /work/project'
      if (field === 'arguments') f.state.approval.action.arguments.command = 'different preview'
      if (field === 'workspace') f.state.approval.action.workspace = '/other'
      if (field === 'title') f.state.title = 'Another task'
      return true
    })
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
  })

  it('exposes a current callback that detects same-ID action replacement', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockImplementationOnce(async (_parent, _content, current) => {
      expect(await current()).toBe(true)
      f.state.approval.action.targets[0]!.value = 'changed'
      expect(await current()).toBe(false)
      return false
    })
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
  })

  it('rechecks the sender after the final asynchronous approval snapshot read', async () => {
    const f = fixture()
    let reads = 0
    f.leaseRequest.mockImplementation(async (_path, method) => {
      if (method === 'GET' && ++reads === 3) f.navigate()
      return { ok: true, status: 200, body: JSON.stringify(f.state) }
    })
    registerAppIpcHandlers(f.options)
    electron.showProtectedDialog.mockResolvedValueOnce(true)
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(reads).toBe(3)
    expect(writes(f)).toEqual([])
  })

  it.each(['user', 'policy'])('revalidates %s sender after lease acquisition', async (source) => {
    const f = fixture(), gate = createGate()
    f.acquireRuntimeRequestLease.mockImplementationOnce(async () => { await gate.promise; return { runtimeToken: 'token', request: f.leaseRequest } })
    registerAppIpcHandlers(f.options)
    const result = decide(f.event, { ...payload, source, decision: 'deny' })
    await vi.waitFor(() => expect(f.acquireRuntimeRequestLease).toHaveBeenCalledOnce())
    f.navigate(); gate.release()
    expect(await result).toEqual({ confirmed: false })
    expect(f.leaseRequest).not.toHaveBeenCalled()
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it('preserves Runtime-owned policy denial without showing a user dialog', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    expect(await decide(f.event, { ...payload, source: 'policy', decision: 'deny' })).toMatchObject({ confirmed: true })
    expect(writes(f)).toHaveLength(1)
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it('keeps remote users on their visible confirmation UI and validates the pending action', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    const sender = new RemoteClientSender('remote-client', () => undefined)
    expect(await decide(remoteInvokeEvent(sender))).toMatchObject({ confirmed: true })
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
    expect(f.leaseRequest.mock.calls.filter((call) => call[1] === 'GET').length).toBeGreaterThanOrEqual(2)
    expect(writes(f)).toHaveLength(1)
    sender.destroy()
  })

  it('does not submit a remote confirmation after its client disconnects', async () => {
    const f = fixture(), sender = new RemoteClientSender('remote-client', () => undefined)
    let reads = 0
    f.leaseRequest.mockImplementation(async (_path, method) => {
      if (method === 'GET' && ++reads === 2) sender.destroy()
      return { ok: true, status: 200, body: JSON.stringify(f.state) }
    })
    registerAppIpcHandlers(f.options)
    expect(await decide(remoteInvokeEvent(sender))).toEqual({ confirmed: false })
    expect(writes(f)).toEqual([])
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it('ignores unavailable or already resolved approvals without opening a dialog', async () => {
    const f = fixture(); registerAppIpcHandlers(f.options)
    f.state.approval.status = 'expired'
    expect(await decide(f.event)).toEqual({ confirmed: false })
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
    expect(writes(f)).toEqual([])
  })

  it('returns a redacted Runtime failure when lease acquisition fails', async () => {
    const f = fixture()
    f.acquireRuntimeRequestLease.mockRejectedValueOnce(new Error('/Users/private-user/runtime failed'))
    registerAppIpcHandlers(f.options)
    const result = await decide(f.event, { ...payload, source: 'policy', decision: 'deny' })
    expect(result).toMatchObject({ confirmed: true, response: { ok: false, body: expect.stringContaining('runtime_unhealthy') } })
    expect(JSON.stringify(result)).not.toContain('private-user')
    expect(JSON.stringify(f.logError.mock.calls)).not.toContain('private-user')
  })
})
