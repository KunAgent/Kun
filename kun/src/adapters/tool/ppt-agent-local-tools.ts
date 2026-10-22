import { mkdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { createPptReviewManifest, readPptReviewManifest, reviewManifestPath, toPptReviewBundle, writePptReviewManifest } from '../../ppt/ppt-review-manifest.js'
import { designPlanStyleSpec, markPptGovernanceReviewed, writePptDesignGovernance } from '../../ppt/ppt-design-governance.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import { assertCanWritePath } from './sandbox-policy.js'
import {
  buildPptAgentGovernanceTools,
  PPT_READ_GUIDE_TOOL_NAME,
  PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME,
  requireCurrentPptGovernance,
  requiresPptDesignGovernance
} from './ppt-agent-governance-tools.js'
import {
  directionReviewIdentityError,
  governanceProjectionMatches,
  integerArg,
  parseReviewSlides,
  assertPptWorkflowBinding,
  reviewSlideRevision,
  stringArg,
  type PptAgentLocalToolOptions,
  type ReviewBundleSlideInput
} from './ppt-agent-local-tools-support.js'
import {
  createPptReadReviewContextTool,
  PPT_READ_REVIEW_CONTEXT_TOOL_NAME
} from './ppt-agent-review-context-tool.js'
import {
  createPptImportAssetTool,
  PPT_IMPORT_ASSET_TOOL_NAME
} from './ppt-agent-asset-tool.js'
import { createPptExportTool, PPT_EXPORT_TOOL_NAME } from './ppt-agent-export-tool.js'
import {
  buildPptAgentDirectionTools,
  PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME,
  PPT_READ_DIRECTION_SELECTION_TOOL_NAME
} from './ppt-agent-direction-tools.js'
import {
  assertPptScopedExistingPath,
  assertPptScopedMutationPath
} from './ppt-agent-physical-path.js'
import { PPTD_PREVIEW_RENDERER, renderPptdPreviewDeck } from '../../ppt/pptd-preview-svg.js'
import { portableRelative, writePptPreviewSvgs } from './ppt-agent-preview-files.js'
import { pptSlideAssets, readPptAssetLedger } from './ppt-agent-asset-ledger.js'

export const PPT_GENERATE_PREVIEWS_TOOL_NAME = 'ppt_generate_previews'
export const PPT_CREATE_REVIEW_BUNDLE_TOOL_NAME = 'ppt_create_review_bundle'
// The top-level delegation entry point owns the `ppt-agent` provider ID.
// Local PPT workflow tools are included in the child/base registry as well,
// so they need a separate provider identity when both registries are composed.
export const PPT_AGENT_LOCAL_PROVIDER_ID = 'ppt-agent-local' as const
export { PPT_EXPORT_TOOL_NAME }
export { PPT_READ_GUIDE_TOOL_NAME, PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME }
export { PPT_READ_REVIEW_CONTEXT_TOOL_NAME }
export { PPT_IMPORT_ASSET_TOOL_NAME }
export { PPT_CREATE_DIRECTION_BUNDLE_TOOL_NAME, PPT_READ_DIRECTION_SELECTION_TOOL_NAME }

/**
 * Safe, first-party PPT helpers used by the Lab-gated PPT agent. They expose
 * only bundled reference Markdown and one fixed offline WASM exporter; unlike
 * a shell call, neither tool can execute an arbitrary command or escape the
 * active workspace for input/output files.
 */
export function buildPptAgentLocalTools(options: PptAgentLocalToolOptions = {}): LocalTool[] {
  const shouldAdvertise = (context: ToolHostContext): boolean =>
    options.enabled?.() !== false && context.pptWorkflowScope !== undefined
  return [
    ...buildPptAgentGovernanceTools(options, shouldAdvertise),
    ...buildPptAgentDirectionTools(options, shouldAdvertise),
    createPptReadReviewContextTool(shouldAdvertise, () => options.enabled?.() !== false),
    createPptImportAssetTool(options, shouldAdvertise),
    createPptExportTool(options, shouldAdvertise),
    // Each workflow reviews one kind of preview: editable decks are rendered by the host,
    // legacy image-first reviews register generated whole-page images.
    createPptGeneratePreviewsTool(options, (context) =>
      shouldAdvertise(context) && context.pptWorkflowScope?.previewMode === 'editable'),
    createPptCreateReviewBundleTool(options, (context) =>
      shouldAdvertise(context) && context.pptWorkflowScope?.previewMode === 'image-first')
  ]
}

function createPptGeneratePreviewsTool(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: (context: ToolHostContext) => boolean
): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_GENERATE_PREVIEWS_TOOL_NAME,
    description: [
      'Render every page of a workspace PPTD project with the built-in renderer into a review bundle for the parent whiteboard.',
      'It needs no image generation and no external editor: the previews are drawn straight from the editable PPTD, so they show what the export will contain.',
      'The bundle is persisted with a stable manifest so revised slides can be reviewed independently. Fill image slots before rendering; this tool never exports a final PPTX.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Host-owned governed PPT workflow id.' },
        parentThreadId: { type: 'string', description: 'Owning parent chat thread id supplied by ppt_agent.' },
        input: { type: 'string', description: 'Workspace-relative deck.pptd path or PPTD project directory.' },
        output: { type: 'string', description: 'Optional workspace-relative preview directory. Defaults to <project>/.kun-ppt-review/previews.' },
        force: { type: 'boolean', description: 'Replace an existing preview directory. Defaults to true for a new review revision.' }
      },
      required: ['parentThreadId', 'input'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (options.enabled?.() === false) {
        return { output: { error: 'PPT Agent is disabled in Lab settings' }, isError: true }
      }
      const scope = assertPptWorkflowBinding({
        context,
        actions: ['start', 'select_direction', 'revise_previews', 'retry_failed'],
        previewMode: 'editable'
      })
      const inputArg = stringArg(args.input)
      const parentThreadId = stringArg(args.parentThreadId)
      if (!parentThreadId || !inputArg) {
        return { output: { error: 'parentThreadId and input are required' }, isError: true }
      }
      const input = await resolveWorkspacePath(inputArg, context, { enforceWorkspaceBoundary: true })
      const lexicalProject = resolve(input.workspaceRoot, scope.projectDir)
      const inspectProject = () => assertPptScopedExistingPath({
        workspaceRoot: input.workspaceRoot, scopeRoot: lexicalProject, targetPath: lexicalProject,
        label: 'PPT project', expected: 'directory', recursive: true
      })
      const inspectInput = () => assertPptScopedExistingPath({
        workspaceRoot: input.workspaceRoot, scopeRoot: lexicalProject, targetPath: input.absolutePath,
        label: 'PPT preview input', expected: 'file-or-directory'
      })
      const [projectProof, inputProof] = await Promise.all([inspectProject(), inspectInput()])
      const workspaceRoot = projectProof.physicalWorkspaceRoot
      const projectDir = projectProof.physicalPath
      const workflowId = stringArg(args.workflowId)
      if (requiresPptDesignGovernance(context) && !workflowId) {
        return { output: { error: 'workflowId is required for governed PPT previews' }, isError: true }
      }
      const governance = requiresPptDesignGovernance(context)
        ? await requireCurrentPptGovernance({
            options,
            context,
            workspaceRoot,
            projectDir,
            workflowId
          })
        : undefined
      assertPptWorkflowBinding({
        context,
        workflowId,
        projectDir: relative(workspaceRoot, projectDir).replaceAll('\\', '/') || '.',
        parentThreadId
      })
      const requestedOutput = stringArg(args.output)
      const output = requestedOutput
        ? await resolveWorkspacePath(requestedOutput, context, { enforceWorkspaceBoundary: true })
        : await resolveWorkspacePath(
            `${scope.projectDir.replaceAll('\\', '/')}/.kun-ppt-review/previews`,
            context,
            { enforceWorkspaceBoundary: true }
          )
      assertCanWritePath(output.absolutePath, context)
      const inspectOutput = (existing = false) => existing
        ? assertPptScopedExistingPath({
            workspaceRoot: input.workspaceRoot, scopeRoot: lexicalProject, targetPath: output.absolutePath,
            label: 'PPT preview output', expected: 'directory', recursive: true
          })
        : assertPptScopedMutationPath({
            workspaceRoot: input.workspaceRoot, scopeRoot: lexicalProject, targetPath: output.absolutePath,
            label: 'PPT preview output', expected: 'directory'
          })
      await inspectOutput()
      return withFileMutationQueue(output.absolutePath, async () => {
        const [, currentInput] = await Promise.all([inspectProject(), inspectInput()])
        await inspectOutput()
        const rendered = await renderPptdPreviewDeck(currentInput.physicalPath)
        if (rendered.pages.length === 0) throw new Error('preview renderer produced no page images')
        if (governance && rendered.pages.length !== governance.snapshot.designPlan.pageStrategy.pageCount) {
          throw new Error(
            `preview slide count ${rendered.pages.length} does not match governed page count ${governance.snapshot.designPlan.pageStrategy.pageCount}`
          )
        }
        const existingManifest = await readPptReviewManifest(projectDir)
        if (
          governance &&
          existingManifest &&
          (
            existingManifest.workflowId !== workflowId ||
            existingManifest.childId !== context.threadId ||
            existingManifest.previewMode !== 'editable' ||
            (
              governance.state.reviewedPlanFingerprint === governance.snapshot.designPlan.fingerprint &&
              !governanceProjectionMatches(existingManifest.governance, governance.snapshot)
            )
          )
        ) {
          throw new Error('PPT preview manifest does not match the authoritative host governance state')
        }
        const directionIdentityError = directionReviewIdentityError(existingManifest, scope)
        if (directionIdentityError) throw new Error(directionIdentityError)
        const previewFiles = await writePptPreviewSvgs({
          pages: rendered.pages,
          outputDir: output.absolutePath,
          workspaceRoot: input.workspaceRoot,
          revisions: rendered.pages.map((_, index) => (existingManifest?.slides[index]?.revision ?? 0) + 1),
          keep: existingManifest?.slides.map((slide) => slide.previewPath ?? '') ?? []
        })
        const assetLedger = await readPptAssetLedger(projectDir)
        const manifest = createPptReviewManifest({
          ...(governance
            ? { workflowId: governance.state.workflowId }
            : existingManifest
              ? { workflowId: existingManifest.workflowId }
              : {}),
          parentThreadId,
          childId: context.threadId,
          projectDir: portableRelative(workspaceRoot, projectDir) || '.',
          previewMode: 'editable',
          deckTitle: rendered.title || (inputProof.kind === 'directory'
            ? input.absolutePath.split(/[\\/]/).pop() || 'PPT review'
            : input.absolutePath.split(/[\\/]/).slice(-2, -1)[0] || 'PPT review'),
          styleSpec: governance
            ? {
                ...designPlanStyleSpec(governance.snapshot.designPlan),
                fingerprint: governance.snapshot.designPlan.fingerprint
              }
            : existingManifest?.styleSpec ?? {
                fingerprint: 'legacy-preview-style',
                fonts: [],
                colorTokens: {},
                typeScale: {},
                spacingScale: [],
                backgroundLanguage: 'PPT editable review',
                imageTreatment: 'supplementary image assets',
                chartTreatment: 'native editable PPT elements'
              },
          ...(governance ? { governance: governance.snapshot } : {}),
          ...(existingManifest?.directions ? { directions: existingManifest.directions } : {}),
          slides: rendered.pages.map((page, index) => ({
            ...(existingManifest?.slides[index] ? { slideId: existingManifest.slides[index].slideId } : {}),
            title: existingManifest?.slides[index]?.title || page.title || `P${index + 1}`,
            layoutSpecPath: page.pageFile,
            prompt: page.pageFile
          }))
        })
        const nextManifest = {
          ...manifest,
          phase: 'awaiting_review' as const,
          ...(governance ? { governance: governance.snapshot } : {}),
          slides: manifest.slides.map((slide, index) => ({
            ...slide,
            ...(scope.action === 'select_direction' && existingManifest?.slides[index]?.contentHash
              ? { contentHash: existingManifest.slides[index].contentHash }
              : {}),
            previewPath: portableRelative(workspaceRoot, previewFiles[index]),
            ...(rendered.pages[index].images.length
              ? {
                  assets: pptSlideAssets(
                    rendered.pages[index].images.map((image) => portableRelative(projectDir, resolve(rendered.deckDir, image))),
                    assetLedger,
                    (projectRelative) => portableRelative(workspaceRoot, resolve(projectDir, projectRelative))
                  )
                }
              : {}),
            revision: (existingManifest?.slides[index]?.revision ?? 0) + 1,
            status: 'ready' as const,
            attempts: (existingManifest?.slides[index]?.attempts ?? 0) + 1
          }))
        }
        await assertPptScopedMutationPath({
          workspaceRoot: input.workspaceRoot, scopeRoot: lexicalProject,
          targetPath: resolve(lexicalProject, '.kun-ppt-review', 'manifest.json'),
          label: 'PPT review manifest', expected: 'file'
        })
        await writePptReviewManifest(projectDir, nextManifest)
        if (governance) {
          await writePptDesignGovernance(
            governance.store,
            markPptGovernanceReviewed(governance.state, governance.snapshot.designPlan.fingerprint)
          )
        }
        const manifestPath = portableRelative(workspaceRoot, resolve(projectDir, '.kun-ppt-review/manifest.json'))
        return {
          output: {
            ...toPptReviewBundle(nextManifest, manifestPath),
            output: output.relativePath,
            renderer: PPTD_PREVIEW_RENDERER,
            reviewBundle: toPptReviewBundle(nextManifest, manifestPath)
          }
        }
      })
    })
  })
}

