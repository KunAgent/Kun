import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PptWorkflowScope, ToolHostContext } from '../../ports/tool-host.js'
import {
  buildPptAgentLocalTools,
  PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME,
  PPT_CREATE_REVIEW_BUNDLE_TOOL_NAME,
  PPT_READ_DIRECTION_SELECTION_TOOL_NAME,
  PPT_READ_GUIDE_TOOL_NAME,
  PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME
} from './ppt-agent-local-tools.js'

const roots: string[] = []
const governanceRoots = new Set<string>()
const toolchain = resolve(process.cwd(), '..', 'resources', 'ppt-toolchain')
const sourceRequest = 'Create a restrained technical architecture deck for engineering leaders.'
const workflowId = 'ppt_direction_workflow'
const projectDir = 'direction-deck'

const basePlan = {
  category: 'tech-engineering' as const,
  audience: 'Engineering leaders',
  purpose: 'Explain the architecture and support a decision',
  pageStrategy: { pageCount: 3, narrative: 'Context, mechanism, and evidence lead to a decision' },
  fontRoles: { display: 'Inter', body: 'Inter', monospace: 'JetBrains Mono' },
  colorRoles: {
    background: '#F7F8FA', foreground: '#18202A', accent: '#C54A2C', muted: '#66717D',
    positive: '#287A4B', caution: '#A56A16', critical: '#B33030'
  },
  backgroundTreatment: { kind: 'solid' as const },
  effects: [],
  typeScale: { title: 40, section: 30, body: 18, caption: 11 },
  spacingRhythm: { unit: 8, pageMargin: 48, columns: 12, gutter: 20 },
  layoutSystem: 'Stable title axis with direct evidence layouts and thin rules',
  imageryStrategy: 'Use architecture diagrams and source imagery only when informative',
  policyExceptions: []
}

function planFor(index: number) {
  return {
    ...basePlan,
    fontRoles: {
      ...basePlan.fontRoles,
      display: index === 1 ? 'Inter' : index === 2 ? 'Aptos Display' : 'IBM Plex Sans'
    },
    colorRoles: {
      ...basePlan.colorRoles,
      accent: index === 1 ? '#C54A2C' : index === 2 ? '#286C8E' : '#6B4AA5'
    },
    layoutSystem: `${basePlan.layoutSystem}; visual direction ${index}`
  }
}

function directionInput(index: number, recommended = false, directionId?: string) {
  return {
    ...(directionId ? { directionId } : {}),
    name: `Direction ${index}`,
    rationale: `A complete and materially distinct visual direction ${index}.`,
    recommended,
    plan: planFor(index),
    sampleProject: `${projectDir}/directions/d${index}`
  }
}

const accents = ['#C54A2C', '#286C8E', '#6B4AA5']

async function writeSample(root: string, index: number, options: { pages?: number; size?: string } = {}) {
  const directory = join(root, projectDir, 'directions', `d${index}`)
  const count = options.pages ?? 3
  await mkdir(join(directory, 'pages'), { recursive: true })
  await writeFile(join(directory, 'sample.pptd'), [
    'version: v2',
    `title: Direction ${index}`,
    `size: ${options.size ?? '[960, 540]'}`,
    'pages:',
    ...Array.from({ length: count }, (_, page) => `  - pages/${page + 1}.page`)
  ].join('\n'))
  await Promise.all(Array.from({ length: count }, (_, page) => writeFile(
    join(directory, 'pages', `${page + 1}.page`),
    [
      'background: {type: solid, color: "#F7F8FA"}',
      'elements:',
      '  - elementId: title',
      '    elementType: text',
      '    bounds: [48, 40, 640, 60]',
      `    content: {fontSize: 36, bold: true, color: "${accents[index - 1]}", text: "${slides[page]?.title ?? 'Extra'} ${index}"}`
    ].join('\n')
  )))
}

const slides = [
  { title: 'Opening', prompt: 'Position the architecture decision.' },
  { title: 'Mechanism', prompt: 'Explain the system mechanism.' },
  { title: 'Evidence', prompt: 'Show the complex evidence and next action.' }
]

