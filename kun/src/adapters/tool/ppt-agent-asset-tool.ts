import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import {
  assertPptScopedExistingPath,
  assertPptScopedMutationPath
} from './ppt-agent-physical-path.js'
import { assertCanWritePath } from './sandbox-policy.js'
import {
  PPT_GENERATED_ASSET_LIMIT,
  generatedAssetCount,
  readPptAssetLedger,
  recordPptAsset
} from './ppt-agent-asset-ledger.js'
import {
  assertPptWorkflowBinding,
  stringArg,
  type PptAgentLocalToolOptions
} from './ppt-agent-local-tools-support.js'

export const PPT_IMPORT_ASSET_TOOL_NAME = 'ppt_import_asset'

/**
 * Copy one slide image into the governed PPTD project as binary data. Sources
 * are either the user's own material anywhere in the workspace or a
 * supplementary image from generate_image (.kun/images); the import is logged
 * so reviews can show each image's origin and generated images stay capped.
 */
export function createPptImportAssetTool(
  options: PptAgentLocalToolOptions,
  shouldAdvertise: (context: ToolHostContext) => boolean
): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_IMPORT_ASSET_TOOL_NAME,
    description: [
      'Import one image into the current governed PPT project media directory without text transcoding, then reference it from PPTD as media/<name>.',
      'Use it for the user\'s own material (any PNG/JPEG/WebP in the workspace, preferred when relevant) or for a supplementary asset generate_image wrote under .kun/images.',
      `Generated images are slot assets, never whole slides; at most ${PPT_GENERATED_ASSET_LIMIT} per deck.`
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Workspace-relative image path: user material in the workspace, or a generate_image result under .kun/images.'
        },
        name: {
          type: 'string',
          description: 'Optional destination filename inside project/media; defaults to the source basename.'
        }
      },
      required: ['source'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (options.enabled?.() === false) {
        return { output: { error: 'PPT Agent is disabled in Lab settings' }, isError: true }
      }
      const scope = assertPptWorkflowBinding({
        context,
        actions: ['start', 'select_direction', 'revise_previews', 'retry_failed', 'approve_and_build']
      })
      const sourceArg = stringArg(args.source).replaceAll('\\', '/')
      const generated = sourceArg.startsWith('.kun/images/')
      const projectPrefix = `${scope.projectDir.replaceAll('\\', '/').replace(/\/+$/, '')}/`
      if (
        !sourceArg || sourceArg.split('/').includes('..') ||
        (!generated && (sourceArg.startsWith('.kun/') || sourceArg.startsWith(projectPrefix)))
      ) {
        return {
          output: { error: 'source must be user material in the workspace or a generated image under .kun/images' },
          isError: true
        }
      }
      const source = await resolveWorkspacePath(sourceArg, context, { enforceWorkspaceBoundary: true })
      const sourceName = basename(source.relativePath)
      const requestedName = stringArg(args.name) || sourceName
      if (
        basename(requestedName) !== requestedName ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedName) ||
        !/\.(?:png|jpe?g|webp)$/i.test(requestedName) ||
        extname(requestedName).toLowerCase() !== extname(sourceName).toLowerCase()
      ) {
        return { output: { error: 'name must be a safe PNG, JPEG, or WebP filename with the source extension' }, isError: true }
      }

      const imageRoot = generated
        ? await resolveWorkspacePath('.kun/images', context, { enforceWorkspaceBoundary: true })
        : { absolutePath: source.workspaceRoot }
      const project = await resolveWorkspacePath(scope.projectDir, context, { enforceWorkspaceBoundary: true })
      if (generated && generatedAssetCount(await readPptAssetLedger(project.absolutePath)) >= PPT_GENERATED_ASSET_LIMIT) {
        return {
          output: {
            error: `this deck already uses ${PPT_GENERATED_ASSET_LIMIT} generated images; reuse an imported asset, use the user's material, or compose the slot from native shapes`
          },
          isError: true
        }
      }
      const sourceProof = await assertPptScopedExistingPath({
        workspaceRoot: source.workspaceRoot,
        scopeRoot: imageRoot.absolutePath,
        targetPath: source.absolutePath,
        label: 'PPT image source',
        expected: 'file'
      })
      if (!sourceProof.bytes) {
        return { output: { error: 'source must be a non-empty image file' }, isError: true }
      }
      const mediaDirectory = join(project.absolutePath, 'media')
      const destination = join(mediaDirectory, requestedName)
      assertCanWritePath(destination, context)
      await assertPptScopedMutationPath({
        workspaceRoot: project.workspaceRoot,
        scopeRoot: mediaDirectory,
        targetPath: destination,
        label: 'PPT imported asset destination',
        expected: 'file'
      })
      return withFileMutationQueue(destination, async () => {
        const currentSource = await assertPptScopedExistingPath({
          workspaceRoot: source.workspaceRoot,
          scopeRoot: imageRoot.absolutePath,
          targetPath: source.absolutePath,
          label: 'PPT image source',
          expected: 'file'
        })
        const currentProject = await assertPptScopedMutationPath({
          workspaceRoot: project.workspaceRoot,
          scopeRoot: project.absolutePath,
          targetPath: project.absolutePath,
          label: 'PPT project directory',
          expected: 'directory'
        })
        await mkdir(mediaDirectory, { recursive: true })
        const currentDestination = await assertPptScopedMutationPath({
          workspaceRoot: project.workspaceRoot,
          scopeRoot: mediaDirectory,
          targetPath: destination,
          label: 'PPT imported asset destination',
          expected: 'file'
        })
        assertPptWorkflowBinding({
          context,
          projectDir: relative(
            currentProject.physicalWorkspaceRoot,
            currentProject.physicalPath
          ).replaceAll('\\', '/') || '.'
        })
        await copyFile(currentSource.physicalPath, currentDestination.physicalPath, fsConstants.COPYFILE_EXCL)
        const copied = await assertPptScopedExistingPath({
          workspaceRoot: project.workspaceRoot,
          scopeRoot: mediaDirectory,
          targetPath: destination,
          label: 'PPT imported asset destination',
          expected: 'file'
        })
        const imported = relative(copied.physicalWorkspaceRoot, copied.physicalPath).replaceAll('\\', '/')
        const origin = generated ? 'generated' as const : 'user' as const
        await recordPptAsset(currentProject.physicalPath, `media/${requestedName}`, { origin, source: source.relativePath })
        return {
          output: {
            source: source.relativePath,
            importedPath: imported,
            pptdSrc: `media/${requestedName}`,
            origin,
            bytes: copied.bytes
          }
        }
      })
    })
  })
}
