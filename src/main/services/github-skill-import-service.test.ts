import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importGithubSkillsToRoot } from './github-skill-import-service'

describe('importGithubSkillsToRoot', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'github-skill-import-'))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('downloads a GitHub skill through the main process and writes a modern skill package', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value === 'https://api.github.com/repos/acme/skills/contents/review/SKILL.md?ref=main') {
        return jsonResponse({
          type: 'file',
          name: 'SKILL.md',
          path: 'review/SKILL.md',
          download_url: 'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md'
        })
      }
      if (value === 'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md') {
        return textResponse([
          '---',
          'name: Review',
          'description: Review code changes.',
          'tools: [read, grep]',
          '---',
          '',
          '# Review',
          '',
          'Look for regressions.'
        ].join('\n'))
      }
      return textResponse(`unmocked url: ${value}`, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await importGithubSkillsToRoot({
      rootPath: tempRoot,
      url: 'https://github.com/acme/skills/blob/main/review/SKILL.md'
    })

    expect(result).toMatchObject({
      ok: true,
      count: 1,
      names: ['Review']
    })
    await expect(readFile(join(tempRoot, 'review', 'SKILL.md'), 'utf8'))
      .resolves
      .toBe('# Review\n\nLook for regressions.')
    await expect(readFile(join(tempRoot, 'review', 'skill.json'), 'utf8'))
      .resolves
      .toContain('"allowedTools": [\n    "read",\n    "grep"\n  ]')
  })
})

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}
