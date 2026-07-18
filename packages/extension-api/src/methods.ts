/**
 * Stable, fail-closed broker methods that a sandboxed extension View may ask
 * its Host transport to invoke. Registration, secret reveal, and account
 * mutation methods are intentionally absent.
 */
export const EXTENSION_VIEW_SAFE_METHODS = [
  'ui.getTheme',
  'ui.getLocale',
  'ui.getViewState',
  'ui.setViewState',
  'ui.postMessage',
  'ui.showNotification',
  'ui.attachComposerContext',
  'commands.execute',
  'network.fetch',
  'agent.createRun',
  'agent.getRun',
  'agent.subscribe',
  'agent.unsubscribe',
  'agent.steer',
  'agent.cancel',
  'threads.listOwn',
  'threads.getOwn',
  'authentication.listAccounts',
  'modelProviders.getStatus',
  'storage.get',
  'storage.set',
  'storage.delete',
  'storage.keys',
  'workspace.readFile',
  'workspace.writeFile',
  'workspace.stat',
  'workspace.list',
  'media.pickFiles',
  'media.pickSaveTarget',
  'media.createCacheTarget',
  'media.stat',
  'media.readText',
  'media.release',
  'media.openViewResource',
  'media.performArtifactAction',
  'media.getCapabilities',
  'media.getAudioAnalysisCapabilities',
  'media.getVisualModelStatus',
  'media.installVisualModel',
  'media.analyzeVisualFrames',
  'media.embedVisualQuery',
  'media.probe',
  'media.startFfmpegJob',
  'media.startAudioAnalysisJob',
  'media.startArchiveJob',
  'jobs.get',
  'jobs.list',
  'jobs.subscribe',
  'jobs.unsubscribe',
  'jobs.cancel'
] as const

export type ExtensionViewSafeMethod = (typeof EXTENSION_VIEW_SAFE_METHODS)[number]

const extensionViewSafeMethodSet: ReadonlySet<string> = new Set(EXTENSION_VIEW_SAFE_METHODS)

export function isExtensionViewSafeMethod(method: string): method is ExtensionViewSafeMethod {
  return extensionViewSafeMethodSet.has(method)
}
