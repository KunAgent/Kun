import { z } from 'zod'
import type { RoomRule, RoomRuleBundle, RoomAgreementContext } from '../contracts/rooms-product.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomStore, RoomStoredDocument } from './room-store.js'
import { putRoomDocument, roomFingerprint } from './room-service.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import { roomRuleCompressionPrompt } from './room-ax-surfaces.js'

export class RoomContextPending extends Error {}
const POLICY = 1
type Unit = { keys: string[]; text: string }
export type RuleCompression = {
  bundleId: string; ownerRequestId: string; status: 'pending' | 'running' | 'completed' | 'failed'
  model: string; budget: number; units: Unit[]; outputs: Unit[]; index: number; level: number
  attempt: number; generation: number; threadId?: string; turnId?: string; error?: string; summary?: string
}
const byteLength = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
function pieces(text: string, bytes: number): string[] {
  const result: string[] = []
  let part = '', length = 0
  for (const char of text) {
    const size = Buffer.byteLength(char)
    if (length + size > bytes && part) { result.push(part); part = ''; length = 0 }
    part += char; length += size
  }
  if (part) result.push(part)
  return result
}
function pack(units: Unit[], budget: number): Unit[] {
  const result: Unit[] = []
  for (const unit of units) {
    const previous = result.at(-1)
    if (previous && byteLength({ keys: [...previous.keys, ...unit.keys], text: previous.text + '\n' + unit.text }) < budget) {
      previous.keys.push(...unit.keys)
      previous.text += '\n' + unit.text
    } else result.push(structuredClone(unit))
  }
  return result
}

