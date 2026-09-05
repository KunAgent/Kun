export type UserInputAnswer = {
  id: string
  label: string
  value: string
  labels?: string[]
  values?: string[]
}

export type UserInputOption = {
  label: string
  description: string
  recommended?: boolean
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
  selectionMode?: 'single' | 'multiple'
  minSelections?: number
  maxSelections?: number
}

export type UserInputRequest = {
  id: string
  threadId: string
  turnId: string
  itemId: string
  prompt: string
  questions: UserInputQuestion[]
  /** Optional wall-clock budget; when it elapses the gate self-resolves. */
  timeoutSeconds?: number
  /** Absolute deadline used to recover from timeout/claim races. */
  deadlineAtMs?: number
}

export type UserInputResolution =
  | { status: 'submitted'; answers: UserInputAnswer[] }
  | { status: 'cancelled'; answers?: UserInputAnswer[] }
  | { status: 'timeout'; answers?: UserInputAnswer[] }

export type UserInputResolveResult = 'settled' | 'claimed' | 'missing'

/**
 * Exclusive reservation used by the HTTP route to persist a resolution event
 * before settling the waiter. While reserved, cancellation cannot win between
 * event persistence and promise resolution.
 */
export type UserInputResolutionClaim = {
  request: UserInputRequest
  resolve(resolution: UserInputResolution): boolean
  release(): boolean
}

export interface UserInputGate {
  request(input: UserInputRequest): Promise<UserInputResolution>
  get(inputId: string): UserInputRequest | undefined
  claimResolution(inputId: string): UserInputResolutionClaim | undefined
  resolve(inputId: string, resolution: UserInputResolution): UserInputResolveResult
  pending(threadId?: string): UserInputRequest[]
  reset(): void
}
