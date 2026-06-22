import { describe, expect, it } from 'vitest'
import {
  buildKunSkill,
  importSkillsFromGitHub,
  mapAllowedTools,
  parseGitHubSkillUrl,
  parseSkillFrontmatter,
  type ParsedSkillFrontmatter
} from './github-skill-import'

describe('parseGitHubSkillUrl', () => {
  it('accepts repository, tree, and blob URLs', () => {
    expect(parseGitHubSkillUrl('https://github.com/acme/skills')).toEqual({
      owner: 'acme',
      repo: 'skills',
      mode: 'repo',
      path: ''
    })
    expect(parseGitHubSkillUrl('github.com/acme/skills/tree/main/review')).toEqual({
      owner: 'acme',
      repo: 'skills',
      mode: 'tree',
      branch: 'main',
      path: 'review',
      rawRefPath: 'main/review'
    })
    expect(parseGitHubSkillUrl('https://github.com/acme/skills/blob/main/review/SKILL.md')).toEqual({
      owner: 'acme',
      repo: 'skills',
      mode: 'blob',
      branch: 'main',
      path: 'review/SKILL.md',
      rawRefPath: 'main/review/SKILL.md'
    })
  })

  it('rejects unsupported hosts and malformed paths', () => {
    expect(parseGitHubSkillUrl('https://example.com/acme/skills')).toBeNull()
    expect(parseGitHubSkillUrl('https://github.com/acme')).toBeNull()
    expect(parseGitHubSkillUrl('not a url')).toBeNull()
  })
})

describe('parseSkillFrontmatter', () => {
  it('parses string and array frontmatter fields', () => {
    const parsed = parseSkillFrontmatter([
      '---',
      'name: "Code Review"',
      'description: Catch regressions first.',
      'version: 1.2.3',
      'tools:',
      '  - read',
      '  - grep',
      '---',
      '',
      '# Review',
      '',
      'Check behavior.'
    ].join('\n'))

    expect(parsed.frontmatter).toEqual({
      name: 'Code Review',
      description: 'Catch regressions first.',
      version: '1.2.3',
      tools: ['read', 'grep']
    })
    expect(parsed.body).toBe('# Review\n\nCheck behavior.')
  })

  it('falls back to the original body when no frontmatter exists', () => {
    expect(parseSkillFrontmatter('# Demo\n\nHello')).toEqual({
      frontmatter: {},
      body: '# Demo\n\nHello'
    })
  })
})

describe('mapAllowedTools', () => {
  it('normalizes aliases into Kun tool names', () => {
    expect(mapAllowedTools(['ReadFile', 'grep', 'shell', 'unknown_tool'])).toEqual([
      'read',
      'grep',
      'bash',
      'unknowntool'
    ])
  })
})

describe('buildKunSkill', () => {
  it('builds a modern skill package and de-duplicates dir names', () => {
    const used = new Set<string>()
    const parsed: ParsedSkillFrontmatter = {
      frontmatter: {
        name: 'Bug Hunt',
        description: 'Trace and fix issues.',
        tools: ['read', 'shell']
      },
      body: '# Bug Hunt\n\nReproduce first.'
    }

    const first = buildKunSkill(parsed, { defaultName: 'Bug Hunt', usedDirNames: used })
    const second = buildKunSkill(parsed, { defaultName: 'Bug Hunt', usedDirNames: used })

    expect(first.manifest).toMatchObject({
      id: 'bug-hunt',
      name: 'Bug Hunt',
      description: 'Trace and fix issues.',
      version: '0.0.0',
      entry: 'SKILL.md',
      allowedTools: ['read', 'bash']
    })
    expect(first.dirName).toBe('bug-hunt')
    expect(second.dirName).toBe('bug-hunt-2')
  })
})