function createPptCreateReviewBundleTool(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: (context: ToolHostContext) => boolean
): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_CREATE_REVIEW_BUNDLE_TOOL_NAME,
    description: [
      'Create or revise a PPT visual-review bundle from one generate_image result per slide.',
      'Initial calls must cover every planned slide; a slide may carry an error when image generation failed.',
      'Revision calls use stable slideId values and replace only the requested slides. This tool never creates PPTD or PPTX files.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Host-owned workflow id; required for governed creation and all revisions.' },
        parentThreadId: { type: 'string', description: 'Owning parent chat thread id supplied by ppt_agent.' },
        projectDir: { type: 'string', description: 'Workspace-relative directory reserved for this PPT project.' },
        deckTitle: { type: 'string', description: 'Deck title.' },
        pageCount: { type: 'integer', minimum: 1, maximum: 50, description: 'Total planned slide count.' },
        styleSummary: { type: 'string', description: 'Locked visual system shared by all generated slide images.' },
        slides: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              slideId: { type: 'string', description: 'Stable id required when revising an existing workflow.' },
              title: { type: 'string' },
              prompt: { type: 'string', description: 'Full 16:9 visual brief used for generate_image.' },
              imagePath: { type: 'string', description: 'Workspace-relative files[0].relativePath returned by generate_image.' },
              error: { type: 'string', description: 'Recoverable generation failure when no imagePath is available.' }
            },
            required: ['title', 'prompt'],
            additionalProperties: false
          }
        }
      },
      required: ['parentThreadId', 'projectDir', 'deckTitle', 'pageCount', 'slides'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (options.enabled?.() === false) {
        return { output: { error: 'PPT Agent is disabled in Lab settings' }, isError: true }
      }
      const scope = assertPptWorkflowBinding({
        context,
        actions: ['start', 'select_direction', 'revise_previews', 'retry_failed'],
        previewMode: 'image-first'
      })
      const workflowId = stringArg(args.workflowId)
      const parentThreadId = stringArg(args.parentThreadId)
      const projectArg = stringArg(args.projectDir)
      const deckTitle = stringArg(args.deckTitle)
      const pageCount = integerArg(args.pageCount, 1, 50, 0)
      const slides = parseReviewSlides(args.slides)
      if (!parentThreadId || !projectArg || !deckTitle || pageCount === 0 || slides.length === 0) {
        return { output: { error: 'parentThreadId, projectDir, deckTitle, pageCount, and valid slides are required' }, isError: true }
      }
      assertPptWorkflowBinding({ context, workflowId, projectDir: projectArg, parentThreadId })
      const project = await resolveWorkspacePath(projectArg, context, { enforceWorkspaceBoundary: true })
      assertCanWritePath(project.absolutePath, context)
      const inspectProjectMutation = () => assertPptScopedMutationPath({
        workspaceRoot: project.workspaceRoot, scopeRoot: project.absolutePath,
        targetPath: project.absolutePath, label: 'PPT project directory', expected: 'directory'
      })
      await inspectProjectMutation()
      const projectProof = await withFileMutationQueue(project.absolutePath, async () => {
        await inspectProjectMutation()
        await mkdir(project.absolutePath, { recursive: true })
        return assertPptScopedExistingPath({
          workspaceRoot: project.workspaceRoot, scopeRoot: project.absolutePath,
          targetPath: project.absolutePath, label: 'PPT project', expected: 'directory', recursive: true
        })
      })
      const workspaceRoot = projectProof.physicalWorkspaceRoot
      const projectDir = projectProof.physicalPath
      assertPptWorkflowBinding({
        context,
        workflowId,
        projectDir: relative(workspaceRoot, projectDir).replaceAll('\\', '/') || '.',
        parentThreadId
      })
      if (requiresPptDesignGovernance(context) && !workflowId) {
        return { output: { error: 'workflowId is required for governed PPT review bundles' }, isError: true }
      }
      const governance = requiresPptDesignGovernance(context)
        ? await requireCurrentPptGovernance({ options, context, workspaceRoot, projectDir, workflowId })
        : undefined
      if (governance && pageCount !== governance.snapshot.designPlan.pageStrategy.pageCount) {
        return {
          output: {
            error: `pageCount ${pageCount} does not match governed page count ${governance.snapshot.designPlan.pageStrategy.pageCount}`
          },
          isError: true
        }
      }
      const imageRoot = await resolveWorkspacePath('.kun/images', context, { enforceWorkspaceBoundary: true })
      const resolveSlides = () => Promise.all(slides.map(async (slide) => {
        if (!slide.imagePath) return slide
        if (!slide.imagePath.replaceAll('\\', '/').startsWith('.kun/images/')) {
          throw new Error(`imagePath must come from generate_image: ${slide.imagePath}`)
        }
        const image = await resolveWorkspacePath(slide.imagePath, context, { enforceWorkspaceBoundary: true })
        const proof = await assertPptScopedExistingPath({
          workspaceRoot: image.workspaceRoot, scopeRoot: imageRoot.absolutePath,
          targetPath: image.absolutePath, label: 'PPT review image source', expected: 'file'
        })
        if (!proof.bytes || !/\.(?:png|jpe?g|webp)$/i.test(image.relativePath)) {
          throw new Error(`slide image must be an existing PNG, JPEG, or WebP file: ${slide.imagePath}`)
        }
        return { ...slide, imagePath: image.relativePath }
      }))
      const resolvedSlides = await resolveSlides()
      const manifestTarget = resolve(project.absolutePath, '.kun-ppt-review', 'manifest.json')
      await assertPptScopedMutationPath({
        workspaceRoot: project.workspaceRoot, scopeRoot: project.absolutePath,
        targetPath: manifestTarget, label: 'PPT review manifest', expected: 'file'
      })
      return withFileMutationQueue(reviewManifestPath(projectDir), async () => {
        await assertPptScopedExistingPath({
          workspaceRoot: project.workspaceRoot, scopeRoot: project.absolutePath,
          targetPath: project.absolutePath, label: 'PPT project', expected: 'directory', recursive: true
        })
        await assertPptScopedMutationPath({
          workspaceRoot: project.workspaceRoot, scopeRoot: project.absolutePath,
          targetPath: manifestTarget, label: 'PPT review manifest', expected: 'file'
        })
        await resolveSlides()
        const existing = await readPptReviewManifest(projectDir)
        if (!existing && resolvedSlides.length !== pageCount) {
          return { output: { error: `initial review must cover all ${pageCount} slides; received ${resolvedSlides.length}` }, isError: true }
        }
        if (!existing && resolvedSlides.some((slide) => slide.slideId)) {
          return { output: { error: 'slideId must be omitted for an initial review; the workflow assigns stable ids' }, isError: true }
        }
        if (existing && existing.deck.slideCount !== pageCount) {
          return { output: { error: `pageCount ${pageCount} does not match workflow slide count ${existing.deck.slideCount}` }, isError: true }
        }
        if (existing && (!workflowId || workflowId !== existing.workflowId)) {
          return { output: { error: 'workflowId must match the existing PPT review workflow' }, isError: true }
        }
        if (existing && (existing.childId !== context.threadId || existing.parentThreadId !== parentThreadId)) {
          return { output: { error: 'PPT review revisions must resume the original child and parent thread' }, isError: true }
        }
        if (governance && existing && existing.previewMode !== 'image-first') {
          return { output: { error: 'PPT image-first review cannot resume an editable preview manifest' }, isError: true }
        }
        const directionIdentityError = directionReviewIdentityError(existing, scope, resolvedSlides)
        if (directionIdentityError) return { output: { error: directionIdentityError }, isError: true }
        if (
          governance &&
          existing &&
          governance.state.reviewedPlanFingerprint === governance.snapshot.designPlan.fingerprint &&
          !governanceProjectionMatches(existing.governance, governance.snapshot)
        ) {
          return {
            output: { error: 'PPT review manifest does not match the authoritative host governance state' },
            isError: true
          }
        }
        const planChanged = Boolean(
          governance &&
          existing &&
          existing.governance?.designPlan.fingerprint !== governance.snapshot.designPlan.fingerprint
        )
        if (
          planChanged &&
          (
            resolvedSlides.length !== existing!.slides.length ||
            resolvedSlides.some((slide) => !slide.slideId) ||
            existing!.slides.some((slide) => !resolvedSlides.some((update) => update.slideId === slide.slideId))
          )
        ) {
          return {
            output: { error: 'the design plan changed; create a fresh review revision covering every stable slideId' },
            isError: true
          }
        }
        const styleSummary = stringArg(args.styleSummary)
        const styleSpec = governance
          ? {
              ...designPlanStyleSpec(governance.snapshot.designPlan),
              fingerprint: governance.snapshot.designPlan.fingerprint
            }
          : existing?.styleSpec ?? {
              fingerprint: 'legacy-generated-style',
              fonts: [],
              colorTokens: {},
              typeScale: {},
              spacingScale: [],
              backgroundLanguage: styleSummary || 'Consistent 16:9 generated slide visual system',
              imageTreatment: 'full-slide generated visual concepts',
              chartTreatment: 'native editable PPT elements in the approved deck'
            }
        if (!existing) {
          const manifest = createPptReviewManifest({
            ...(governance ? { workflowId: governance.state.workflowId } : {}),
            parentThreadId,
            childId: context.threadId,
            projectDir: relative(workspaceRoot, projectDir).replaceAll('\\', '/') || '.',
            previewMode: 'image-first',
            deckTitle,
            styleSpec,
            ...(governance ? { governance: governance.snapshot } : {}),
            slides: resolvedSlides.map((slide) => ({ title: slide.title, prompt: slide.prompt }))
          })
          const nextManifest = {
            ...manifest,
            phase: 'awaiting_review' as const,
            slides: manifest.slides.map((slide, index) => reviewSlideRevision(slide, resolvedSlides[index]))
          }
          await writePptReviewManifest(projectDir, nextManifest)
          if (governance) {
            await writePptDesignGovernance(
              governance.store,
              markPptGovernanceReviewed(governance.state, governance.snapshot.designPlan.fingerprint)
            )
          }
          const manifestPath = relative(workspaceRoot, reviewManifestPath(projectDir)).replaceAll('\\', '/')
          return { output: { reviewBundle: toPptReviewBundle(nextManifest, manifestPath), manifestPath } }
        }
        const updates = new Map<string, ReviewBundleSlideInput>()
        for (const slide of resolvedSlides) {
          if (!slide.slideId || !existing.slides.some((candidate) => candidate.slideId === slide.slideId)) {
            return { output: { error: 'every revision slide must use a stable slideId from the existing workflow' }, isError: true }
          }
          if (updates.has(slide.slideId)) {
            return { output: { error: `duplicate slideId: ${slide.slideId}` }, isError: true }
          }
          updates.set(slide.slideId, slide)
        }
        const nextManifest = {
          ...existing,
          phase: 'awaiting_review' as const,
          ...(governance ? { governance: governance.snapshot, styleSpec } : {}),
          validatedExport: undefined,
          slides: existing.slides.map((slide) => {
            const update = updates.get(slide.slideId)
            return update ? reviewSlideRevision(slide, update, styleSpec) : slide
          })
        }
        await writePptReviewManifest(projectDir, nextManifest)
        if (governance) {
          await writePptDesignGovernance(
            governance.store,
            markPptGovernanceReviewed(governance.state, governance.snapshot.designPlan.fingerprint)
          )
        }
        const manifestPath = relative(workspaceRoot, reviewManifestPath(projectDir)).replaceAll('\\', '/')
        return { output: { reviewBundle: toPptReviewBundle(nextManifest, manifestPath), manifestPath } }
      })
    })
  })
}
