import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  createLexicalSemanticMemoryCandidate,
  type SemanticMemoryCandidate
} from './semantic-memory-evaluation.js'

const TerminologyMapFile = z.object({
  schemaVersion: z.literal(1),
  mapId: z.string().regex(/^kun-memory-[a-z0-9-]+$/u),
  status: z.literal('frozen'),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_]+$/u),
    terms: z.array(z.string().min(1).max(128)).min(2).max(16)
  }).strict()).min(1)
}).strict()

export type SemanticMemoryTerminologyMap = z.infer<typeof TerminologyMapFile> & {
  artifactSha256: string
}

export const DEFAULT_SEMANTIC_MEMORY_TERMINOLOGY_MAP_PATH = fileURLToPath(new URL(
  './fixtures/semantic-memory-terminology-map.v1.json',
  import.meta.url
))

export async function loadSemanticMemoryTerminologyMap(
  path = DEFAULT_SEMANTIC_MEMORY_TERMINOLOGY_MAP_PATH
): Promise<SemanticMemoryTerminologyMap> {
  const text = await readFile(path, 'utf8')
  return parseSemanticMemoryTerminologyMap(text)
}

export function parseSemanticMemoryTerminologyMap(text: string): SemanticMemoryTerminologyMap {
  let source: unknown
  try {
    source = JSON.parse(text) as unknown
  } catch {
    throw new Error('invalid semantic Memory terminology map JSON')
  }
  const map = TerminologyMapFile.parse(source)
  const errors: string[] = []
  requireUnique(map.entries.map((entry) => entry.id), 'entry ids', errors)
  const normalizedTerms = map.entries.flatMap((entry) => entry.terms.map(normalizeTerm))
  requireUnique(normalizedTerms, 'normalized terms', errors)
  if (errors.length > 0) throw new Error(`invalid semantic Memory terminology map: ${errors.join('; ')}`)
  return { ...map, artifactSha256: sha256(text) }
}

export function normalizeSemanticMemoryTerminologyQuery(
  query: string,
  map: SemanticMemoryTerminologyMap
): string {
  const normalizedQuery = query.normalize('NFKC')
  const searchable = normalizeTerm(normalizedQuery)
  const additions: string[] = []
  const seen = new Set<string>()
  for (const entry of map.entries) {
    if (!entry.terms.some((term) => queryIncludesTerm(searchable, normalizeTerm(term)))) continue
    for (const term of entry.terms) {
      const normalized = normalizeTerm(term)
      if (queryIncludesTerm(searchable, normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      additions.push(term)
    }
  }
  return additions.length === 0 ? query : `${query} ${additions.join(' ')}`
}

export function createTerminologyMapSemanticMemoryCandidate(input: {
  terminology: SemanticMemoryTerminologyMap
  lexicalCandidate?: SemanticMemoryCandidate
}): SemanticMemoryCandidate {
  const lexicalCandidate = input.lexicalCandidate ?? createLexicalSemanticMemoryCandidate()
  if (lexicalCandidate.metadata.kind !== 'lexical') {
    throw new Error('terminology-map candidate requires a lexical retrieval candidate')
  }
  return {
    metadata: {
      id: `${lexicalCandidate.metadata.id}+terminology-v${input.terminology.schemaVersion}`,
      kind: 'lexical',
      version: `terminology-map-v${input.terminology.schemaVersion}`,
      runtime: lexicalCandidate.metadata.runtime,
      license: lexicalCandidate.metadata.license,
      artifactSha256: input.terminology.artifactSha256,
      parameters: {
        mode: 'terminology-query-expansion',
        mapId: input.terminology.mapId,
        mapSchemaVersion: input.terminology.schemaVersion,
        lexicalCandidateId: lexicalCandidate.metadata.id
      },
      platforms: [...lexicalCandidate.metadata.platforms]
    },
    retrieve: async (request) => {
      const expanded = normalizeSemanticMemoryTerminologyQuery(request.query.query, input.terminology)
      return lexicalCandidate.retrieve({
        ...request,
        query: expanded === request.query.query
          ? request.query
          : { ...request.query, query: expanded }
      })
    }
  }
}

function normalizeTerm(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function queryIncludesTerm(query: string, term: string): boolean {
  if (!/^[a-z0-9][a-z0-9 -]*$/u.test(term)) return query.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'u').test(query)
}

function sha256(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex')
}

function requireUnique(values: readonly string[], name: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${name} must be unique`)
}
