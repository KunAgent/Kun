import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import type { RoomContinuation } from './room-continuation-dispatch.js'

/** The Main process owns the account and per-task user consent; absence always denies. */
export async function assistantContinuationAuthority(options: KunServeRuntimeOptions, input: RoomContinuation): Promise<{ authorized: boolean; unavailable?: boolean; result?: { id: string; body: string } }> {
  const server = options.capabilities?.mcp?.servers?.kun_assistants
  if (!server?.enabled || server.transport !== 'stdio' || !server.args.includes('--kun-assistant-mcp-server')) return { authorized: false, unavailable: true }
  const arg = (name: string) => { const i = server.args.indexOf(name); return i < 0 ? '' : server.args[i + 1] ?? '' }
  const socketPath = arg('--socket'), secretPath = arg('--secret-file')
  if (!socketPath || !secretPath || !input.assistantTaskId || !input.assistantOwnerId || !input.assistantResultId || !input.sourceCallId || !input.goalCreatedAt || !input.sourceFingerprint) return { authorized: false }
  let secret: string
  try { secret = (await readFile(secretPath, 'utf8')).trim() } catch { return { authorized: false, unavailable: true } }
  if (!/^[a-f0-9]{64}$/.test(secret)) return { authorized: false, unavailable: true }
  const body = JSON.stringify({ taskId: input.assistantTaskId, owner: input.assistantOwnerId, resultId: input.assistantResultId,
    goalCreatedAt: input.goalCreatedAt, sourceFingerprint: input.sourceFingerprint, source: { threadId: input.threadId, turnId: input.sourceTurnId, callId: input.sourceCallId } })
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = request({ socketPath, path: '/tasks/continuation-authority', method: 'POST', timeout: 5000,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { text += chunk; if (text.length > 65536) req.destroy(new Error('authority response too large')) })
        response.on('end', () => { try { resolve(JSON.parse(text)) } catch { reject(new Error('invalid authority response')) } })
      })
      req.on('timeout', () => req.destroy(new Error('authority timeout'))); req.on('error', reject); req.end(body)
    })
    if (!value || typeof value !== 'object') return { authorized: false }
    const outer = value as { ok?: unknown; result?: { authorized?: unknown; unavailable?: unknown; result?: { id?: unknown; body?: unknown } } }
    const result = outer.result?.result
    if (outer.ok === true && outer.result?.authorized === false) return { authorized: false, unavailable: outer.result.unavailable === true }
    if (outer.ok !== true) return { authorized: false, unavailable: true }
    if (outer.result?.authorized !== true || result?.id !== input.assistantResultId || typeof result.body !== 'string' || Buffer.byteLength(result.body) > 32768) return { authorized: false }
    return { authorized: true, result: { id: result.id, body: result.body } }
  } catch { return { authorized: false, unavailable: true } }
}
