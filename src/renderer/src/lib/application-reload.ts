type ApplicationReloadTarget = {
  kunGui?: {
    runDesktopCommand?: (command: 'reload') => Promise<void>
  }
  location: {
    reload: () => void
  }
}

export function requestApplicationReload(target: ApplicationReloadTarget = window): void {
  const runDesktopCommand = target.kunGui?.runDesktopCommand
  if (typeof runDesktopCommand !== 'function') {
    target.location.reload()
    return
  }
  try {
    void runDesktopCommand('reload').catch(() => target.location.reload())
  } catch {
    target.location.reload()
  }
}
