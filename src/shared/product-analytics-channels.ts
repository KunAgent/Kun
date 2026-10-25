/** Dependency-free IPC names: safe to import from Electron's sandboxed preload. */
export const ANALYTICS_CHANNELS = {
  state: 'product-analytics:state', consent: 'product-analytics:consent',
  track: 'product-analytics:track', guidance: 'product-analytics:guidance'
} as const
