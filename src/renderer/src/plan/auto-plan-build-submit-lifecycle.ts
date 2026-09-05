export type AutomaticSubmitLifecycleCallbacks = {
  onStarted: () => void
  onSubmitting?: () => void
  onRejected?: () => void
}

export async function runAutomaticSubmitLifecycle(
  pending: AutomaticSubmitLifecycleCallbacks,
  send: () => Promise<boolean>
): Promise<boolean> {
  pending.onSubmitting?.()
  let sent = false
  try {
    sent = await send()
  } catch (error) {
    pending.onRejected?.()
    throw error
  }
  if (sent) pending.onStarted()
  else pending.onRejected?.()
  return sent
}
