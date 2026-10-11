export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export type ThreadTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type ThreadTodoItem = {
  id: string
  content: string
  status: ThreadTodoStatus
  taskStatus?: 'pending' | 'running' | 'waiting' | 'blocked' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
  taskRevision?: number
  ownerThreadId?: string
  reason?: string
  source?: ThreadTodoSource
  createdAt: string
  updatedAt: string
}

export type ThreadTodoList = {
  threadId: string
  revision?: number
  items: ThreadTodoItem[]
  updatedAt: string
}
