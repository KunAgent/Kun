import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { acpLaunchArgs, acpLaunchIdentity } from './acp-launch-args.js'
import { probeAcpHandshake } from './acp-handshake-probe.js'
import { startHarnessProcess, type HarnessProcess } from '../session/harness-process.js'
import { applyAcpSessionPermission } from '../runtime/acp/acp-session-permissions.js'
import { AcpError, type AcpConfigOption } from '../runtime/acp/acp-schema.js'
import type { AcpConnection } from '../runtime/acp/acp-connection.js'

vi.mock('../session/harness-process.js', async (original) => ({
  ...await original<typeof import('../session/harness-process.js')>(), startHarnessProcess: vi.fn()
}))
const catalog = new HarnessCatalog({ custom: () => [] })
const qoder = catalog.get('qoder')!
const option = (currentValue: string): AcpConfigOption => ({
  id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue,
  options: ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'].map(value => ({ value, name: value }))
})
const nativeError = () => new AcpError('agent_error', 'Internal error', {
  rpcCode: -32603, data: { details: 'unknown permission_mode: yolo' }
})

function fixture(currentValue: string) {
  const stdin = new PassThrough(), stdout = new PassThrough()
  const requests: Array<{ method: string; params: Record<string, string> }> = []
  const stop = vi.fn(async () => { stdout.end() })
  stdin.on('data', chunk => {
    const request = JSON.parse(chunk.toString())
    requests.push(request)
    const response = ['session/set_config_option', 'session/set_mode'].includes(request.method)
      ? { error: { code: -32603, message: 'Internal error', data: { details: 'unknown permission_mode: yolo' } } }
      : { result: request.method === 'initialize'
        ? { protocolVersion: 1, agentInfo: { name: 'qoder-cli', version: '1.1.79' }, agentCapabilities: {} }
        : { sessionId: 'fixture', configOptions: [option(currentValue)], modes: {
          currentModeId: currentValue, availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'Bypass Permissions' }]
        } } }
    queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\n'))
  })
  return { requests, stop, process: { stdin, stdout, stop, exit: new Promise(() => {}),
    sanitizedStderrTail: () => '' } as unknown as HarnessProcess }
}

