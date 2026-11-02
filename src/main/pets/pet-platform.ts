export type PetInteractionMode = 'passthrough' | 'bounded'

export type PetPlatformPolicy = {
  mode: PetInteractionMode
  note: string | null
  callMacWorkspaceApi: boolean
  skipTaskbar: true
  showInactive: true
}

const LINUX_BOUNDED_NOTE = 'This session cannot pass clicks through the pet. Kun is using a bounded window: drag the pet, use its buttons, and close it from the window or Settings.'

export function petPlatformPolicy(input: { platform: NodeJS.Platform; forwardMouseEvents: boolean }): PetPlatformPolicy {
  const bounded = input.platform === 'linux' && !input.forwardMouseEvents
  return {
    mode: bounded ? 'bounded' : 'passthrough',
    note: bounded ? LINUX_BOUNDED_NOTE : null,
    callMacWorkspaceApi: input.platform === 'darwin',
    skipTaskbar: true,
    showInactive: true
  }
}

export function applyPetPlatformPolicy(window: {
  setSkipTaskbar: (skip: boolean) => void
  setAlwaysOnTop: (flag: boolean, level?: string) => void
  setVisibleOnAllWorkspaces?: (visible: boolean, options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }) => void
}, platform: NodeJS.Platform): void {
  window.setSkipTaskbar(true)
  window.setAlwaysOnTop(true, 'floating')
  if (platform === 'darwin') {
    window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }
}
