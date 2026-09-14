import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = process.env.KUN_P2A_V3_EVAL_ROOT ?? resolve(repo, '..', 'Review_md', 'codex', 'p2a-semantic-spike')
const modelCache = process.env.KUN_P2A_MODEL_CACHE ?? resolve(evidenceRoot, 'model-cache')
const localModels = process.env.KUN_P2A_MODEL_DIR ?? resolve(evidenceRoot, 'local-models')
const outputPath = process.argv[2] ?? resolve(evidenceRoot, 'v3-development-output.json')
const { env, pipeline } = await import(pathToFileURL(resolve(
  evidenceRoot,
  'node_modules',
  '@huggingface',
  'transformers',
  'dist',
  'transformers.node.mjs'
)).href)
const modelId = 'Xenova/multilingual-e5-small'
const revision = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
const modelArtifact = 'onnx/model_quantized.onnx'
const modelPath = resolve(modelCache, ...modelId.split('/'), revision, modelArtifact)
const fixtureDir = resolve(repo, 'kun', 'src', 'memory', 'fixtures')

const datasetModule = await importModule('semantic-memory-evaluation-v3-dataset.js')
const evaluationModule = await importModule('semantic-memory-evaluation.js')
const comparisonModule = await importModule('semantic-memory-evaluation-v3-comparison.js')
const candidateModule = await importModule('semantic-memory-v3-candidates.js')
const baselineModule = await importModule('semantic-memory-evaluation-v3-baseline.js')
const terminologyModule = await importModule('semantic-memory-evaluation-v3-terminology.js')
const terminologySourceModule = await importModule('semantic-memory-terminology-candidate.js')
const workflowModule = await importModule('semantic-memory-evaluation-v3-workflow.js')
const guardModule = await importModule('semantic-memory-offline-guard.js')

const dataset = await datasetModule.loadSemanticMemoryV3EvaluationDataset({
  records: resolve(fixtureDir, 'semantic-memory-records.v3.json'),
  queries: resolve(fixtureDir, 'semantic-memory-queries.v3.json'),
  manifest: resolve(fixtureDir, 'semantic-memory-manifest.v3.json'),
  checksums: resolve(fixtureDir, 'semantic-memory-checksums.v3.json')
})
const terminology = await terminologySourceModule.loadSemanticMemoryTerminologyMap(
  resolve(fixtureDir, 'semantic-memory-terminology-map.v1.json')
)
const actualModelSha256 = createHash('sha256').update(await readFile(modelPath)).digest('hex')
if (actualModelSha256 !== dataset.manifest.candidateIdentity.modelSha256) {
  throw new Error(`model hash mismatch: ${actualModelSha256}`)
}

