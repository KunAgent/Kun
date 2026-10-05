import semver from 'semver'
import type { NativeAgentNetworkPolicy } from '../contracts/native-agent-network.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { HARNESS_UPDATE_RECIPES } from './harness-update-recipes.js'

/** Metadata only: no CLI updater is ever invoked by a background check. */
export async function latestHarnessVersion(id: string, source: string, policy?: NativeAgentNetworkPolicy): Promise<string | undefined> {
  const recipe = HARNESS_UPDATE_RECIPES[id]
  if (!recipe) return undefined
  const cask = source === 'homebrew' || !recipe.packageName ? recipe.cask : undefined
  const url = cask ? `https://formulae.brew.sh/api/cask/${cask}.json`
    : recipe.packageName ? `https://registry.npmjs.org/${encodeURIComponent(recipe.packageName)}/${recipe.tag ?? 'latest'}` : undefined
  if (!url) return undefined
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy ||
    (policy?.source === 'system' ? policy.proxyUrl : undefined)
  if (!proxy && policy?.source === 'explicit-required') throw new Error('An explicit proxy is required to check Agent updates')
  const fetcher = proxy ? createProxyFetch(proxy) ?? fetch : fetch
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Update metadata request failed (${response.status})`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty update metadata')
  let text = '', size = 0
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 512 * 1024) throw new Error('Update metadata is too large')
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const value = JSON.parse(text + decoder.decode())
  if (cask ? value.token !== cask : value.name !== recipe.packageName) throw new Error('Update package identity mismatch')
  const version = typeof value.version === 'string' ? value.version.split(',')[0] : undefined
  if (!version || !semver.valid(version)) throw new Error('Update metadata contains an invalid version')
  return version
}
