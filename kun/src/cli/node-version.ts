export const MINIMUM_NODE_VERSION = '22.19.0'

/** No Runtime or optional builtin imports: this module must also run on old Node. */
export function nodeVersionStartupError(version: string, executable: string): string | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version)
  if (match) {
    const [major, minor, patch] = match.slice(1, 4).map(Number)
    const [minimumMajor, minimumMinor, minimumPatch] = MINIMUM_NODE_VERSION.split('.').map(Number)
    if ([major, minor, patch].every(Number.isSafeInteger) && (
      major > minimumMajor || (major === minimumMajor && (
        minor > minimumMinor || (minor === minimumMinor && patch >= minimumPatch)
      ))
    )) return undefined
  }
  return `kun: Node.js >=${MINIMUM_NODE_VERSION} is required; detected ${version}.\n` +
    `Current executable: ${executable}\n` +
    'Upgrade Node.js and ensure a supported version is first in PATH.'
}