env.localModelPath = `${localModels}/`
env.allowRemoteModels = false
const guarded = await guardModule.runWithSemanticMemoryNetworkGuard(async () => {
  const lexical = baselineModule.createSemanticMemoryV3LexicalBaselineCandidate()
  const lexicalReport = await evaluationModule.runSemanticMemoryEvaluation({
    dataset,
    candidate: lexical,
    split: 'development'
  })
  const coldStarted = performance.now()
  const extractor = await pipeline('feature-extraction', modelId, {
    dtype: 'q8',
    local_files_only: true
  })
  const coldReadinessMs = performance.now() - coldStarted
  const embeddingCache = new Map()
  const embed = async (texts) => {
    const missing = texts.filter((text) => !embeddingCache.has(text))
    if (missing.length > 0) {
      const tensor = await extractor(missing, { pooling: 'mean', normalize: true })
      tensor.tolist().forEach((embedding, index) => embeddingCache.set(missing[index], embedding))
    }
    return texts.map((text) => embeddingCache.get(text))
  }
  const scoreRecords = async ({ query, records }) => {
    const [queryVector] = await embed([`query: ${query.query}`])
    const documentVectors = await embed(records.map((record) => `passage: ${record.content}`))
    return records.map((record, index) => ({ record, score: cosine(queryVector, documentVectors[index]) }))
  }
  const metadata = {
    id: 'multilingual-e5-small-q8-v3',
    version: revision,
    runtime: '@huggingface/transformers@4.2.0; onnxruntime-node',
    license: 'MIT',
    artifactSha256: actualModelSha256,
    dimensions: dataset.manifest.candidateIdentity.dimensions,
    normalization: 'attention-mask-mean+l2',
    parameters: { modelId, revision, dtype: 'q8' },
    platforms: ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']
  }
  const gridByMode = {}
  for (const mode of ['semantic-gated-rrf', 'lexical-veto', 'lexical-veto-margin']) {
    gridByMode[mode] = await workflowModule.runSemanticMemoryV3DevelopmentGrid({
      dataset,
      createCandidate: (configuration) => mode === 'semantic-gated-rrf'
        ? candidateModule.createSemanticMemoryV3SemanticGatedCandidate({
          metadata: { ...metadata, id: `${metadata.id}-${mode}`, parameters: { ...metadata.parameters, marginGap: configuration.marginGap } },
          lexicalCandidate: lexical,
          scoreRecords,
          minimumSimilarity: configuration.minimumSimilarity,
          semanticWeight: configuration.semanticWeight,
          lexicalWeight: configuration.lexicalWeight,
          rankConstant: configuration.rankConstant
        })
        : candidateModule.createSemanticMemoryV3LexicalVetoCandidate({
          metadata: {
            ...metadata,
            id: `${metadata.id}-${mode}`,
            parameters: {
              ...metadata.parameters,
              minimumSimilarity: configuration.minimumSimilarity,
              marginGap: mode === 'lexical-veto-margin' ? configuration.marginGap : 0,
              semanticWeight: configuration.semanticWeight,
              lexicalWeight: configuration.lexicalWeight,
              rankConstant: configuration.rankConstant
            }
          },
          lexicalCandidate: lexical,
          scoreRecords,
          marginGap: mode === 'lexical-veto-margin' ? configuration.marginGap : 0
        })
    })
  }
  const zeroOverlapQueryIds = new Set(dataset.queries
    .filter((query) => query.split === 'development' && query.zeroLexicalOverlap)
    .map((query) => query.id))
  const summaries = Object.fromEntries(Object.entries(gridByMode).map(([mode, grid]) => [mode, {
    gridSha256: grid.gridSha256,
    developmentEvidenceSha256: workflowModule.semanticMemoryV3DevelopmentEvidenceSha256(grid),
    selection: workflowModule.selectSemanticMemoryV3DevelopmentCandidate({
      dataset,
      baseline: lexicalReport,
      grid
    })?.configuration ?? null,
    entries: grid.entries.map((entry) => entry.report ? {
      configuration: entry.configuration,
      candidate: entry.report.candidate,
      metrics: entry.report.metrics,
      results: entry.report.results,
      comparison: comparisonModule.compareSemanticMemoryV3EvaluationReports({
        baseline: lexicalReport,
        candidate: entry.report,
        zeroOverlapQueryIds,
        bootstrap: dataset.manifest.bootstrap
      }).metrics
    } : { configuration: entry.configuration, error: entry.error })
  }]))
  const terminologyCandidate = terminologyModule.createSemanticMemoryV3TerminologyCandidate({
    terminology,
    lexicalCandidate: lexical
  })
  const terminologyReport = await evaluationModule.runSemanticMemoryEvaluation({
    dataset,
    candidate: terminologyCandidate,
    split: 'development'
  })
  await extractor.dispose()
  return {
    lexicalReport,
    gridByMode,
    summaries,
    terminologyReport,
    terminologyArtifactSha256: terminology.artifactSha256,
    resources: {
      modelBytes: (await stat(modelPath)).size,
      coldReadinessMs,
      maximumDevelopmentWarmQueryP95Ms: Math.max(
        lexicalReport.metrics.latencyP95Ms,
        terminologyReport.metrics.latencyP95Ms,
        ...Object.values(gridByMode).flatMap((grid) => grid.entries.flatMap((entry) => entry.report ? [entry.report.metrics.latencyP95Ms] : []))
      )
    }
  }
})

const evidence = {
  schemaVersion: 3,
  reportKind: 'semantic-memory-v3-development-screening',
  generatedAt: new Date().toISOString(),
  holdoutResultsEmitted: false,
  dataset: {
    id: dataset.manifest.datasetId,
    sourceHashes: dataset.sourceHashes,
    developmentQueries: dataset.queries.filter((query) => query.split === 'development').length
  },
  model: {
    id: modelId,
    revision,
    artifact: modelArtifact,
    artifactSha256: actualModelSha256,
    tokenizerSha256: dataset.manifest.candidateIdentity.tokenizerSha256,
    resourceEvidenceReference: 'semantic-memory-e5-resources.windows-x64.v1.json'
  },
  offline: { networkAttempts: guarded.networkAttempts },
  resources: guarded.value.resources,
  decision: {
    development: Object.values(guarded.value.summaries).some((summary) => summary.selection) ? 'go' : 'no-go',
    holdoutAllowed: Object.values(guarded.value.summaries).some((summary) => summary.selection),
    rationale: 'No holdout labels or metrics are emitted until one development candidate passes every preregistered lower-bound, precision, abstention, safety, and zero-overlap gate.'
  },
  lexical: summarizeReport(guarded.value.lexicalReport),
  terminologyCandidate: summarizeReport(guarded.value.terminologyReport),
  candidates: guarded.value.summaries
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence)}\n`, 'utf8')
process.stdout.write(JSON.stringify({
  outputPath,
  modes: Object.keys(guarded.value.summaries),
  networkAttempts: evidence.offline.networkAttempts,
  holdoutResultsEmitted: evidence.holdoutResultsEmitted,
  lexicalRecallAtK: evidence.lexical.metrics.recallAtK
}, null, 2) + '\n')

function summarizeReport(report) {
  return {
    candidate: report.candidate,
    metrics: report.metrics,
    safetyGatePassed: report.safetyGatePassed,
    selectedIds: Object.fromEntries(report.results.map((result) => [result.queryId, result.selectedIds]))
  }
}

async function importModule(name) {
  return import(pathToFileURL(resolve(repo, 'kun', 'dist', 'memory', name)).href)
}

function cosine(left, right) {
  if (!left || !right || left.length !== right.length) throw new Error('embedding dimensions differ')
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}
