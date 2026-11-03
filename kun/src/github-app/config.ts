import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { GITHUB_CALLBACK } from '../contracts/github-app.js'

/** Publisher-owned native-client configuration. No app private key is ever accepted. */
export const GitHubAppConfigSchema = z.object({
  schemaVersion: z.literal(1), clientId: z.literal('Iv23li8xc41xacMCT6td'),
  clientSecret: z.string().min(20).max(256),
  slug: z.literal('kun-desktop'),
  callbackUrl: z.literal(GITHUB_CALLBACK)
}).strict()
export type GitHubAppConfig = z.infer<typeof GitHubAppConfigSchema>

export async function readGitHubAppConfig(
  resource = new URL('../resources/github-app-client.json', import.meta.url)
): Promise<GitHubAppConfig | undefined> {
  const file = await open(resource, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
    if (error.code === 'ENOENT') return undefined
    throw new Error('GitHub App package configuration is unavailable')
  })
  if (!file) return undefined
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 4096) throw new Error()
    const buffer = Buffer.alloc(4097)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 4096) throw new Error()
    return GitHubAppConfigSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')))
  } catch { throw new Error('GitHub App package configuration is invalid') }
  finally { await file.close() }
}
