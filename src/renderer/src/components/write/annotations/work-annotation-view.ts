import { create } from 'zustand'

export type WorkAnnotationMessageView = {
  id: string
  author: 'user' | 'kun'
  text: string
  suggestion?: { kind: 'replace' | 'insertAfter'; text: string; applied?: boolean }
}

export type WorkAnnotationView = {
  id: string
  quote: string
  resolved: boolean
  messages: WorkAnnotationMessageView[]
  detached?: boolean
  busy?: boolean
  error?: string
  retryable?: boolean
  canPreview?: boolean
}

export type WorkAnnotationLayerProps = {
  documentKey: string
  annotations: WorkAnnotationView[]
  activeId: string | null
  markerTops: Record<string, number>
  onOpen: (id: string) => void
  onClose: () => void
  onSubmit: (id: string, text: string, askKun: boolean) => Promise<void>
  onResolve: (id: string, resolved: boolean) => void
  onReattach: (id: string) => void
  onPreview?: (id: string, messageId: string) => void
  onRetry?: (id: string) => void
}

type ReviewBridge = Pick<WorkAnnotationLayerProps, 'annotations' | 'documentKey' | 'onOpen'> & {
  owner: symbol
}

// The Review panel lives outside the document view. Only the focused pane
// publishes here, and an unmount may only release its own projection.
export const useWorkAnnotationReview = create<{ current: ReviewBridge | null }>(() => ({ current: null }))

// English letters following @Kun can be part of a different handle or domain.
// Chinese text and punctuation can be adjacent to the mention.
const kunMention = /(?<![a-z0-9_@.-])@kun(?![a-z0-9_@-]|\.[a-z0-9])/i

export function annotationComposerIntent(value: string): { askKun: boolean; canSend: boolean } {
  const askKun = kunMention.test(value)
  const instruction = askKun ? value.replace(kunMention, '') : value
  return { askKun, canSend: Boolean(instruction.trim()) }
}
