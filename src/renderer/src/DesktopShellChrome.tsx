import { ExtensionWorkbenchLifecycle } from './extensions/ExtensionWorkbenchLifecycle'
import { MiniWindowOverlay } from './components/MiniWindowOverlay'
import { WindowsTitleBar } from './components/WindowsTitleBar'
import { useWindowMiniMode } from './lib/use-window-mini-mode'

export function DesktopShellChrome({ platform, titleBar }: {
  platform: string
  titleBar: boolean
}): React.ReactElement {
  const miniWindowMode = useWindowMiniMode()
  return <>
    {titleBar ? <WindowsTitleBar platform={platform} /> : null}
    {miniWindowMode ? <MiniWindowOverlay /> : null}
    <ExtensionWorkbenchLifecycle />
  </>
}