export async function loadRoomRuleBundle(store: RoomStore, roomId: string, bundleId: string) {
  const bundle = await store.get<RoomRuleBundle>('rule_bundle', bundleId)
  if (!bundle || bundle.roomId !== roomId) throw new Error('agreement bundle not found')
  return bundle.value
}
export async function roomBundleRules(store: RoomStore, roomId: string, bundleId: string): Promise<RoomRule[]> {
  const bundle = await loadRoomRuleBundle(store, roomId, bundleId)
  const rules: RoomRule[] = []
  for (const ref of bundle.references) {
    const row = await store.get<RoomRule>('rule_version', ref.id + '-v' + ref.version)
    if (!row || row.roomId !== roomId || roomFingerprint(row.value.body) !== ref.hash) throw new Error('frozen agreement version unavailable')
    rules.push(row.value)
  }
  return rules
}
async function freezeRules(store: RoomStore, roomId: string, rules: RoomRule[]) {
  const references = rules.map((rule) => ({ id: rule.id, version: rule.version, hash: roomFingerprint(rule.body) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const id = 'rules-' + roomFingerprint({ roomId, references })
  if (await store.get('rule_bundle', id)) return id
  for (const rule of rules) {
    const versionId = rule.id + '-v' + rule.version
    const version = await store.get<RoomRule>('rule_version', versionId)
    if (version && (version.roomId !== roomId || version.value.body !== rule.body)) throw new Error('agreement version identity conflict')
    if (!version) await store.commit({ requestId: 'freeze-' + roomFingerprint({ roomId, versionId, rule }),
      checks: [{ kind: 'rule_version', id: versionId, expectedRevision: null }],
      puts: [{ kind: 'rule_version', id: versionId, roomId, value: rule }] })
  }
  await store.commit({ requestId: id, checks: [{ kind: 'rule_bundle', id, expectedRevision: null }],
    puts: [{ kind: 'rule_bundle', id, roomId, value: { roomId, references } }] })
  return id
}

export async function prepareRoomAgreements(deps: RoomRuntimeDeps, request: RoomRequestState,
  suppliedRules: RoomRule[], contextBudget: number): Promise<{ rules: RoomRule[]; agreements: RoomAgreementContext }> {
  const rules = [...suppliedRules].sort((a, b) => a.id.localeCompare(b.id))
  const bundleId = await freezeRules(deps.store, request.roomId, rules)
  const budget = Math.min(8000, Math.floor(contextBudget * 0.55))
  const base = { bundleId, count: rules.length, policyVersion: POLICY }
  if (byteLength(rules) <= budget) { request.contextState = 'ready'; return { rules, agreements: { ...base, compressed: false } } }
  const coordinator = request.roomSnapshot.members.find((member) => member.id === request.roomSnapshot.defaultMemberId)!
  const profile = deps.profiles()[coordinator.presetId]
  const model = coordinator.modelRef ?? (profile?.model && profile.providerId ?
    { model: profile.model, providerId: profile.providerId } : deps.model())
  const modelKey = JSON.stringify(model)
  const id = 'compression-' + roomFingerprint({ bundleId, modelKey, budget, policy: POLICY })
  let row = await deps.store.get<RuleCompression>('rule_compression', id)
  if (!row) {
    const units = pack(rules.flatMap((rule) => pieces(rule.body, 6000).map((text, part) => ({
      keys: [rule.id + '@' + rule.version + '#' + part],
      text: rule.id + ' v' + rule.version + ' part ' + part + '\n' + text
    }))), 11000)
    await putRoomDocument(deps.store, 'rule_compression', id, request.roomId, {
      bundleId, ownerRequestId: request.id, status: 'pending', model: modelKey, budget,
      units, outputs: [], index: 0, level: 0, attempt: 0, generation: 0
    } satisfies RuleCompression, null)
    row = (await deps.store.get<RuleCompression>('rule_compression', id))!
  }
  if (row.value.status === 'completed') { request.contextState = 'ready'; return { rules: [], agreements: {
    ...base, compressed: true, summary: row.value.summary!, model: modelKey } } }
  if (row.value.status === 'failed') {
    // A deliberate request retry starts a fresh bounded attempt; polling never loops the failure.
    if (request.compressionId === id) throw new Error(row.value.error ?? 'Agreement compression failed; retry the request.')
    await putRoomDocument(deps.store, 'rule_compression', id, request.roomId, {
      ...row.value, ownerRequestId: request.id, status: 'pending', attempt: 0,
      threadId: undefined, turnId: undefined, error: undefined, generation: row.value.generation + 1
    }, row)
    row = (await deps.store.get<RuleCompression>('rule_compression', id))!
  }
  if (request.compressionId !== id) {
    const stored = await deps.store.get<RoomRequestState>('request', request.id)
    if (stored) await putRoomDocument(deps.store, 'request', request.id, request.roomId,
      { ...stored.value, compressionId: id, contextState: 'compressing' }, stored)
    throw new RoomContextPending('Project agreements are being compressed automatically.')
  }
  await advanceCompression(deps, request, row, coordinator)
  throw new RoomContextPending('Project agreements are being compressed automatically.')
}

async function advanceCompression(deps: RoomRuntimeDeps, request: RoomRequestState,
  row: RoomStoredDocument<RuleCompression>, coordinator: RoomRequestState['roomSnapshot']['members'][number]) {
  const value = structuredClone(row.value)
  const unit = value.units[value.index]
  if (!unit) throw new Error('agreement compression input is unavailable')
  if (!value.turnId) {
    value.threadId ??= 'room-rules-' + roomFingerprint({ id: row.id, level: value.level, index: value.index,
      attempt: value.attempt, generation: value.generation }).slice(0, 48)
    // Save admission identity before enqueueing. Other requests may reuse the result.
    if (row.value.threadId !== value.threadId) {
      await putRoomDocument(deps.store, 'rule_compression', row.id, request.roomId, value, row)
      return
    }
    await ensureRoomThread(deps, { id: value.threadId, roomId: request.roomId, requestId: request.id,
      member: { ...coordinator, roleNotes: '', modelRef: { ...JSON.parse(value.model), providerId: JSON.parse(value.model).providerId ?? 'default' },
        capabilityOverrides: { allowedTools: [], blockedTools: [], blockedMcpServers: [], blockedSkills: [], skillsEnabled: false } },
      profile: { mode: 'primary', allowedTools: [], skillsEnabled: false, toolPolicy: 'readOnly' }, kind: 'discussion' })
    const prompt = roomRuleCompressionPrompt({ budget: value.budget, sources: unit.keys, text: unit.text, priorError: value.error })
    value.turnId = await enqueueRoomTurn(deps, value.threadId, value.threadId, prompt)
    value.status = 'running'
  } else {
    const observed = await observeRoomTurn(deps, value.threadId!, value.turnId)
    if (['running', 'queued'].includes(observed.status)) return
    try {
      if (observed.status !== 'completed') throw new Error(observed.error ?? 'compression execution interrupted')
      const result = z.object({ sources: z.array(z.string()).min(1), summary: z.string().trim().min(1) }).strict()
        .parse(JSON.parse(observed.text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '')))
      if (JSON.stringify([...result.sources].sort()) !== JSON.stringify([...unit.keys].sort())) throw new Error('source coverage does not match')
      if (byteLength(result.summary) > Math.min(3500, value.budget)) throw new Error('summary exceeds its byte budget')
      value.outputs.push({ keys: unit.keys, text: result.summary })
      value.index++
      value.attempt = 0
      value.error = undefined
      value.threadId = undefined
      value.turnId = undefined
      value.status = 'pending'
      if (value.index === value.units.length) {
        const text = value.outputs.map((output) => output.text).join('\n')
        if (byteLength(text) <= value.budget) {
          value.status = 'completed'
          value.summary = text
        } else {
          if (value.level >= 3 || byteLength(text) >= byteLength(value.units.map((unit) => unit.text).join('\n'))) {
            throw new Error('agreements could not be compressed within the budget; original versions are preserved')
          }
          value.units = pack(value.outputs, 11000)
          value.outputs = []
          value.index = 0
          value.level++
        }
      }
    } catch (error) {
      Object.assign(value, structuredClone(row.value))
      value.error = 'Agreement compression: ' + (error instanceof Error ? error.message : String(error))
      if (++value.attempt > 2) value.status = 'failed'
      else { value.threadId = undefined; value.turnId = undefined; value.status = 'pending' }
    }
  }
  await putRoomDocument(deps.store, 'rule_compression', row.id, request.roomId, value, row)
}
