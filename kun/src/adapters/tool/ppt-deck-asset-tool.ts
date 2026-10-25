import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  PPT_GENERATED_ASSET_LIMIT,
  generatedAssetCount,
  readPptAssetLedger,
  recordPptAsset
} from './ppt-asset-ledger.js'
import { assertPptScopedExistingPath, assertPptScopedMutationPath } from './ppt-physical-path.js'
import {
  portableRelative,
  pptImageAssetState,
  resolvePptDeck,
  stringArg,
  type PptDeckToolOptions
} from './ppt-deck-tool-support.js'
import { assertCanWritePath } from './sandbox-policy.js'

export const PPT_IMPORT_ASSET_TOOL_NAME = 'ppt_import_asset'

/**
 * Copy one slide image into a deck's media folder as bytes. Sources are the
 * user's own workspace images or generate_image results under .kun/images;
 * each import is logged so reviews show where pictures came from, and
 * generated images stay capped per deck.
 */
export function createPptImportAssetTool(options: PptDeckToolOptions): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_IMPORT_ASSET_TOOL_NAME,
    description: [
      'Copy one image into a PPTD deck\'s media/ folder without transcoding, then reference it from a page as the returned pptdSrc.',
      'Use it for the user\'s own material (a PNG/JPEG/WebP anywhere in the workspace, preferred when relevant) or a supplementary image generate_image wrote under .kun/images.',
      `Generated images fill image slots only, never whole slides; at most ${PPT_GENERATED_ASSET_LIMIT} per deck.`
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Workspace-relative image: user material, or a generate_image result under .kun/images.' },
        deck: { type: 'string', description: 'Workspace-relative .pptd file or deck folder to import into.' },
        name: { type: 'string', description: 'Optional file name inside media/; defaults to the source name.' }
      },
      required: ['source', 'deck'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      const deck = await resolvePptDeck(stringArg(args.deck), context, { requireManifest: false })
      const sourceArg = stringArg(args.source).replaceAll('\\', '/')
      const generated = sourceArg.startsWith('.kun/images/')
      const deckPrefix = `${deck.projectRelative.replace(/\/+$/, '')}/`
      if (
        !sourceArg || sourceArg.split('/').includes('..') ||
        (!generated && (sourceArg.startsWith('.kun/') || (deck.projectRelative !== '.' && sourceArg.startsWith(deckPrefix))))
      ) {
        return { output: { error: 'source must be user material in the workspace or a generate_image result under .kun/images' }, isError: true }
      }
      if (generated && pptImageAssetState(options) === 'disabled') {
        return { output: { error: 'generated image assets are turned off in PPT skill settings; use the user\'s material or native shapes' }, isError: true }
      }
      const source = await resolveWorkspacePath(sourceArg, context, { enforceWorkspaceBoundary: true })
      const requestedName = stringArg(args.name) || basename(source.relativePath)
      if (
        basename(requestedName) !== requestedName ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedName) ||
        !/\.(?:png|jpe?g|webp)$/i.test(requestedName) ||
        extname(requestedName).toLowerCase() !== extname(source.relativePath).toLowerCase()
      ) {
        return { output: { error: 'name must be a safe ASCII PNG, JPEG, or WebP file name with the source extension' }, isError: true }
      }
      if (generated && generatedAssetCount(await readPptAssetLedger(deck.physicalProjectDir)) >= PPT_GENERATED_ASSET_LIMIT) {
        return {
          output: { error: `this deck already uses ${PPT_GENERATED_ASSET_LIMIT} generated images; reuse one, use the user's material, or compose the slot from native shapes` },
          isError: true
        }
      }
      const sourceScope = generated
        ? (await resolveWorkspacePath('.kun/images', context, { enforceWorkspaceBoundary: true })).absolutePath
        : source.workspaceRoot
      const inspectSource = () => assertPptScopedExistingPath({
        workspaceRoot: source.workspaceRoot, scopeRoot: sourceScope, targetPath: source.absolutePath,
        label: 'PPT image source', expected: 'file'
      })
      if (!(await inspectSource()).bytes) return { output: { error: 'source must be a non-empty image file' }, isError: true }
      const mediaDirectory = join(deck.physicalProjectDir, 'media')
      const destination = join(mediaDirectory, requestedName)
      assertCanWritePath(join(deck.projectDir, 'media', requestedName), context)
      const inspectDestination = () => assertPptScopedMutationPath({
        workspaceRoot: deck.physicalWorkspaceRoot, scopeRoot: mediaDirectory, targetPath: destination,
        label: 'PPT media file', expected: 'file'
      })
      await inspectDestination()
      return withFileMutationQueue(destination, async () => {
        const currentSource = await inspectSource()
        await mkdir(mediaDirectory, { recursive: true })
        const currentDestination = await inspectDestination()
        await copyFile(currentSource.physicalPath, currentDestination.physicalPath, fsConstants.COPYFILE_EXCL)
        const copied = await assertPptScopedExistingPath({
          workspaceRoot: deck.physicalWorkspaceRoot, scopeRoot: mediaDirectory, targetPath: destination,
          label: 'PPT media file', expected: 'file'
        })
        const origin = generated ? 'generated' as const : 'user' as const
        await recordPptAsset(deck.physicalProjectDir, `media/${requestedName}`, { origin, source: source.relativePath })
        return {
          output: {
            source: source.relativePath,
            importedPath: portableRelative(copied.physicalWorkspaceRoot, copied.physicalPath),
            pptdSrc: `media/${requestedName}`,
            origin,
            bytes: copied.bytes
          }
        }
      })
    })
  })
}