describe('importSkillsFromGitHub', () => {
  it('imports a single markdown file from a blob URL', async () => {
    const fetcher = createMockFetcher({
      'https://api.github.com/repos/acme/skills/contents/review/SKILL.md?ref=main': jsonResponse({
        type: 'file',
        name: 'SKILL.md',
        path: 'review/SKILL.md',
        download_url: 'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md'
      }),
      'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md': textResponse([
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
    })

    const imported = await importSkillsFromGitHub('https://github.com/acme/skills/blob/main/review/SKILL.md', fetcher)

    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      dirName: 'review',
      sourcePath: 'review/SKILL.md',
      manifest: expect.objectContaining({
        id: 'review',
        name: 'Review',
        allowedTools: ['read', 'grep']
      })
    })
  })

  it('imports every markdown file directly under a directory', async () => {
    const fetcher = createMockFetcher({
      'https://api.github.com/repos/acme/skills/contents/packs?ref=main': jsonResponse([
        {
          type: 'file',
          name: 'review.md',
          path: 'packs/review.md',
          download_url: 'https://raw.githubusercontent.com/acme/skills/main/packs/review.md'
        },
        {
          type: 'file',
          name: 'debug.md',
          path: 'packs/debug.md',
          download_url: 'https://raw.githubusercontent.com/acme/skills/main/packs/debug.md'
        },
        {
          type: 'file',
          name: 'README.txt',
          path: 'packs/README.txt',
          download_url: 'https://raw.githubusercontent.com/acme/skills/main/packs/README.txt'
        }
      ]),
      'https://raw.githubusercontent.com/acme/skills/main/packs/review.md': textResponse('---\nname: Review\n---\n\nReview it.'),
      'https://raw.githubusercontent.com/acme/skills/main/packs/debug.md': textResponse('---\nname: Debug\n---\n\nDebug it.')
    })

    const imported = await importSkillsFromGitHub('https://github.com/acme/skills/tree/main/packs', fetcher)

    expect(imported.map((item) => item.manifest.name)).toEqual(['Review', 'Debug'])
  })

  it('ignores a download_url pointing off raw.githubusercontent.com (SSRF guard)', async () => {
    const requested: string[] = []
    const routes: Record<string, Response> = {
      'https://api.github.com/repos/acme/skills/contents/review/SKILL.md?ref=main': jsonResponse({
        type: 'file',
        name: 'SKILL.md',
        path: 'review/SKILL.md',
        // Attacker-controlled host smuggled into the Contents API response.
        download_url: 'https://evil.example.com/acme/skills/main/review/SKILL.md'
      }),
      // The importer must fall back to the constructed raw.githubusercontent.com URL.
      'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md': textResponse('---\nname: Review\n---\n\nSafe body.')
    }
    const fetcher = async (url: string) => {
      requested.push(url)
      const hit = routes[url]
      if (hit) return hit.clone()
      return new Response(`unmocked url: ${url}`, { status: 404 })
    }

    const imported = await importSkillsFromGitHub('https://github.com/acme/skills/blob/main/review/SKILL.md', fetcher)

    expect(imported[0]?.manifest.name).toBe('Review')
    // Never fetched the attacker host; used our own raw URL instead.
    expect(requested).not.toContain('https://evil.example.com/acme/skills/main/review/SKILL.md')
    expect(requested).toContain('https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md')
  })

  it('rejects a non-https download_url and falls back to the raw URL', async () => {
    const requested: string[] = []
    const routes: Record<string, Response> = {
      'https://api.github.com/repos/acme/skills/contents/review/SKILL.md?ref=main': jsonResponse({
        type: 'file',
        name: 'SKILL.md',
        path: 'review/SKILL.md',
        download_url: 'http://raw.githubusercontent.com/acme/skills/main/review/SKILL.md'
      }),
      'https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md': textResponse('---\nname: Review\n---\n\nSafe body.')
    }
    const fetcher = async (url: string) => {
      requested.push(url)
      const hit = routes[url]
      if (hit) return hit.clone()
      return new Response(`unmocked url: ${url}`, { status: 404 })
    }

    const imported = await importSkillsFromGitHub('https://github.com/acme/skills/blob/main/review/SKILL.md', fetcher)

    expect(imported[0]?.manifest.name).toBe('Review')
    expect(requested).not.toContain('http://raw.githubusercontent.com/acme/skills/main/review/SKILL.md')
    expect(requested).toContain('https://raw.githubusercontent.com/acme/skills/main/review/SKILL.md')
  })

  it('falls back from a missing branch to main and then master', async () => {
    const fetcher = createMockFetcher({
      'https://api.github.com/repos/acme/skills/contents/review.md?ref=feature': textResponse('missing', 404),
      'https://api.github.com/repos/acme/skills/contents/review.md?ref=main': jsonResponse({
        type: 'file',
        name: 'review.md',
        path: 'review.md',
        download_url: 'https://raw.githubusercontent.com/acme/skills/main/review.md'
      }),
      'https://raw.githubusercontent.com/acme/skills/main/review.md': textResponse('---\nname: Review\n---\n\nBody.')
    })

    const imported = await importSkillsFromGitHub('https://github.com/acme/skills/blob/feature/review.md', fetcher)

    expect(imported[0]?.manifest.name).toBe('Review')
  })
})

function createMockFetcher(routes: Record<string, Response>) {
  return async (url: string) => {
    const hit = routes[url]
    if (hit) return hit.clone()
    return new Response(`unmocked url: ${url}`, { status: 404 })
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}
