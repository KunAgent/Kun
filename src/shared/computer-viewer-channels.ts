/** Kept separate so the sandboxed viewer preload never requires a shared CommonJS chunk. */
export const COMPUTER_VIEWER_CHANNELS = {
  configuration: 'computer-viewer:configuration', invoke: 'computer-viewer:invoke', ice: 'computer-viewer:ice',
  event: 'computer-viewer:event', heartbeat: 'computer-viewer:heartbeat', close: 'computer-viewer:close',
  fullscreen: 'computer-viewer:fullscreen', restart: 'computer-viewer:restart', ready: 'computer-viewer:ready'
} as const
