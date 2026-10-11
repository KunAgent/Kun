import { randomUUID } from 'node:crypto'
import type { HarnessRoute } from '../../contracts/harness.js'
import { harnessProfileKey } from '../../harness/harness-readiness-profile.js'
import type { HarnessReadinessService } from '../../harness/harness-readiness.js'
import type { TerminalAgentRegistry } from '../../services/terminal-agent-registry.js'

type Admission = { id: string; key: string; command: string; route: HarnessRoute; expiresAt: number; readiness: HarnessReadinessService }
const admissions = new WeakMap<TerminalAgentRegistry, Map<string, Admission>>()
export async function prepareTerminalLaunch(readiness: HarnessReadinessService, route: HarnessRoute, signal: AbortSignal,
  signature = readiness.configurationSignature(route)): Promise<Admission> {
  const profile = (await readiness.readyProfiles(route.harnessId)).find((value) => harnessProfileKey(value) === harnessProfileKey(route))
  const expiresAt = Date.parse(profile?.expiresAt ?? '')
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Agent readiness expired; check it before launching')
  const id = randomUUID(), key = `terminal-launch:${id}`
  try {
    await readiness.prepareTurn(key, id, route, signature, signal)
    const command = readiness.commandForTurn(key, id)
    if (!command) throw new Error('Agent launch has no checked executable')
    return { id, key, command, route, expiresAt, readiness }
  } catch (error) { readiness.releaseTurn(key, id); throw error }
}
export function rememberTerminalLaunch(registry: TerminalAgentRegistry, unitId: string, admission: Admission): void {
  let values = admissions.get(registry)
  if (!values) { values = new Map(); admissions.set(registry, values) }
  values.set(unitId, admission)
}
export function releaseTerminalLaunch(registry: TerminalAgentRegistry, unitId: string): void {
  const values = admissions.get(registry), admission = values?.get(unitId)
  if (admission) admission.readiness.releaseTurn(admission.key, admission.id)
  values?.delete(unitId)
}
export async function validateTerminalLaunch(registry: TerminalAgentRegistry, unitId: string, admissionId: string, signal: AbortSignal): Promise<string> {
  const admission = admissions.get(registry)?.get(unitId)
  if (!admission || admission.id !== admissionId) throw new Error('Terminal launch admission is unavailable')
  if (admission.expiresAt <= Date.now()) throw new Error('Agent readiness expired; check it before launching')
  await admission.readiness.validateTurn(admission.key, admission.id, signal, admission.route)
  if (admissions.get(registry)?.get(unitId) !== admission || admission.expiresAt <= Date.now() ||
    admission.readiness.commandForTurn(admission.key, admission.id) !== admission.command) {
    throw new Error('Terminal Agent launch changed during validation')
  }
  return admission.command
}
