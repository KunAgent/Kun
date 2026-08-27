import { ZodError } from 'zod'

/**
 * Carries diagnostics for a failed batch thread-state load. The batch route
 * (`getThreadStates`) maps this to a fine-grained error code and structured
 * log fields; the response message itself stays generic.
 */
export class ThreadStateLoadError extends Error {
  readonly stage:
    | 'owner_forward'
    | 'owner_response'
    | 'schema_parse'
    | 'metadata'
    | 'session_store'
  readonly httpStatus?: number
  readonly code:
    | 'owner_unreachable'
    | 'owner_error'
    | 'schema_incompatible'
    | 'storage_error'

  constructor(
    code: ThreadStateLoadError['code'],
    stage: ThreadStateLoadError['stage'],
    options?: { httpStatus?: number; cause?: unknown }
  ) {
    super(`thread state load failed (${stage})`, { cause: options?.cause })
    this.name = 'ThreadStateLoadError'
    this.code = code
    this.stage = stage
    if (options?.httpStatus !== undefined) this.httpStatus = options.httpStatus
  }
}

/** Classify an arbitrary load failure for the batch states route. */
export function threadStateLoadFailure(error: unknown): {
  code: 'unavailable' | ThreadStateLoadError['code']
  stage?: ThreadStateLoadError['stage']
  httpStatus?: number
  errorName: string
} {
  if (error instanceof ThreadStateLoadError) {
    return {
      code: error.code,
      stage: error.stage,
      httpStatus: error.httpStatus,
      errorName: error.name
    }
  }
  if (error instanceof ZodError) {
    return { code: 'schema_incompatible', errorName: error.name }
  }
  return {
    code: 'unavailable',
    errorName: error instanceof Error ? error.name : typeof error
  }
}
