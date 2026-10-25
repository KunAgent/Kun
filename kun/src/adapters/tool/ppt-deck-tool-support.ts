import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { resolvePptdManifest } from '../../ppt/pptd-deck.js'
import { PPT_DECK_REVIEW_DIR } from '../../ppt/ppt-deck-preview.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { assertPptScopedExistingPath, assertPptScopedMutationPath } from './ppt-physical-path.js'
import type { PptToolchainOptions } from './ppt-pptx-validation.js'
import { assertCanWritePath } from './sandbox-policy.js'

export type PptImageAssetAvailability = { enabled: boolean; available: boolean; reason?: string }

export type PptDeckToolOptions = PptToolchainOptions & {
  /** Whether image slots may be filled with generated images right now. */
  imageAssets?: () => PptImageAssetAvailability
}

/** A deck folder inside the workspace, proven free of links that leave it. */
export type PptDeckLocation = {
  /** Absolute deck folder as the workspace spells it; sandbox write checks use this form. */
  projectDir: string
  physicalWorkspaceRoot: string
  physicalProjectDir: string
  /** Workspace-relative folder, `/`-separated ("." for the workspace root). */
  projectRelative: string
  /** Absolute physical path of the deck's single .pptd manifest, when it exists. */
  manifestPath?: string
}

export function portableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

export function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function pptImageAssetState(options: PptDeckToolOptions): 'enabled' | 'disabled' | 'unavailable' {
  const state = options.imageAssets?.()
  if (!state || state.enabled === false) return state ? 'disabled' : 'unavailable'
  return state.available ? 'enabled' : 'unavailable'
}

/**
 * Resolve `deck` (a .pptd file or its folder) to a deck folder. With
 * `create`, a missing folder is created (direction comparisons start before
 * the main deck exists); with `requireManifest`, the folder must hold exactly
 * one .pptd, matching how the exporter finds it.
 */
export async function resolvePptDeck(
  deckArg: string,
  context: ToolHostContext,
  options: { requireManifest: boolean; create?: boolean }
): Promise<PptDeckLocation> {
  if (!deckArg) throw new Error('deck is required: a workspace-relative .pptd file or deck folder')
  const target = await resolveWorkspacePath(deckArg, context, { enforceWorkspaceBoundary: true })
  const isManifest = target.absolutePath.toLowerCase().endsWith('.pptd')
  const projectDir = isManifest ? dirname(target.absolutePath) : target.absolutePath
  if (options.create) {
    assertCanWritePath(projectDir, context)
    await assertPptScopedMutationPath({
      workspaceRoot: target.workspaceRoot,
      scopeRoot: projectDir,
      targetPath: projectDir,
      label: 'PPT deck folder',
      expected: 'directory'
    })
    await mkdir(projectDir, { recursive: true })
  }
  const project = await assertPptScopedExistingPath({
    workspaceRoot: target.workspaceRoot,
    scopeRoot: projectDir,
    targetPath: projectDir,
    label: 'PPT deck folder',
    expected: 'directory',
    recursive: true
  })
  let manifestPath: string | undefined
  if (isManifest) {
    manifestPath = (await assertPptScopedExistingPath({
      workspaceRoot: target.workspaceRoot,
      scopeRoot: projectDir,
      targetPath: target.absolutePath,
      label: 'PPT deck manifest',
      expected: 'file'
    })).physicalPath
  } else if (options.requireManifest) {
    manifestPath = await resolvePptdManifest(project.physicalPath)
  }
  return {
    projectDir,
    physicalWorkspaceRoot: project.physicalWorkspaceRoot,
    physicalProjectDir: project.physicalPath,
    projectRelative: portableRelative(project.physicalWorkspaceRoot, project.physicalPath) || '.',
    ...(manifestPath ? { manifestPath } : {})
  }
}

/** Write one preview SVG inside the deck's review folder after a link-safety check. */
export async function writePptReviewFile(deck: PptDeckLocation, relativePath: string, content: string): Promise<string> {
  const reviewRoot = join(deck.physicalProjectDir, PPT_DECK_REVIEW_DIR)
  const target = resolve(reviewRoot, relativePath)
  const proof = await assertPptScopedMutationPath({
    workspaceRoot: deck.physicalWorkspaceRoot,
    scopeRoot: reviewRoot,
    targetPath: target,
    label: 'PPT preview file',
    expected: 'file'
  })
  await mkdir(resolve(proof.physicalPath, '..'), { recursive: true })
  await writeFile(proof.physicalPath, content, 'utf8')
  return portableRelative(deck.physicalWorkspaceRoot, proof.physicalPath)
}
