export type VideoEngineErrorCode =
  | 'invalid_project'
  | 'unsupported_schema_version'
  | 'invalid_operation'
  | 'revision_conflict'
  | 'project_not_found'
  | 'project_exists'
  | 'history_unavailable'
  | 'agent_undo_fenced'
  | 'recovery_required'
  | 'media_relink_required'
  | 'path_escape'
  | 'script_stale'
  | 'script_invalid'
  | 'transcript_invalid'
  | 'transcriber_unavailable'
  | 'render_unsupported'

export class VideoEngineError extends Error {
  readonly code: VideoEngineErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: VideoEngineErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message)
    this.name = 'VideoEngineError'
    this.code = code
    this.details = details
  }
}

export function engineError(
  code: VideoEngineErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {}
): VideoEngineError {
  return new VideoEngineError(code, message, details)
}
