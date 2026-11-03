import { embeddedArtifactOf, type CanvasDocument, type CanvasSection } from './canvas/canvas-types'
import type { DesignArtifact } from './design-types'

let agentSectionCounter = 0
function createAgentSectionId(): string {
  return `sec_${Date.now().toString(36)}_a${(++agentSectionCounter).toString(36)}`
}

function titleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/**
 * Puts newly added boards into the canvas section named by their artifact's
 * `boardSection` (an agent's design_open `section`), creating the section on
 * first use. Only frames added by this sync are touched, so a section the user
 * removed or a board they moved out stays that way.
 */
export function assignAgentBoardSections(
  doc: CanvasDocument,
  addedFrameIds: readonly string[],
  artifacts: readonly DesignArtifact[]
): CanvasDocument {
  const labels = new Map<string, string>()
  for (const artifact of artifacts) {
    const label = artifact.boardSection?.trim()
    if (label) labels.set(artifact.id, label)
  }
  if (labels.size === 0 || addedFrameIds.length === 0) return doc

  let sections: CanvasSection[] | null = null
  const current = (): CanvasSection[] => (sections ??= (doc.sections ?? []).map((section) => ({ ...section })))
  for (const frameId of addedFrameIds) {
    const shape = doc.objects[frameId]
    const artifactId = shape ? embeddedArtifactOf(shape)?.id : undefined
    const label = artifactId ? labels.get(artifactId) : undefined
    if (!shape || !label || shape.parentId !== doc.rootId) continue
    const list = current()
    if (list.some((section) => section.memberIds.includes(frameId))) continue
    const section = list.find((candidate) => titleKey(candidate.title) === titleKey(label))
    if (section) {
      if (section.collapsed) continue
      section.memberIds = [...section.memberIds, frameId]
    } else {
      list.push({ id: createAgentSectionId(), title: label.slice(0, 120), memberIds: [frameId] })
    }
  }
  return sections ? { ...doc, sections } : doc
}
