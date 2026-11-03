const version = (value: unknown) => typeof value === 'string' && /^[0-9][0-9A-Za-z.+_-]{0,95}$/.test(value) ? value : undefined
/** The composition root supplies only display metadata, never a settings snapshot. */
export function appendHostMetadata(catalog: Record<string, any>, host: { deviceId?: string; appVersion?: string; platform: string }, now = Date.now()) {
  const previous = catalog.host && typeof catalog.host === 'object' ? catalog.host : {}
  return { ...catalog, host: {
    ...(version(previous.runtimeVersion) ? { runtimeVersion: previous.runtimeVersion } : {}),
    ...(Number.isSafeInteger(previous.protocolVersion) && previous.protocolVersion >= 1 && previous.protocolVersion <= 1000 ? { protocolVersion: previous.protocolVersion } : {}),
    ...(['stable', 'frontier'].includes(previous.releaseChannel) ? { releaseChannel: previous.releaseChannel } : {}),
    ...(version(host.appVersion) ? { appVersion: host.appVersion } : {}),
    ...(host.deviceId && /^[A-Za-z0-9_-]{1,128}$/.test(host.deviceId) ? { deviceId: host.deviceId } : {}),
    ...(['macos', 'windows', 'linux'].includes(host.platform) ? { platform: host.platform } : {}),
    confirmedAt: now
  } }
}
