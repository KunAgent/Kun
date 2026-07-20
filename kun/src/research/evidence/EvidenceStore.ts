/**
 * [INPUT]: 依赖 research agents 的 WorkerResult、ResearchRunRepository 和 evidence 类型契约
 * [OUTPUT]: 对外提供 EvidenceStore，负责来源、证据片段、论断、笔记和引用绑定的内存索引与落盘
 * [POS]: research/evidence 的证据账本，保证 claim -> evidence span -> source 引用链在运行时完整可追溯
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WorkerResult } from '../agents/types.js'
import type { ResearchRunRepository, ResearchRunLayout } from '../storage/ResearchRunRepository.js'
import type { AtomicClaim, CitationBinding, EvidenceLedgerEntry, EvidenceSpan, ResearchNote, SourceRecord } from './types.js'

export class EvidenceStore {
  private readonly sourceById = new Map<string, SourceRecord>()
  private readonly sourceIdByFingerprint = new Map<string, string>()
  private readonly spanById = new Map<string, EvidenceSpan>()
  private readonly spanIdByHash = new Map<string, string>()
  private readonly claimById = new Map<string, AtomicClaim>()
  private readonly noteById = new Map<string, ResearchNote>()
  private readonly citationById = new Map<string, CitationBinding>()

  constructor(
    private readonly repository: ResearchRunRepository,
    private readonly layout: ResearchRunLayout
  ) {}

  async recordWorkerResult(result: WorkerResult): Promise<void> {
    for (const source of result.sources) {
      await this.addSource(source)
    }
    for (const span of result.evidenceSpans) {
      await this.addEvidenceSpan(span)
    }
    for (const claim of result.claims) {
      await this.addClaim(claim)
    }
    for (const note of result.notes) {
      await this.addNote(note)
    }
  }

  async addSource(source: SourceRecord): Promise<SourceRecord> {
    const existing = this.sourceById.get(source.id)
    if (existing) {
      return existing
    }
    this.sourceById.set(source.id, source)
    if (!this.sourceIdByFingerprint.has(source.fingerprint)) {
      this.sourceIdByFingerprint.set(source.fingerprint, source.id)
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
    if (!this.spanIdByHash.has(span.textHash)) {
      this.spanIdByHash.set(span.textHash, span.id)
    }
    await this.repository.appendEvidenceEntry(this.layout, { kind: 'evidence_span', record: span })
    return span
  }

  async addClaim(claim: AtomicClaim): Promise<AtomicClaim> {
    for (const spanId of claim.supportSpanIds) {
      if (!this.spanById.has(spanId)) {
        throw new Error(`AtomicClaim ${claim.id} references unknown evidence span ${spanId}`)
      }
    }
    if (!this.claimById.has(claim.id)) {
      this.claimById.set(claim.id, claim)
      await this.repository.appendClaim(this.layout, claim)
    }
    return this.claimById.get(claim.id) ?? claim
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
