import type {
  HarnessCredentialMode,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import type { ModelCatalogPricing } from '../contracts/capabilities.js'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import type { HarnessCatalog } from '../harness/harness-catalog.js'
import type { HarnessDetector } from '../harness/harness-detector.js'
import { checkHarnessAdmission, type AdmissionResult } from '../harness/harness-admission.js'
import {
  recallSubagents,
  type SubagentRecallHit,
  type SubagentRoutingDocument
} from '../delegation/subagent-router.js'
import { quotaEntryFor, quotaUsedPercent } from './quota-snapshot.js'
import { reportLanguage, type ReportLanguage } from './user-report.js'

/**
 * Deterministic worker route selection (10 §3.2). `worker_create` without an
 * explicit `agent` runs this: every routable profile plus every ready harness
 * default is a candidate; admission filters first, then a fixed score
 * combines BM25 role recall, user preference order, quota pressure, recent
 * failures, and model cost tier.
 */

export type RouteCandidate = {
  route: HarnessRoute
  /** Set when the candidate is a profile-bound role (10 §3.1). */
  profileId?: string
  /** Display label: profile name or harness displayName. */
  label: string
  admission: AdmissionResult
  /** Why the candidate is unusable (invalid config or failed admission). */
  rejectedReason?: string
}

export type WorkerSelectorDeps = {
  catalog: Pick<HarnessCatalog, 'list' | 'get' | 'isDisabled'>
  detector: Pick<HarnessDetector, 'status'>
  capabilitiesForRoute(route: HarnessRoute): Promise<HarnessCapabilities>
  /** Routing-visible profiles for the manager workspace (10 §3.1 docs). */
  profiles(workspace: string): Promise<SubagentRoutingDocument[]>
  /** 60s quota snapshot; null when probing failed (does not block selection). */
  quota(): Promise<ProviderQuotaListResponse | null>
  /** User preference order from `agents.kun.harnesses.agentOrder`. */
  agentOrder(): readonly HarnessId[]
  /** Failed dispatch count for this team+harness within the last hour. */
  recentFailures(teamId: string, harnessId: HarnessId): Promise<number>
  /** 0 cheap / 1 mid / 2 expensive by catalog pricing; 0 when unknown. */
  modelCostTier(route: HarnessRoute): 0 | 1 | 2
  /** True when the worker runs in an isolated task workspace. */
  isolated: boolean
  unattended: boolean
  allowUnattendedFullAccess: boolean
  /** Manager thread's own model route; default for provider-sourced harnesses. */
  managerRoute(): { model?: string; providerId?: string }
  /**
   * Optional small-model arbitration (10 §3.2): consulted only when the top-2
   * deterministic scores differ by less than 0.05. Returning 'b' promotes the
   * runner-up; undefined/error keeps the deterministic order.
   */
  tieBreak?(input: {
    task: string
    a: RouteCandidate
    b: RouteCandidate
  }): Promise<'a' | 'b' | undefined>
  language?: () => string | undefined
}

export type WorkerRouteSelection = {
  route: HarnessRoute
  profileId?: string
  /** One-sentence host fact for the manager/user (10 §3.2). */
  reason: string
  /** Deterministic score of the winning candidate (10 §3.3). */
  score: number
  /** Runner-up candidates (up to 3), for WorkerRecord reproducibility. */
  alternatives: Array<RouteCandidate & { score: number }>
}

export class NoEligibleWorkerError extends Error {
  constructor(readonly rejections: readonly string[]) {
    super(
      rejections.length
        ? `No eligible worker route: ${rejections.join('; ')}`
        : 'No eligible worker route'
    )
    this.name = 'NoEligibleWorkerError'
  }
}

export function costTierFromPricing(pricing: ModelCatalogPricing | undefined): 0 | 1 | 2 {
  // No catalog pricing: treat as no cost signal (subscription/native-login
  // routes are prepaid for the user and stay unpenalized).
  if (!pricing) return 0
  const perMillion = pricing.inputUsdPerMillion + pricing.outputUsdPerMillion
  return perMillion < 3 ? 0 : perMillion < 25 ? 1 : 2
}

/** Quota pressure per 10 §3.2: >=95% excludes, >=80% penalizes 0.8. */
export function quotaPenalty(
  snapshot: ProviderQuotaListResponse | null,
  candidate: RouteCandidate
): { penalty: number; usedPercent?: number } {
  if (!snapshot) return { penalty: 0 }
  const entry = quotaEntryFor(snapshot, candidate.route)
  if (!entry || entry.status !== 'available') return { penalty: 0 }
  const tightest = quotaUsedPercent(entry)
  if (tightest === undefined) return { penalty: 0 }
  if (tightest >= 95) return { penalty: Number.POSITIVE_INFINITY, usedPercent: tightest }
  if (tightest >= 80) return { penalty: 0.8, usedPercent: tightest }
  return { penalty: 0, usedPercent: tightest }
}

const REJECTED_ADMISSION: AdmissionResult = {
  ok: false,
  code: 'capability_missing',
  missing: [],
  message: ''
}

async function buildCandidates(
  deps: WorkerSelectorDeps,
  input: { workspace: string; isolated: boolean }
): Promise<{ all: RouteCandidate[]; docs: SubagentRoutingDocument[] }> {
  const defs = deps.catalog.list().filter((def) => !(deps.catalog.isDisabled?.(def.id) ?? false))
  const byId = new Map(defs.map((def) => [def.id, def]))
  const manager = deps.managerRoute()
  const docs = await deps.profiles(input.workspace)
  const raw: Array<RouteCandidate & { doc?: SubagentRoutingDocument }> = []

  const routeFor = (
    defId: HarnessId,
    profile?: { model?: string; providerId?: string; credentialMode?: HarnessCredentialMode }
  ): { route: HarnessRoute; rejectedReason?: string } => {
    const def = byId.get(defId)
    if (!def) {
      return {
        route: { harnessId: defId, model: '-', credentialMode: 'provider' },
        rejectedReason: `unknown harness ${defId}`
      }
    }
    const credentialMode = profile?.credentialMode ?? def.credentialModes[0]
    if (!credentialMode || !def.credentialModes.includes(credentialMode)) {
      return {
        route: { harnessId: defId, model: '-', credentialMode: credentialMode ?? 'provider' },
        rejectedReason: `credentialMode ${credentialMode ?? '(none)'} is not supported by harness ${def.id}`
      }
    }
    const model =
      profile?.model?.trim() ||
      def.staticModels[0] ||
      (def.modelSource === 'provider' ? manager.model?.trim() : '') ||
      ''
    if (!model) {
      return {
        route: { harnessId: defId, model: '-', credentialMode },
        rejectedReason: `harness ${def.id} advertises no model; set agent.model explicitly`
      }
    }
    const providerId =
      credentialMode === 'native-login'
        ? undefined
        : profile?.providerId?.trim() ||
          (def.modelSource === 'provider' ? manager.providerId?.trim() : undefined)
    return {
      route: { harnessId: def.id, model, ...(providerId ? { providerId } : {}), credentialMode }
    }
  }

  // Profile-bound candidates (10 §3.1): a role pinned to a harness/model.
  for (const doc of docs) {
    const { route, rejectedReason } = routeFor(
      (doc.profile.harnessId ?? 'kun') as HarnessId,
      doc.profile
    )
    raw.push({
      route,
      profileId: doc.id,
      label: doc.profile.name ?? doc.id,
      admission: REJECTED_ADMISSION,
      rejectedReason,
      doc
    })
  }
  // Harness-default candidates: one per enabled harness.
  for (const def of defs) {
    const { route, rejectedReason } = routeFor(def.id)
    raw.push({
      route,
      label: def.displayName,
      admission: REJECTED_ADMISSION,
      rejectedReason
    })
  }

  const all = await Promise.all(
    raw.map(async ({ doc: _doc, ...candidate }) => {
      if (candidate.rejectedReason) return candidate
      const def = byId.get(candidate.route.harnessId)!
      const [effective, status] = await Promise.all([
        deps.capabilitiesForRoute(candidate.route),
        deps.detector.status(candidate.route.harnessId)
      ])
      const admission = checkHarnessAdmission({
        usage: 'manager-worker',
        harness: def,
        effective,
        status,
        workspace: { isolated: input.isolated },
        unattended: deps.unattended,
        allowUnattendedFullAccess: deps.allowUnattendedFullAccess
      })
      return admission.ok
        ? { ...candidate, admission }
        : { ...candidate, admission, rejectedReason: admission.message }
    })
  )
  return { all, docs }
}

function normalizedRecall(
  hits: readonly SubagentRecallHit[],
  candidate: RouteCandidate
): number {
  if (!candidate.profileId || !hits.length) return 0
  const hit = hits.find((entry) => entry.targetId === candidate.profileId)
  const max = hits[0]?.score ?? 0
  return hit && max > 0 ? hit.score / max : 0
}

function explainPick(input: {
  pick: RouteCandidate
  recallHit?: SubagentRecallHit
  quota: ProviderQuotaListResponse | null
  excluded: readonly HarnessId[]
  rejected: readonly RouteCandidate[]
  language: ReportLanguage
}): string {
  const { pick, language } = input
  const engine = `${pick.label}${pick.route.model ? ` (${pick.route.model})` : ''}`
  const notes: string[] = []
  for (const other of input.rejected) {
    const quota = quotaPenalty(input.quota, other)
    if (quota.penalty === Number.POSITIVE_INFINITY && quota.usedPercent !== undefined) {
      notes.push(language === 'zh'
        ? `${other.label} 额度已用 ${Math.round(quota.usedPercent)}%，暂不使用`
        : `${other.label} quota ${Math.round(quota.usedPercent)}% used, skipped`)
    } else if (other.rejectedReason) {
      notes.push(language === 'zh'
        ? `${other.label} 不可用：${other.rejectedReason}`
        : `${other.label} unavailable: ${other.rejectedReason}`)
    }
  }
  for (const id of input.excluded) {
    notes.push(language === 'zh' ? `${id} 已按审查要求排除` : `${id} excluded for cross-review`)
  }
  if (language === 'zh') {
    const fit = input.recallHit
      ? `适合该任务（命中角色「${input.recallHit.name}」）`
      : '无更匹配的角色，取可用默认'
    return `选择 ${engine}：${fit}${notes.length ? `；${notes.join('；')}` : ''}。`
  }
  const fit = input.recallHit
    ? `best fit for this task (matched "${input.recallHit.name}")`
    : 'no closer role match; using the best available default'
  return `Selected ${engine}: ${fit}${notes.length ? `; ${notes.join('; ')}` : ''}.`
}

export async function selectWorkerRoute(
  deps: WorkerSelectorDeps,
  input: {
    task: string
    role?: string
    /** Manager thread id — also the team id (09 §3.2). */
    teamId: string
    workspace: string
    exclude?: { harnessIds?: string[] }
  }
): Promise<WorkerRouteSelection> {
  const language = reportLanguage(deps.language?.())
  const excluded = new Set((input.exclude?.harnessIds ?? []) as HarnessId[])
  const { all, docs } = await buildCandidates(deps, {
    workspace: input.workspace,
    isolated: deps.isolated
  })
  const admitted = all.filter((candidate) => candidate.admission.ok)
  const eligible = admitted.filter((candidate) => !excluded.has(candidate.route.harnessId))
  const quota = await deps.quota()
  // Quota exhaustion is a hard exclusion (10 §3.2): >=95% drops a candidate.
  const quotaOk = eligible.filter(
    (candidate) => quotaPenalty(quota, candidate).penalty !== Number.POSITIVE_INFINITY
  )
  if (!quotaOk.length) {
    const rejectionList = all.map((candidate) => {
      const quotaInfo = quotaPenalty(quota, candidate)
      if (quotaInfo.penalty === Number.POSITIVE_INFINITY && quotaInfo.usedPercent !== undefined) {
        return `${candidate.label}: quota ${Math.round(quotaInfo.usedPercent)}% used`
      }
      if (excluded.has(candidate.route.harnessId)) return `${candidate.label}: excluded by caller`
      return `${candidate.label}: ${candidate.rejectedReason ?? 'not eligible'}`
    })
    throw new NoEligibleWorkerError(rejectionList)
  }

  const profileIds = new Set(quotaOk.map((candidate) => candidate.profileId).filter(Boolean))
  const admittedDocs = docs.filter((doc) => profileIds.has(doc.id))
  const hits = recallSubagents(`${input.role ?? ''}\n${input.task}`, admittedDocs)

  const order = deps.agentOrder()
  const failures = new Map<HarnessId, number>()
  const scored = await Promise.all(
    quotaOk.map(async (candidate) => {
      let recent = failures.get(candidate.route.harnessId)
      if (recent === undefined) {
        recent = await deps.recentFailures(input.teamId, candidate.route.harnessId)
        failures.set(candidate.route.harnessId, recent)
      }
      const prefIndex = order.indexOf(candidate.route.harnessId)
      const userPreference = prefIndex >= 0 ? (order.length - prefIndex) / order.length : 0
      const score =
        1.0 * normalizedRecall(hits, candidate) +
        0.5 * userPreference -
        quotaPenalty(quota, candidate).penalty -
        0.3 * recent -
        0.2 * deps.modelCostTier(candidate.route)
      return { candidate, score }
    })
  )
  // Deterministic ordering: score desc, then harnessId, then profileId.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidate.route.harnessId.localeCompare(b.candidate.route.harnessId) ||
      (a.candidate.profileId ?? '').localeCompare(b.candidate.profileId ?? '')
  )
  let pick = scored[0]!
  let arbitrated = false
  if (
    deps.tieBreak &&
    scored.length > 1 &&
    scored[0]!.score - scored[1]!.score < 0.05
  ) {
    const verdict = await deps
      .tieBreak({ task: input.task, a: scored[0]!.candidate, b: scored[1]!.candidate })
      .catch(() => undefined)
    if (verdict === 'b') {
      pick = scored[1]!
      arbitrated = true
    }
  }
  const recallHit = pick.candidate.profileId
    ? hits.find((hit) => hit.targetId === pick.candidate.profileId)
    : undefined
  const reason = explainPick({
    pick: pick.candidate,
    recallHit,
    quota,
    excluded: [...excluded],
    rejected: all.filter(
      (candidate) =>
        !candidate.admission.ok ||
        (quotaPenalty(quota, candidate).penalty === Number.POSITIVE_INFINITY &&
          !quotaOk.includes(candidate))
    ),
    language
  })
  return {
    route: pick.candidate.route,
    ...(pick.candidate.profileId ? { profileId: pick.candidate.profileId } : {}),
    reason: arbitrated
      ? `${reason} ${language === 'zh' ? '（小模型仲裁）' : '(small-model tie-break)'}`
      : reason,
    score: pick.score,
    alternatives: scored
      .filter((entry) => entry !== pick)
      .slice(0, 3)
      .map((entry) => ({ ...entry.candidate, score: entry.score }))
  }
}
