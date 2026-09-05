import {
  MemoryRecord,
  type MemoryRecord as MemoryRecordValue,
  type MemorySourceEvidence,
  type MemoryType
} from '../contracts/memory.js'
import type {
  DistillationDecision,
  MemoryCandidateAssessmentInput,
  MemoryCandidateEvidenceContextInput
} from '../contracts/memory-distillation.js'

const FIXTURE_NOW = '2026-09-03T00:00:00.000Z'

export type MemoryDistillationFixtureCase = {
  id: string
  assessment: MemoryCandidateAssessmentInput
  evidence: MemoryCandidateEvidenceContextInput
  existing: MemoryRecordValue[]
  expected: Pick<DistillationDecision, 'action'> & { reason?: string; memoryId?: string }
  unsafe?: boolean
  duplicate?: boolean
}

const packageManager = record('mem-package-manager', 'Use pnpm for this workspace.', {
  type: 'decision',
  tags: ['package-manager', 'workspace'],
  sources: [source('src-existing-package-manager', 'The workspace uses pnpm.')]
})

const editorTheme = record('mem-editor-theme', 'The user prefers a dark editor theme.', {
  type: 'preference',
  tags: ['editor', 'preference'],
  sources: [source('src-existing-editor-theme', 'I prefer a dark editor theme.')]
})

export const MEMORY_DISTILLATION_FIXTURES: readonly MemoryDistillationFixtureCase[] = [
  fixture('fact-create', {
    content: 'The workspace test command is npm run test.',
    type: 'fact',
    tags: ['testing', 'workspace'],
    sources: [source('src-fact', 'The test command here is npm run test.')]
  }, { action: 'create' }),
  fixture('preference-create-zh', {
    content: '用户偏好简洁的中文回答。',
    type: 'preference',
    tags: ['偏好', '语言'],
    sources: [source('src-preference-zh', '请尽量用简洁的中文回答。')]
  }, { action: 'create' }),
  fixture('decision-create', {
    content: 'Keep generated reports outside the repository.',
    type: 'decision',
    tags: ['reports', 'repository'],
    sources: [source('src-decision', 'Store generated reports outside the repository.')]
  }, { action: 'create' }),
  fixture('transient-request', {
    content: 'For this turn, summarize only the first section.',
    type: 'episode',
    tags: ['summary'],
    sources: [source('src-transient', 'For this turn, summarize only the first section.')]
  }, { action: 'skip', reason: 'non-durable' }, { unsafe: true }),
  fixture('transient-request-zh', {
    content: '这次先只检查一个文件。',
    type: 'episode',
    tags: ['检查'],
    sources: [source('src-transient-zh', '这次先只检查一个文件。')]
  }, { action: 'skip', reason: 'non-durable' }, { unsafe: true }),
  fixture('low-confidence-inference', {
    content: 'The user may prefer compact tables.',
    type: 'preference',
    confidence: 0.42,
    tags: ['formatting', 'inference'],
    sources: [source('src-low-confidence', 'A compact table might be useful.', 'inferred')]
  }, { action: 'skip', reason: 'low-confidence' }, { unsafe: true }),
  fixture('credential-like-content', {
    content: 'The API key is sk-example_1234567890abcdef.',
    type: 'fact',
    tags: ['credential'],
    sources: [source('src-credential', 'API key: sk-example_1234567890abcdef')]
  }, { action: 'skip', reason: 'sensitive' }, { unsafe: true }),
  fixture('exact-duplicate', {
    content: '  USE   PNPM FOR THIS WORKSPACE. ',
    type: 'decision',
    tags: ['workspace', 'package-manager'],
    sources: [source('src-duplicate', 'Use pnpm for this workspace.')]
  }, { action: 'skip', reason: 'duplicate' }, { existing: [packageManager], duplicate: true }),
  fixture('near-duplicate-update', {
    content: 'The workspace package manager is pnpm and installs use the frozen lockfile.',
    type: 'decision',
    tags: ['package-manager', 'workspace'],
    sources: [source('src-update', 'Use pnpm with the frozen lockfile.')]
  }, { action: 'update', memoryId: packageManager.id }, {
    existing: [packageManager],
    comparisons: [{ memoryId: packageManager.id, relation: 'update' }],
    duplicate: true
  }),
  fixture('conflicting-supersede', {
    content: 'The user now prefers a light editor theme.',
    type: 'preference',
    tags: ['editor', 'preference'],
    sources: [source('src-conflict', 'Switch my editor theme preference to light.')]
  }, { action: 'supersede', memoryId: editorTheme.id }, {
    existing: [editorTheme],
    comparisons: [{ memoryId: editorTheme.id, relation: 'supersede' }]
  })
]

function fixture(
  id: string,
  candidate: {
    content: string
    type: MemoryType
    confidence?: number
    importance?: number
    tags: string[]
    sources: MemorySourceEvidence[]
  },
  expected: MemoryDistillationFixtureCase['expected'],
  options: {
    durability?: 'durable' | 'transient'
    comparisons?: MemoryCandidateAssessmentInput['comparisons']
    existing?: MemoryRecordValue[]
    unsafe?: boolean
    duplicate?: boolean
  } = {}
): MemoryDistillationFixtureCase {
  const sources = candidate.sources
  return {
    id,
    assessment: {
      candidate: {
        content: candidate.content,
        type: candidate.type,
        confidence: candidate.confidence ?? 0.9,
        importance: candidate.importance ?? 0.75,
        tags: candidate.tags,
        sourceIds: sources.map((source) => source.id)
      },
      durability: options.durability ?? 'durable',
      comparisons: options.comparisons ?? []
    },
    evidence: {
      observedAt: FIXTURE_NOW,
      sources
    },
    existing: options.existing ?? [],
    expected,
    unsafe: options.unsafe,
    duplicate: options.duplicate
  }
}

function source(
  id: string,
  excerpt: string,
  trust: MemorySourceEvidence['trust'] = 'explicit-user'
): MemorySourceEvidence {
  return {
    id,
    kind: trust === 'inferred' ? 'inference' : 'user',
    threadId: 'thread-anonymous',
    turnId: `turn-${id}`,
    excerpt,
    trust
  }
}

function record(
  id: string,
  content: string,
  options: {
    type: MemoryType
    tags: string[]
    sources: MemorySourceEvidence[]
  }
): MemoryRecordValue {
  return MemoryRecord.parse({
    id,
    content,
    scope: 'workspace',
    workspace: 'C:/anonymous/workspace',
    tags: options.tags,
    confidence: 0.9,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    schemaVersion: 2,
    type: options.type,
    authority: 'reference',
    importance: 0.75,
    observedAt: FIXTURE_NOW,
    sources: options.sources
  })
}
