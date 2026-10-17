const beforeWire = Symbol('kun-gmail-before-physical-wire')
type FencedInit = RequestInit & { [beforeWire]?: () => void }

/** Host-only callback: it is never serialized into headers, bodies, HTTP or IPC contracts. */
export function withGmailWireFence(init: RequestInit, assertCurrent?: () => void): RequestInit {
  return assertCurrent ? { ...init, [beforeWire]: assertCurrent } as FencedInit : init
}

export function assertGmailWireFence(init?: RequestInit): void {
  (init as FencedInit | undefined)?.[beforeWire]?.()
}