describe('Qoder 1.1.79 permission startup', () => {
  it.each(['default', undefined])('does not elevate %s', mode => {
    expect(acpLaunchArgs(qoder, mode)).toEqual(['--acp', '--permission-mode', 'default'])
  })
  it('uses the native startup spelling only for an explicit bypass and isolates the pool', () => {
    expect(acpLaunchArgs(qoder, 'bypass_permissions')).toEqual(['--acp', '--permission-mode', 'bypass_permissions'])
    expect(acpLaunchIdentity('qodercli', qoder, 'bypass_permissions')).not.toBe(acpLaunchIdentity('qodercli', qoder, 'default'))
    expect(acpLaunchIdentity('qodercli', qoder, 'default')).toBe(acpLaunchIdentity('qodercli', qoder, undefined))
    expect(acpLaunchArgs({ ...qoder, id: 'custom-qoder', derivedFrom: 'qoder' }, 'bypass_permissions')).toEqual(acpLaunchArgs(qoder, 'bypass_permissions'))
  })
  it.each(['qoder-cn', 'opencode', 'devin'])('leaves %s launch behavior unchanged', id => {
    const definition = catalog.get(id)!
    expect(acpLaunchArgs(definition, 'bypass_permissions')).toEqual(definition.launch!.args)
    expect(acpLaunchIdentity('cli', definition, 'default')).toBe(acpLaunchIdentity('cli', definition, 'bypass_permissions'))
  })
  it.each([['default', 'default'], ['bypass_permissions', 'yolo'], ['yolo', 'yolo']])('probes %s without a broken setter or prompt', async (mode, currentValue) => {
    const child = fixture(currentValue)
    vi.mocked(startHarnessProcess).mockResolvedValueOnce(child.process)
    expect(await probeAcpHandshake(qoder, 'qodercli', { session: { permissionMode: mode } })).toMatchObject({ ok: true })
    expect(startHarnessProcess).toHaveBeenLastCalledWith(expect.objectContaining({ args: ['--acp', '--permission-mode', mode === 'yolo' ? 'bypass_permissions' : mode] }))
    expect(child.requests.map(r => r.method)).toEqual(['initialize', 'session/new'])
    expect(child.stop).toHaveBeenCalledOnce()
    expect(existsSync(child.requests[1].params.cwd)).toBe(false)
  })
  it('fails closed if the process ignores the startup flag, retaining the native cause', async () => {
    const child = fixture('default')
    vi.mocked(startHarnessProcess).mockResolvedValueOnce(child.process)
    expect(await probeAcpHandshake(qoder, 'qodercli', { session: { permissionMode: 'bypass_permissions' } }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('unknown permission_mode: yolo') })
    expect(child.requests.map(r => r.method)).toEqual(['initialize', 'session/new', 'session/set_config_option'])
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it('keeps a timed-out setter as policy denial so restoration cannot silently rebase', async () => {
    const request = vi.fn().mockRejectedValue(new AcpError('request_timeout', 'permission request timed out'))
    await expect(applyAcpSessionPermission({ rpc: { request } } as unknown as AcpConnection,
      { sessionId: 's', configOptions: [option('default')] }, 'bypass_permissions', qoder.acpPermission))
      .rejects.toMatchObject({ code: 'policy_denied', message: expect.stringContaining('permission request timed out') })
    expect(request).toHaveBeenCalledOnce()
  })
  it('verifies fresh and restored session metadata rather than trusting startup args', async () => {
    const request = vi.fn().mockRejectedValue(nativeError())
    const conn = { rpc: { request } } as unknown as AcpConnection
    for (const sessionId of ['new', 'restored']) {
      await applyAcpSessionPermission(conn, { sessionId, configOptions: [option('yolo')] }, 'bypass_permissions', qoder.acpPermission)
      await expect(applyAcpSessionPermission(conn, { sessionId, configOptions: [option('default')] }, 'bypass_permissions', qoder.acpPermission))
        .rejects.toMatchObject({ code: 'policy_denied', rpcCode: -32603, message: expect.stringContaining('session/set_config_option') })
    }
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each(['request_aborted', 'auth_required'] as const)('preserves %s without retrying', async code => {
    const error = code === 'auth_required' ? new AcpError('agent_error', 'Authentication required', { rpcCode: -32000 })
      : new AcpError(code, code)
    const request = vi.fn().mockRejectedValue(error)
    await expect(applyAcpSessionPermission({ rpc: { request } } as unknown as AcpConnection,
      { sessionId: 's', configOptions: [option('default')] }, 'bypass_permissions', qoder.acpPermission)).rejects.toBe(error)
    expect(request).toHaveBeenCalledOnce()
  })
  it.each(['QODER_PERSONAL_ACCESS_TOKEN=private-secret', '{"QODER_PERSONAL_ACCESS_TOKEN":"private-secret"}'])('redacts and bounds native permission diagnostics: %s', async credential => {
    const request = vi.fn().mockRejectedValue(new AcpError('agent_error', 'Internal error', {
      rpcCode: -32603, data: { details: `unknown permission_mode: yolo ${credential} ${'x'.repeat(1000)}` }
    }))
    const error = await applyAcpSessionPermission({ rpc: { request } } as unknown as AcpConnection,
      { sessionId: 's', configOptions: [option('default')] }, 'bypass_permissions', qoder.acpPermission).catch(e => e)
    expect(error.message).toContain('unknown permission_mode: yolo')
    expect(error.message).not.toContain('private-secret')
    expect(error.message.length).toBeLessThan(600)
  })
})
