import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { auditPptGeometryParts } from '../../ppt/ppt-geometry-qa.js'
import { PPT_GEOMETRY_QA_RELATIVE_PATH, writePptGeometryQaReport } from '../../ppt/ppt-geometry-qa-report.js'
import { withPptDeckQaIssues } from '../../ppt/ppt-deck-preview.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { assertPptScopedExistingPath, assertPptScopedMutationPath } from './ppt-physical-path.js'
import { refreshPptDeckPreview } from './ppt-deck-preview-tool.js'
import {
  portableRelative,
  pptToolsDisabled,
  resolvePptDeck,
  stringArg,
  type PptDeckToolOptions
} from './ppt-deck-tool-support.js'
import { MAX_EXPORT_OUTPUT_CHARS, requireToolchainDirectory, truncate, validatePptx } from './ppt-pptx-validation.js'
import { assertCanWritePath } from './sandbox-policy.js'

export const PPT_EXPORT_TOOL_NAME = 'ppt_export'

const execFileAsync = promisify(execFile)
const runtimeRequire = createRequire(import.meta.url)

export function createPptExportTool(options: PptDeckToolOptions): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_EXPORT_TOOL_NAME,
    description: [
      'Export an editable PPTD deck to .pptx with Kun\'s bundled offline exporter; this is the only way to produce the PPTX.',
      'It checks the package, that every slide has native editable content, the transitions, and slide geometry, and refreshes the review whiteboard with the QA markers.',
      'Geometry errors block publishing and come back with shape-level repair hints: fix the PPTD and export again.',
      'Use allowQaErrors only after two repair rounds failed, and tell the user what remains.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: true, guiAutomation: false },
    shouldAdvertise: () => options.enabled?.() !== false,
    inputSchema: {
      type: 'object',
      properties: {
        deck: { type: 'string', description: 'Workspace-relative .pptd file or deck folder.' },
        output: { type: 'string', description: 'Workspace-relative .pptx destination, usually presentations/<slug>.pptx.' },
        replace: { type: 'boolean', description: 'Overwrite an existing file at output. Defaults to false.' },
        transition: { type: 'string', enum: ['fade', 'none'], description: 'Per-slide transition. Defaults to fade.' },
        allowQaErrors: { type: 'boolean', description: 'Publish even when geometry QA still reports errors. Defaults to false.' }
      },
      required: ['deck', 'output'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      const disabled = pptToolsDisabled(options)
      if (disabled) return disabled
      const outputArg = stringArg(args.output)
      if (extname(outputArg).toLowerCase() !== '.pptx') {
        return { output: { error: 'output must be a workspace-relative path ending in .pptx' }, isError: true }
      }
      const deck = await resolvePptDeck(stringArg(args.deck), context, { requireManifest: true })
      const output = await resolveWorkspacePath(outputArg, context, { enforceWorkspaceBoundary: true })
      assertCanWritePath(output.absolutePath, context)
      const outputDir = dirname(output.absolutePath)
      await assertPptScopedMutationPath({
        workspaceRoot: output.workspaceRoot, scopeRoot: outputDir, targetPath: outputDir,
        label: 'PPT export folder', expected: 'directory'
      })
      await mkdir(outputDir, { recursive: true })
      const inspectOutput = () => assertPptScopedMutationPath({
        workspaceRoot: output.workspaceRoot, scopeRoot: outputDir, targetPath: output.absolutePath,
        label: 'PPT export output', expected: 'file'
      })
      const transition = args.transition === 'none' ? 'none' : 'fade'
      const preview = await refreshPptDeckPreview(deck, context)

      return withFileMutationQueue(output.absolutePath, async () => {
        let currentOutput = await inspectOutput()
        if (currentOutput.exists && args.replace !== true) {
          return { output: { error: `${output.relativePath} already exists; pass replace=true to overwrite it or choose another name` }, isError: true }
        }
        const toolchain = await requireToolchainDirectory(options)
        const exporter = resolve(toolchain, 'scripts', 'local-export', 'export-pptd.mjs')
        const wasm = resolve(toolchain, 'scripts', 'local-export', 'pptd_wasm_bg.wasm')
        await Promise.all([access(exporter), access(wasm)])
        const temporaryOutput = join(outputDir, `.${randomUUID()}.${output.absolutePath.split(/[\\/]/).pop()}.tmp.pptx`)
        assertCanWritePath(temporaryOutput, context)
        const inspectTemporary = (existing: boolean) => existing
          ? assertPptScopedExistingPath({
              workspaceRoot: output.workspaceRoot, scopeRoot: outputDir, targetPath: temporaryOutput,
              label: 'PPT temporary output', expected: 'file'
            })
          : assertPptScopedMutationPath({
              workspaceRoot: output.workspaceRoot, scopeRoot: outputDir, targetPath: temporaryOutput,
              label: 'PPT temporary output', expected: 'file'
            })
        await inspectTemporary(false)
        try {
          const result = await execFileAsync(process.execPath, [
            exporter, deck.manifestPath!, '--output', temporaryOutput, '--no-sign', '--local-images-only',
            '--transition', transition, '--wasm', wasm
          ], {
            cwd: deck.physicalProjectDir,
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: '1',
              KIMI_COOKIE: '',
              KIMI_ORIGIN: 'http://127.0.0.1',
              KUN_PPT_YAML_MODULE: runtimeRequire.resolve('yaml')
            },
            timeout: 5 * 60 * 1_000,
            maxBuffer: MAX_EXPORT_OUTPUT_CHARS * 4,
            signal: context.abortSignal
          })
          const temporaryProof = await inspectTemporary(true)
          const validation = await validatePptx(temporaryProof.physicalPath, transition)
          const report = auditPptGeometryParts(validation.geometryParts, { coverSlideIndexes: [0] })
          await assertPptScopedMutationPath({
            workspaceRoot: deck.physicalWorkspaceRoot,
            scopeRoot: deck.physicalProjectDir,
            targetPath: resolve(deck.physicalProjectDir, PPT_GEOMETRY_QA_RELATIVE_PATH),
            label: 'PPT geometry QA report',
            expected: 'file'
          })
          await writePptGeometryQaReport(deck.physicalProjectDir, report)
          // QA markers map onto preview cards only when both describe the same pages.
          const boardIssues = validation.slides === preview.bundle.slides.length ? report.issues : []
          const qa = {
            reportPath: deck.projectRelative === '.' ? PPT_GEOMETRY_QA_RELATIVE_PATH : `${deck.projectRelative}/${PPT_GEOMETRY_QA_RELATIVE_PATH}`,
            counts: report.counts
          }
          if (report.counts.errors > 0 && args.allowQaErrors !== true) {
            return {
              output: {
                error: `geometry QA found ${report.counts.errors} error(s); apply the repairHint values to the PPTD and export again`,
                validated: false,
                phase: 'failed_recoverable',
                deck: deck.projectRelative,
                qa,
                issues: report.issues,
                reviewBundle: withPptDeckQaIssues(preview.bundle, boardIssues, 'failed_recoverable')
              },
              isError: true
            }
          }
          currentOutput = await inspectOutput()
          if (currentOutput.exists) await rm(currentOutput.physicalPath)
          await rename(temporaryProof.physicalPath, (await inspectOutput()).physicalPath)
          const published = await assertPptScopedExistingPath({
            workspaceRoot: output.workspaceRoot, scopeRoot: outputDir, targetPath: output.absolutePath,
            label: 'PPT export output', expected: 'file'
          })
          return {
            output: {
              deck: deck.projectRelative,
              output: portableRelative(published.physicalWorkspaceRoot, published.physicalPath),
              absolutePath: published.physicalPath,
              slides: validation.slides,
              editableSlides: validation.editableSlides,
              fadeTransitions: validation.fadeTransitions,
              bytes: validation.bytes,
              transition,
              validated: true,
              qaPassed: report.counts.errors === 0,
              phase: 'completed',
              qa,
              issues: report.issues,
              reviewBundle: withPptDeckQaIssues(preview.bundle, boardIssues, 'completed'),
              log: truncate(`${result.stdout ?? ''}${result.stderr ?? ''}`)
            }
          }
        } finally {
          const leftover = await inspectTemporary(false).catch(() => undefined)
          if (leftover?.exists) await rm(leftover.physicalPath, { force: true }).catch(() => undefined)
        }
      })
    })
  })
}
