/**
 * Direct DOM worlds can call HTMLElement.click(), but Chromium marks those
 * synthetic events untrusted. Protected actions must never be dispatched from
 * such an event. Main validates tool approval requests without a second dialog;
 * security-setting changes retain their separate native confirmation.
 */
export function runTrustedUserActivation(
  event: { isTrusted: boolean },
  action: () => void
): boolean {
  if (event.isTrusted !== true) return false
  action()
  return true
}
