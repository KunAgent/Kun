import type { ChatBlock } from '../../agent/types'
import {
  MAX_GENERATED_DOCUMENTS_PER_TURN,
  PRESENTATION_STUDIO_ARTIFACT_PRODUCER,
  deriveGeneratedDocumentArtifacts,
  generatedDocumentArtifactsForTurn,
  generatedDocumentKindForPath,
  type GeneratedDocumentArtifact
} from './generated-document-artifacts'

/** @deprecated Use GeneratedDocumentArtifact. */
export type PresentationArtifactKind = 'powerpoint' | 'kun-html'

/** @deprecated Use GeneratedDocumentArtifact. */
export type PresentationFileArtifact = Omit<GeneratedDocumentArtifact, 'kind'> & {
  kind: PresentationArtifactKind
}

/** @deprecated Use MAX_GENERATED_DOCUMENTS_PER_TURN. */
export const MAX_PRESENTATION_ARTIFACTS_PER_TURN = MAX_GENERATED_DOCUMENTS_PER_TURN

export { PRESENTATION_STUDIO_ARTIFACT_PRODUCER }

function asPresentation(file: GeneratedDocumentArtifact): PresentationFileArtifact | null {
  if (file.kind === 'presentation') return { ...file, kind: 'powerpoint' }
  if (file.kind === 'kun-html') return { ...file, kind: 'kun-html' }
  return null
}

/** @deprecated Use generatedDocumentKindForPath. */
export function presentationArtifactKindForPath(
  path: string
): { kind: PresentationArtifactKind; extension: string } | null {
  const resolved = generatedDocumentKindForPath(path)
  if (resolved?.kind === 'presentation') return { kind: 'powerpoint', extension: resolved.extension }
  if (resolved?.kind === 'kun-html') return { kind: 'kun-html', extension: resolved.extension }
  return null
}

/** @deprecated Use isGeneratedDocumentArtifactPath. */
export function isPresentationArtifactPath(path: string | undefined): boolean {
  return typeof path === 'string' && presentationArtifactKindForPath(path) !== null
}

/** @deprecated Use deriveGeneratedDocumentArtifacts. */
export function derivePresentationFileArtifacts(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  platform = ''
): PresentationFileArtifact[] {
  return deriveGeneratedDocumentArtifacts(blocks, workspaceRoot, platform)
    .map(asPresentation)
    .filter((file): file is PresentationFileArtifact => file !== null)
}

/** @deprecated Use generatedDocumentArtifactsForTurn. */
export function presentationFileArtifactsForTurn(
  blocks: readonly ChatBlock[],
  workspaceRoot: string,
  isProcessing: boolean,
  platform = ''
): PresentationFileArtifact[] {
  return generatedDocumentArtifactsForTurn(blocks, workspaceRoot, isProcessing, platform)
    .map(asPresentation)
    .filter((file): file is PresentationFileArtifact => file !== null)
}
