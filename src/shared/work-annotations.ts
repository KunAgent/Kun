import type { WorkAnnotationAnchor } from './work-annotation-anchor'

export type WorkAnnotationDocument = { workspaceRoot: string; filePath: string }

export type WorkAnnotationSuggestion = {
  kind: 'replace' | 'insertAfter'
  text: string
  anchor: WorkAnnotationAnchor
  applied?: boolean
}

export type WorkAnnotationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  status?: 'pending' | 'failed'
  error?: string
  suggestion?: WorkAnnotationSuggestion
  /** Frozen on explicit send, including the admission key for reconnect. */
  request?: {
    id: string
    anchor: WorkAnnotationAnchor
    /** Serialized excerpt plus bounded discussion at first admission. */
    source?: string
    route?: { model: string; providerId: string; accountId?: string }
    turnId?: string
    terminal?: boolean
  }
}

export type WorkAnnotation = WorkAnnotationDocument & {
  id: string
  anchor: WorkAnnotationAnchor
  resolved: boolean
  messages: WorkAnnotationMessage[]
  createdAt: string
  updatedAt: string
  threadId?: string
}
