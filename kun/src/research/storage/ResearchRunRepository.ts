/**
 * [INPUT]: 依赖 adapters/file/atomic-write、research core types 和 evidence types 的落盘契约
 * [OUTPUT]: 对外提供 ResearchRunRepository，负责 run 布局、草稿/正式 Markdown 产物和 JSONL 证据写入
 * [POS]: research/storage 的文件系统仓库，被 ResearchRuntime 用于持久化用户可见报告和机器可读产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import { slugify } from '../core/hash.js'
import type { ResearchEvent } from '../core/events.js'
import type { ResearchArtifactPaths, ResearchRun } from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceLedgerEntry } from '../evidence/types.js'

export type ResearchRunLayout = ResearchArtifactPaths

export type ResearchRunRepositoryOptions = {
  workspaceRoot: string
}

export type CreateRunLayoutInput = {
  runId: string
  title: string
  createdAt: string
}

export type ResearchMarkdownArtifacts = {
  reportMarkdown: string
  briefMarkdown: string
  planMarkdown: string
  sourcesMarkdown: string
  notesMarkdown: string
}

export class ResearchRunRepository {
  constructor(private readonly options: ResearchRunRepositoryOptions) {}

  async createRunLayout(input: CreateRunLayoutInput): Promise<ResearchRunLayout> {
    const stamp = input.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const titleSegment = safePathSegment(input.title)
    const rootDir = join(this.options.workspaceRoot, 'Research', `${stamp}-${titleSegment}-${input.runId.slice(0, 8)}`)
    const machineDir = join(rootDir, '.kun-research')
    await mkdir(machineDir, { recursive: true })
    return {
      rootDir,
      reportPath: join(rootDir, `${titleSegment}.md`),
      briefPath: join(rootDir, 'brief.md'),
      planPath: join(rootDir, 'plan.md'),
      sourcesPath: join(rootDir, 'sources.md'),
      notesPath: join(rootDir, 'notes.md'),
      machineDir,
      runJsonPath: join(machineDir, 'run.json'),
      evidenceJsonlPath: join(machineDir, 'evidence.jsonl'),
      claimsJsonlPath: join(machineDir, 'claims.jsonl'),
      citationsJsonlPath: join(machineDir, 'citations.jsonl'),
      eventsJsonlPath: join(machineDir, 'events.jsonl')
    }
  }

  reportPathForTitle(layout: ResearchRunLayout, title: string): string {
    return join(layout.rootDir, researchReportFileName(title))
  }

  async writeRun(run: ResearchRun): Promise<void> {
    await atomicWriteFile(run.artifacts.runJsonPath, `${JSON.stringify(run, null, 2)}\n`)
  }

  async appendEvent(layout: ResearchRunLayout, event: ResearchEvent): Promise<void> {
    await appendJsonl(layout.eventsJsonlPath, event)
  }

  async appendEvidenceEntry(layout: ResearchRunLayout, entry: EvidenceLedgerEntry): Promise<void> {
    await appendJsonl(layout.evidenceJsonlPath, entry)
  }

  async appendClaim(layout: ResearchRunLayout, claim: AtomicClaim): Promise<void> {
    await appendJsonl(layout.claimsJsonlPath, claim)
  }

  async appendCitation(layout: ResearchRunLayout, citation: CitationBinding): Promise<void> {
    await appendJsonl(layout.citationsJsonlPath, citation)
  }

  async writeMarkdownArtifacts(layout: ResearchRunLayout, artifacts: ResearchMarkdownArtifacts): Promise<void> {
    await Promise.all([
      atomicWriteFile(layout.reportPath, artifacts.reportMarkdown),
      atomicWriteFile(layout.briefPath, artifacts.briefMarkdown),
      atomicWriteFile(layout.planPath, artifacts.planMarkdown),
      atomicWriteFile(layout.sourcesPath, artifacts.sourcesMarkdown),
      atomicWriteFile(layout.notesPath, artifacts.notesMarkdown)
    ])
  }

  async writeReportDraft(layout: ResearchRunLayout, reportMarkdown: string): Promise<void> {
    await atomicWriteFile(layout.reportPath, reportMarkdown)
  }

  async readJsonl<T>(path: string): Promise<T[]> {
    const content = await readFile(path, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  }
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf-8')
}

function safePathSegment(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const clipped = Array.from(normalized).slice(0, 80).join('').replace(/-+$/g, '')
  return clipped || slugify(value)
}

export function researchReportFileName(title: string): string {
  return `${safePathSegment(title)}.md`
}
