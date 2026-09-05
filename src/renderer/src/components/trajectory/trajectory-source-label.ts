const SOURCE_KEYS: Record<string, string> = {
  user: 'trajectorySourceUser',
  user_message: 'trajectorySourceUser',
  model_context: 'trajectorySourceModelContext',
  runtime_context: 'trajectorySourceRuntimeContext',
  runtime_context_source: 'trajectorySourceRuntimeContext',
  background_shell: 'trajectorySourceBackgroundShell',
  background_subagent: 'trajectorySourceBackgroundSubagent',
  graph_runtime: 'trajectorySourceGraphRuntime',
  subagent_resume: 'trajectorySourceSubagentResume',
  design_continuation: 'trajectorySourceDesignContinuation'
}

export function trajectorySourceTypeLabel(
  sourceType: string | undefined,
  t: (key: string) => string,
  fallback: string
): string {
  if (!sourceType) return fallback
  const key = SOURCE_KEYS[sourceType]
  return key ? t(key) : fallback
}
