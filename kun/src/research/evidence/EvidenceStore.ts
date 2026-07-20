/**
 * [INPUT]: 依赖 research agents 的 WorkerResult、ResearchRunRepository 和 evidence 类型契约
 * [OUTPUT]: 对外提供 EvidenceStore 与悬空原子论断补全函数，负责来源、证据片段、忠实论断的规范去重，以及笔记和引用绑定的恢复、内存索引与落盘
 * [POS]: research/evidence 的证据账本，hydrate/canonicalize/add 都会先从原始 normalizedText 补全截在连接词后的 claim，再拒绝不忠实 claim，并保证 claim -> evidence span -> source 引用链完整可追溯
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WorkerResult } from '../agents/types.js'
import type { ResearchRunRepository, ResearchRunLayout } from '../storage/ResearchRunRepository.js'
import { sourceIdentityKey } from './EvidenceEligibility.js'
import { assessClaimFaithfulness } from './ClaimSupport.js'
import type { AtomicClaim, CitationBinding, EvidenceLedgerEntry, EvidenceSpan, ResearchNote, SourceRecord } from './types.js'

export class EvidenceStore {
  private readonly sourceById = new Map<string, SourceRecord>()
  private readonly sourceIdByIdentity = new Map<string, string>()
  private readonly sourceIdByFingerprint = new Map<string, string>()
  private readonly spanById = new Map<string, EvidenceSpan>()
  private readonly spanIdByIdentity = new Map<string, string>()
  private readonly claimById = new Map<string, AtomicClaim>()
  private readonly noteById = new Map<string, ResearchNote>()
  private readonly citationById = new Map<string, CitationBinding>()

  constructor(
    private readonly repository: ResearchRunRepository,
    private readonly layout: ResearchRunLayout
  ) {}

  async hydrate(): Promise<void> {
    const [entries, claims, citations] = await Promise.all([
      this.repository.readJsonl<EvidenceLedgerEntry>(this.layout.evidenceJsonlPath),
      this.repository.readJsonl<AtomicClaim>(this.layout.claimsJsonlPath),
      this.repository.readJsonl<CitationBinding>(this.layout.citationsJsonlPath)
    ])
    for (const entry of entries) {
      if (entry.kind !== 'source') continue
      const source = entry.record
      this.sourceById.set(source.id, source)
      this.sourceIdByIdentity.set(sourceIdentityKey(source), source.id)
      this.sourceIdByFingerprint.set(sourceFingerprintIdentityKey(source), source.id)
    }
    for (const entry of entries) {
      if (entry.kind !== 'evidence_span' || !this.sourceById.has(entry.record.sourceId)) continue
      this.spanById.set(entry.record.id, entry.record)
      this.spanIdByIdentity.set(spanIdentityKey(entry.record), entry.record.id)
    }
    for (const claim of claims) {
      const repairedClaim = repairDanglingAtomicClaimText(claim)
      const supportSpans = repairedClaim.supportSpanIds.map((spanId) => this.spanById.get(spanId)).filter(Boolean)
      if (supportSpans.length === repairedClaim.supportSpanIds.length &&
        assessClaimFaithfulness(repairedClaim.text, supportSpans.map((span) => span!.text)).faithful) {
        this.claimById.set(repairedClaim.id, repairedClaim)
      }
    }
    for (const entry of entries) {
      if (entry.kind !== 'research_note') continue
      if (entry.record.claimIds.every((claimId) => this.claimById.has(claimId))) {
        this.noteById.set(entry.record.id, entry.record)
      }
    }
    for (const citation of citations) {
      this.citationById.set(citation.id, citation)
    }
  }

  canonicalizeWorkerResult(result: WorkerResult): WorkerResult {
    const canonicalSourceIdByIdentity = new Map(this.sourceIdByIdentity)
    const canonicalSourceIdByFingerprint = new Map(this.sourceIdByFingerprint)
    const sourceIdMap = new Map<string, string>()
    const sources: SourceRecord[] = []

    for (const source of result.sources) {
      const existingId = this.sourceById.has(source.id)
        ? source.id
        : canonicalSourceIdByIdentity.get(sourceIdentityKey(source)) ?? canonicalSourceIdByFingerprint.get(sourceFingerprintIdentityKey(source))
      const canonicalId = existingId ?? source.id
      sourceIdMap.set(source.id, canonicalId)
      if (existingId) continue
      canonicalSourceIdByIdentity.set(sourceIdentityKey(source), source.id)
      canonicalSourceIdByFingerprint.set(sourceFingerprintIdentityKey(source), source.id)
      sources.push(source)
    }

    const canonicalSpanIdByIdentity = new Map(this.spanIdByIdentity)
    const spanIdMap = new Map<string, string>()
    const evidenceSpans: EvidenceSpan[] = []
    for (const span of result.evidenceSpans) {
      const canonicalSpan = {
        ...span,
        sourceId: sourceIdMap.get(span.sourceId) ?? span.sourceId
      }
      const identity = spanIdentityKey(canonicalSpan)
      const existingId = this.spanById.has(canonicalSpan.id)
        ? canonicalSpan.id
        : canonicalSpanIdByIdentity.get(identity)
      const canonicalId = existingId ?? canonicalSpan.id
      spanIdMap.set(span.id, canonicalId)
      if (existingId) continue
      canonicalSpanIdByIdentity.set(identity, canonicalSpan.id)
      evidenceSpans.push(canonicalSpan)
    }

    const canonicalClaimIdByIdentity = new Map<string, string>()
    for (const claim of this.claimById.values()) {
      canonicalClaimIdByIdentity.set(claimIdentityKey(claim), claim.id)
    }
    const claimIdMap = new Map<string, string>()
    const claims: AtomicClaim[] = []
    for (const claim of result.claims) {
      const canonicalClaim = repairDanglingAtomicClaimText({
        ...claim,
        supportSpanIds: [...new Set(claim.supportSpanIds.map((spanId) => spanIdMap.get(spanId) ?? spanId))]
      })
      const identity = claimIdentityKey(canonicalClaim)
      const existingId = this.claimById.has(canonicalClaim.id)
        ? canonicalClaim.id
        : canonicalClaimIdByIdentity.get(identity)
      claimIdMap.set(claim.id, existingId ?? canonicalClaim.id)
      if (existingId) continue
      canonicalClaimIdByIdentity.set(identity, canonicalClaim.id)
      claims.push(canonicalClaim)
    }

    return {
      ...result,
      sources,
      evidenceSpans,
      claims,
      notes: result.notes.map((note) => ({
        ...note,
        claimIds: [...new Set(note.claimIds.map((claimId) => claimIdMap.get(claimId) ?? claimId))]
      })),
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        claimIds: [...new Set(conflict.claimIds.map((claimId) => claimIdMap.get(claimId) ?? claimId))]
      })).filter((conflict) => conflict.claimIds.length >= 2)
    }
  }

  async recordWorkerResult(result: WorkerResult): Promise<WorkerResult> {
    const canonical = this.canonicalizeWorkerResult(result)
    for (const source of canonical.sources) {
      await this.addSource(source)
    }
    for (const span of canonical.evidenceSpans) {
      await this.addEvidenceSpan(span)
    }
    for (const claim of canonical.claims) {
      await this.addClaim(claim)
    }
    for (const note of canonical.notes) {
      await this.addNote(note)
    }
    return canonical
  }

  async addSource(source: SourceRecord): Promise<SourceRecord> {
    const existing = this.sourceById.get(source.id)
    if (existing) {
      return existing
    }
    const identity = sourceIdentityKey(source)
    const fingerprintIdentity = sourceFingerprintIdentityKey(source)
    const duplicateId = this.sourceIdByIdentity.get(identity) ?? this.sourceIdByFingerprint.get(fingerprintIdentity)
    if (duplicateId) {
      return this.sourceById.get(duplicateId) ?? source
    }
    this.sourceById.set(source.id, source)
    if (!this.sourceIdByIdentity.has(identity)) {
      this.sourceIdByIdentity.set(identity, source.id)
    }
    if (!this.sourceIdByFingerprint.has(fingerprintIdentity)) {
      this.sourceIdByFingerprint.set(fingerprintIdentity, source.id)
    }
    await this.repository.appendEvidenceEntry(this.layout, { kind: 'source', record: source })
    return source
  }

  async addEvidenceSpan(span: EvidenceSpan): Promise<EvidenceSpan> {
    if (!this.sourceById.has(span.sourceId)) {
      throw new Error(`EvidenceSpan ${span.id} references unknown source ${span.sourceId}`)
    }
    const existing = this.spanById.get(span.id)
    if (existing) {
      return existing
    }
    this.spanById.set(span.id, span)
    const identity = spanIdentityKey(span)
    if (!this.spanIdByIdentity.has(identity)) {
      this.spanIdByIdentity.set(identity, span.id)
    }
    await this.repository.appendEvidenceEntry(this.layout, { kind: 'evidence_span', record: span })
    return span
  }

  async addClaim(claim: AtomicClaim): Promise<AtomicClaim> {
    const repairedClaim = repairDanglingAtomicClaimText(claim)
    const supportSpans: EvidenceSpan[] = []
    for (const spanId of repairedClaim.supportSpanIds) {
      const span = this.spanById.get(spanId)
      if (!span) {
        throw new Error(`AtomicClaim ${repairedClaim.id} references unknown evidence span ${spanId}`)
      }
      supportSpans.push(span)
    }
    const faithfulness = assessClaimFaithfulness(repairedClaim.text, supportSpans.map((span) => span.text))
    if (!faithfulness.faithful) {
      throw new Error(`AtomicClaim ${repairedClaim.id} is not faithful to its evidence spans: ${faithfulness.reasons.join(', ')}`)
    }
    if (!this.claimById.has(repairedClaim.id)) {
      this.claimById.set(repairedClaim.id, repairedClaim)
      await this.repository.appendClaim(this.layout, repairedClaim)
    }
    return this.claimById.get(repairedClaim.id) ?? repairedClaim
  }

  async addNote(note: ResearchNote): Promise<ResearchNote> {
    for (const claimId of note.claimIds) {
      if (!this.claimById.has(claimId)) {
        throw new Error(`ResearchNote ${note.id} references unknown claim ${claimId}`)
      }
    }
    if (!this.noteById.has(note.id)) {
      this.noteById.set(note.id, note)
      await this.repository.appendEvidenceEntry(this.layout, { kind: 'research_note', record: note })
    }
    return this.noteById.get(note.id) ?? note
  }

  async addCitation(binding: CitationBinding): Promise<CitationBinding> {
    if (!this.citationById.has(binding.id)) {
      this.citationById.set(binding.id, binding)
      await this.repository.appendCitation(this.layout, binding)
    }
    return this.citationById.get(binding.id) ?? binding
  }

  listSources(): SourceRecord[] {
    return [...this.sourceById.values()]
  }

  listEvidenceSpans(): EvidenceSpan[] {
    return [...this.spanById.values()]
  }

  listClaims(): AtomicClaim[] {
    return [...this.claimById.values()]
  }

  listNotes(): ResearchNote[] {
    return [...this.noteById.values()]
  }

  listCitations(): CitationBinding[] {
    return [...this.citationById.values()]
  }

  getEvidenceSpan(id: string): EvidenceSpan | undefined {
    return this.spanById.get(id)
  }

  getClaim(id: string): AtomicClaim | undefined {
    return this.claimById.get(id)
  }
}

export type { EvidenceLedgerEntry }

const DANGLING_CLAIM_CONNECTOR_RE = /(?:\b(?:and|or|but|because|if|when|while|with|without|using|including|as|to|from|of|for|the|a|an|receive|return|be|been|is|are|was|were|rather\s+than|instead\s+of)\b|(?:以及|并且|而|但|因为|由于|通过|包括|例如|即|与|和|或|从|向|对|为|在))\s*$/iu

export function repairDanglingExcerptText(text: string, normalizedText?: string): string {
  const candidate = text.trim()
  const sourceText = normalizedText?.trim() ?? ''
  if (!candidate || !sourceText || !DANGLING_CLAIM_CONNECTOR_RE.test(candidate)) return candidate
  const start = sourceText.indexOf(candidate)
  if (start < 0) return candidate
  const continuation = sourceText.slice(start + candidate.length, start + candidate.length + 220)
  const sentenceEnd = continuation.match(/^[\s\S]{1,180}?(?:[。！？!?]|\.(?=\s|$))/u)?.[0]
  if (!sentenceEnd) return candidate
  const completed = `${candidate}${sentenceEnd}`.replace(/\s+/gu, ' ').trim()
  return completed.length <= 440 ? completed : candidate
}

export function repairDanglingAtomicClaimText(claim: AtomicClaim): AtomicClaim {
  const repairedText = repairDanglingExcerptText(claim.text, claim.normalizedText)
  return repairedText === claim.text.trim()
    ? claim
    : { ...claim, text: repairedText }
}

function spanIdentityKey(span: EvidenceSpan): string {
  return `${span.sourceId}\n${span.text.replace(/\s+/g, ' ').trim()}`
}

function sourceFingerprintIdentityKey(source: SourceRecord): string {
  const trustBoundary = sourceIdentityKey(source).split(':', 1)[0]
  return `${trustBoundary}:${source.fingerprint}`
}

function claimIdentityKey(claim: AtomicClaim): string {
  const text = (claim.normalizedText ?? claim.text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
  return `${text}\n${[...new Set(claim.supportSpanIds)].sort().join('\n')}`
}