const png16x9 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAB5ElEQVR4nO2UQQ3AQACDTgNapmX+ndxkrAk8MFBID897ow34aYNTfMXHjxsUYAHeAiyCa92gBxyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmAIckICYAhyQgJgCHJCAmA+WXFQH4MuCjwAAAABJRU5ErkJggg==',
  'base64'
)
function context(root: string, scope: Partial<PptWorkflowScope> = {}): ToolHostContext {
  return {
    threadId: 'child_direction',
    turnId: 'turn_direction',
    workspace: root,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    approvalIntent: sourceRequest,
    pptWorkflowScope: {
      action: 'start', workflowId, projectDir, parentThreadId: 'parent', previewMode: 'image-first',
      directionGate: {
        required: true,
        reason: 'underspecified-new-deck',
        basis: 'This is a new presentation without a complete visual authority.',
        sourceHash: 'a'.repeat(64)
      },
      ...scope
    },
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function tools() {
  return buildPptAgentLocalTools({
    toolchainDirectory: () => toolchain,
    governanceDirectory: (toolContext) => {
      const directory = `${toolContext.workspace}.host-ppt-direction-governance`
      governanceRoots.add(directory)
      return directory
    },
    resolveSourceRequest: () => sourceRequest
  })
}

async function prepare(root: string) {
  await Promise.all([1, 2, 3].map((index) => writeSample(root, index)))
  await mkdir(join(root, '.kun', 'images'), { recursive: true })
  await Promise.all(Array.from({ length: 3 }, (_, offset) => offset + 1).flatMap((index) =>
    ['cover', 'content', 'complex'].map((role) =>
      writeFile(
        join(root, '.kun', 'images', `direction-${index}-${role}.png`),
        Buffer.concat([png16x9, Buffer.from(`direction-${index}-${role}`)])
      ))))
  const guide = tools().find((candidate) => candidate.name === PPT_READ_GUIDE_TOOL_NAME)!
  for (const path of ['slides_categories.md', 'slides_categories/tech-engineering.md']) {
    const result = await guide.execute(
      { workflowId, projectDir, path, max_lines: 400 },
      context(root)
    )
    if (result.isError) throw new Error(JSON.stringify(result.output))
  }
}

async function createDirections(root: string) {
  const create = tools().find((candidate) => candidate.name === PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME)!
  const result = await create.execute({
    workflowId,
    parentThreadId: 'parent',
    projectDir,
    deckTitle: 'Architecture decision',
    pageCount: 3,
    slides,
    directions: [directionInput(1), directionInput(2, true), directionInput(3)]
  }, context(root))
  if (result.isError) throw new Error(JSON.stringify(result.output))
  return (result.output as {
    directionBundle: {
      childId: string
      workflowId: string
      recommendedDirectionId: string
      slidesFingerprint: string
      slides: Array<{ slideId: string; index: number; title: string; promptHash: string }>
      directions: Array<{
        directionId: string
        revision: number
        recommended: boolean
        planFingerprint: string
        candidateFingerprint: string
      }>
    }
  }).directionBundle
}

function trustedContext(
  bundle: Awaited<ReturnType<typeof createDirections>>,
  directions: Array<{ directionId: string; revision: number }>,
  action: 'select_direction' | 'revise_directions'
): Partial<PptWorkflowScope> {
  return {
    action,
    directionContext: {
      childId: 'child_direction',
      directions,
      authority: bundle.directions.map((item) => ({
        directionId: item.directionId,
        revision: item.revision,
        recommended: item.recommended,
        planFingerprint: (item as { planFingerprint: string }).planFingerprint,
        candidateFingerprint: (item as { candidateFingerprint: string }).candidateFingerprint
      })),
      slidesFingerprint: (bundle as { slidesFingerprint: string }).slidesFingerprint
    }
  }
}

afterEach(async () => {
  const cleanup = [...roots.splice(0), ...governanceRoots]
  governanceRoots.clear()
  await Promise.all(cleanup.map((root) => rm(root, { recursive: true, force: true })))
})

describe('PPT direction tools', () => {
  it('persists exactly three proposals with stable host-generated identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-directions-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    expect(bundle).toMatchObject({
      childId: 'child_direction',
      workflowId,
      recommendedDirectionId: `${workflowId}-direction-2`,
      directions: [
        { directionId: `${workflowId}-direction-1`, revision: 1, recommended: false },
        { directionId: `${workflowId}-direction-2`, revision: 1, recommended: true },
        { directionId: `${workflowId}-direction-3`, revision: 1, recommended: false }
      ]
    })
    const manifest = JSON.parse(await readFile(
      join(root, projectDir, '.kun-ppt-review', 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      version: 3,
      phase: 'awaiting_direction',
      directions: {
        gate: { required: true, reason: 'underspecified-new-deck', sourceHash: 'a'.repeat(64) }
      }
    })
    expect(manifest).not.toHaveProperty('governance')
  })

  it('lets retry_failed establish the direction bundle when the first attempt produced none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-directions-retry-'))
    roots.push(root)
    await prepare(root)
    const create = tools().find((candidate) => candidate.name === PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME)!
    const result = await create.execute({
      workflowId,
      parentThreadId: 'parent',
      projectDir,
      deckTitle: 'Architecture decision',
      pageCount: 3,
      slides,
      directions: [directionInput(1), directionInput(2, true), directionInput(3)]
    }, context(root, { action: 'retry_failed', stage: 'direction' }))

    expect(result.isError).not.toBe(true)
    expect(result).toMatchObject({ output: { directionBundle: { workflowId } } })
  })

  it('uses the recommendation only for selection, while an unselected revision targets all directions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-fallback-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    const read = tools().find((candidate) => candidate.name === PPT_READ_DIRECTION_SELECTION_TOOL_NAME)!
    const revision = await read.execute(
      { workflowId, projectDir }, context(root, trustedContext(bundle, [], 'revise_directions')))
    expect(revision).toMatchObject({ output: { targetMode: 'all' } })
    const revisionDirections = (revision.output as { directions: Array<{ directionId: string }> }).directions
    expect(revisionDirections).toHaveLength(3)
    expect(revisionDirections.map((item) => item.directionId)).toContain(bundle.directions[0].directionId)

    const selection = await read.execute(
      { workflowId, projectDir }, context(root, trustedContext(bundle, [], 'select_direction')))
    expect(selection).toMatchObject({
      output: {
        directionId: bundle.recommendedDirectionId,
        recommendedFallback: true,
        plan: planFor(2),
        sampleProject: `${projectDir}/directions/d2`
      }
    })
    const manifest = JSON.parse(await readFile(
      join(root, projectDir, '.kun-ppt-review', 'manifest.json'), 'utf8'))
    expect(manifest.directions.selectedDirectionId).toBe(bundle.recommendedDirectionId)
  })

  it('revises only the validated selected card and rejects stale, multiple, and forged identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-revise-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    const selected = bundle.directions[0]
    const read = tools().find((candidate) => candidate.name === PPT_READ_DIRECTION_SELECTION_TOOL_NAME)!
    const selectedScope = trustedContext(
      bundle,
      [{ directionId: selected.directionId, revision: selected.revision }],
      'revise_directions'
    )
    await expect(read.execute({ workflowId, projectDir }, context(root, selectedScope))).resolves.toMatchObject({
      output: { targetMode: 'selected', directions: [{ directionId: selected.directionId }] }
    })
    const revisionSlides = slides.map((slide, index) => ({
      ...slide,
      slideId: bundle.slides[index].slideId
    }))
    const create = tools().find((candidate) => candidate.name === PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME)!
    const revised = await create.execute({
      workflowId, parentThreadId: 'parent', projectDir, deckTitle: 'Architecture decision',
      pageCount: 3, slides: revisionSlides,
      directions: [{
        ...directionInput(1, true, selected.directionId),
        rationale: 'A quieter revision of only the selected visual direction.',
        plan: { ...planFor(1), fontRoles: { ...planFor(1).fontRoles, display: 'Source Sans 3' } }
      }]
    }, context(root, selectedScope))
    const revisedBundle = (revised.output as { directionBundle: Awaited<ReturnType<typeof createDirections>> }).directionBundle
    expect(revisedBundle.directions.find((item) => item.directionId === selected.directionId)).toMatchObject({ revision: 2 })
    expect(revisedBundle.directions.find((item) => item.directionId === bundle.directions[1].directionId)?.revision).toBe(1)

    for (const directions of [
      [{ directionId: selected.directionId, revision: 1 }],
      [{ directionId: 'forged', revision: 1 }],
      [
        { directionId: revisedBundle.directions[0].directionId, revision: 2 },
        { directionId: revisedBundle.directions[1].directionId, revision: 1 }
      ]
    ]) {
      const result = await read.execute(
        { workflowId, projectDir }, context(root, trustedContext(revisedBundle as never, directions, 'revise_directions')))
      expect(result).toMatchObject({ isError: true })
    }
  })

  it.each([
    ['only two pages', { pages: 2 }, 'exactly 3 pages'],
    ['a 4:3 page size', { size: '[720, 540]' }, '16:9 page size']
  ])('rejects a direction sample deck with %s', async (_label, sample, error) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-sample-'))
    roots.push(root)
    await prepare(root)
    await rm(join(root, projectDir, 'directions', 'd1'), { recursive: true, force: true })
    await writeSample(root, 1, sample)
    const create = tools().find((candidate) => candidate.name === PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME)!
    await expect(create.execute({
      workflowId,
      parentThreadId: 'parent',
      projectDir,
      deckTitle: 'Architecture decision',
      pageCount: 3,
      slides,
      directions: [directionInput(1), directionInput(2, true), directionInput(3)]
    }, context(root))).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining(error) }
    })
  })

  it('renders each sample deck into host-owned previews without image generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-render-'))
    roots.push(root)
    await prepare(root)
    await rm(join(root, '.kun'), { recursive: true, force: true })
    await createDirections(root)
    const manifest = JSON.parse(await readFile(
      join(root, projectDir, '.kun-ppt-review', 'manifest.json'), 'utf8'))
    const candidate = manifest.directions.candidates[0]
    expect(candidate.sampleProject).toBe(`${projectDir}/directions/d1`)
    expect(candidate.previews.map((preview: { role: string }) => preview.role)).toEqual(['cover', 'representative', 'complex'])
    for (const preview of candidate.previews as Array<{ imagePath: string; width: number; height: number }>) {
      expect(preview.imagePath).toMatch(new RegExp(`^${projectDir}/\\.kun-ppt-review/directions/[a-f0-9]{16}-\\w+\\.svg$`))
      expect(preview).toMatchObject({ width: 960, height: 540 })
      expect(await readFile(join(root, preview.imagePath), 'utf8')).toContain('<svg')
    }
  })

  it('rejects a sample deck outside the directions folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-scope-'))
    roots.push(root)
    await prepare(root)
    const create = tools().find((candidate) => candidate.name === PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME)!
    await expect(create.execute({
      workflowId,
      parentThreadId: 'parent',
      projectDir,
      deckTitle: 'Architecture decision',
      pageCount: 3,
      slides,
      directions: [{ ...directionInput(1), sampleProject: projectDir }, directionInput(2, true), directionInput(3)]
    }, context(root))).resolves.toMatchObject({ isError: true })
  })

  it('rejects selection after a persisted preview file is replaced in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-integrity-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    const manifest = JSON.parse(await readFile(
      join(root, projectDir, '.kun-ppt-review', 'manifest.json'), 'utf8'))
    await writeFile(
      join(root, manifest.directions.candidates[1].previews[0].imagePath),
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"></svg>'
    )
    const read = tools().find((candidate) => candidate.name === PPT_READ_DIRECTION_SELECTION_TOOL_NAME)!
    await expect(read.execute(
      { workflowId, projectDir },
      context(root, trustedContext(bundle, [], 'select_direction'))
    )).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('changed after host validation') }
    })
  })

  it('allows only the persisted selected proposal to become the governed design plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-plan-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    const selected = bundle.directions[2]
    const selectedContext = context(root, trustedContext(
      bundle,
      [{ directionId: selected.directionId, revision: selected.revision }],
      'select_direction'
    ))
    const read = tools().find((candidate) => candidate.name === PPT_READ_DIRECTION_SELECTION_TOOL_NAME)!
    const selection = await read.execute({ workflowId, projectDir }, selectedContext)
    expect(selection).toMatchObject({ output: { directionId: selected.directionId, recommendedFallback: false } })
    const plan = tools().find((candidate) => candidate.name === PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME)!
    await expect(plan.execute({ workflowId, projectDir, plan: planFor(1) }, selectedContext)).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('exactly match') }
    })
    const accepted = await plan.execute({ workflowId, projectDir, plan: planFor(3) }, selectedContext)
    expect(accepted).toMatchObject({
      output: { validated: true, planRevision: 1, planFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }
    })
    const manifest = JSON.parse(await readFile(
      join(root, projectDir, '.kun-ppt-review', 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      version: 3,
      phase: 'planning',
      directions: { selectedDirectionId: selected.directionId },
      governance: { designPlan: { fingerprint: (accepted.output as { planFingerprint: string }).planFingerprint } }
    })
    const review = tools().find((candidate) => candidate.name === PPT_CREATE_REVIEW_BUNDLE_TOOL_NAME)!
    const reviewSlides = slides.map((slide, index) => ({
      ...slide,
      slideId: bundle.slides[index].slideId,
      imagePath: `.kun/images/direction-3-${index === 0 ? 'cover' : index === 1 ? 'content' : 'complex'}.png`
    }))
    for (const changedSlides of [
      reviewSlides.map((slide, index) => index === 0 ? { ...slide, title: 'Changed title' } : slide),
      reviewSlides.map((slide, index) => index === 1 ? { ...slide, prompt: 'Changed narrative content.' } : slide)
    ]) {
      await expect(review.execute({
        workflowId, parentThreadId: 'parent', projectDir, deckTitle: 'Architecture decision',
        pageCount: 3, slides: changedSlides
      }, selectedContext)).resolves.toMatchObject({
        isError: true,
        output: { error: expect.stringContaining('preserve stable slide ids, titles, and content') }
      })
    }
    const reviewed = await review.execute({
      workflowId, parentThreadId: 'parent', projectDir, deckTitle: 'Architecture decision',
      pageCount: 3, slides: reviewSlides
    }, selectedContext)
    expect(reviewed).toMatchObject({
      output: {
        reviewBundle: {
          phase: 'awaiting_review',
          designGovernance: {
            planFingerprint: (accepted.output as { planFingerprint: string }).planFingerprint
          }
        }
      }
    })
    await expect(plan.execute({ workflowId, projectDir, plan: planFor(1) }, selectedContext)).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('exactly match') }
    })
  })

  it('reconciles an exactly matching host plan after a manifest-write partial commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-ppt-direction-reconcile-'))
    roots.push(root)
    await prepare(root)
    const bundle = await createDirections(root)
    const selected = bundle.directions[1]
    const selectedContext = context(root, trustedContext(
      bundle,
      [{ directionId: selected.directionId, revision: selected.revision }],
      'select_direction'
    ))
    const read = tools().find((candidate) => candidate.name === PPT_READ_DIRECTION_SELECTION_TOOL_NAME)!
    await read.execute({ workflowId, projectDir }, selectedContext)
    const manifestPath = join(root, projectDir, '.kun-ppt-review', 'manifest.json')
    const directionOnlyManifest = await readFile(manifestPath, 'utf8')
    const plan = tools().find((candidate) => candidate.name === PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME)!
    const first = await plan.execute({ workflowId, projectDir, plan: planFor(2) }, selectedContext)
    expect(first).toMatchObject({ output: { validated: true, planRevision: 1 } })
    const retryWithoutCard = context(root, trustedContext(bundle, [], 'select_direction'))
    await expect(read.execute({ workflowId, projectDir }, retryWithoutCard)).resolves.toMatchObject({
      output: { directionId: selected.directionId, plan: planFor(2) }
    })

    await writeFile(manifestPath, directionOnlyManifest)
    const retried = await plan.execute({ workflowId, projectDir, plan: planFor(2) }, selectedContext)
    expect(retried).toMatchObject({ output: { validated: true, planRevision: 1 } })
    const reconciled = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(reconciled).toMatchObject({
      phase: 'planning',
      governance: { designPlan: { fingerprint: (first.output as { planFingerprint: string }).planFingerprint } }
    })
  })
})
