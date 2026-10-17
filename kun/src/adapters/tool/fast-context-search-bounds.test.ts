import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fastContextRipgrepWalkArgs,
  fastContextScopeHint,
  fastContextSearchBounds,
  isFastContextDiscoveryExcluded,
  isFastContextExcludedPath
} from './fast-context-search-bounds.js'

describe('Fast Context search bounds', () => {
  const bounds = fastContextSearchBounds({ fastContext: true }, { excludedDirectoryNames: ['Generated'] })!

  it('applies only to Fast Context dispatches', () => {
    expect(fastContextSearchBounds({})).toBeNull()
    expect(bounds.maxMatches).toBe(30)
  })

  it('prunes directories with original-case globs, skips binaries, caps file size, and honours .kunignore', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fast-context-walk-'))
    try {
      const withoutIgnore = fastContextRipgrepWalkArgs(bounds, workspace)
      expect(withoutIgnore).toEqual(expect.arrayContaining([
        '--no-config', '--hidden', '--max-filesize', '1M', '!node_modules/', '!DerivedData/', '!Pods/', '!.claude/', '!Generated/'
      ]))
      expect(withoutIgnore.some((arg) => arg.includes('png'))).toBe(true)
      expect(withoutIgnore).not.toContain('--ignore-file')
      await writeFile(join(workspace, '.kunignore'), 'fixtures/\n')
      expect(fastContextRipgrepWalkArgs(bounds, workspace)).toEqual(
        expect.arrayContaining(['--ignore-file', join(workspace, '.kunignore')])
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps explicit discovery-only roots searchable while hard exclusions always apply', () => {
    expect(isFastContextExcludedPath('node_modules/pkg/index.js', bounds)).toBe(true)
    expect(isFastContextExcludedPath('.vscode/settings.json', bounds)).toBe(false)
    expect(isFastContextDiscoveryExcluded('.claude/skills/a.md', '.', bounds)).toBe(true)
    expect(isFastContextDiscoveryExcluded('.claude/skills/a.md', '.claude/skills', bounds)).toBe(false)
    expect(isFastContextDiscoveryExcluded('src/logs/a.ts', 'src', bounds)).toBe(true)
    expect(isFastContextDiscoveryExcluded('logs.ts', '.', bounds)).toBe(false)
    expect(isFastContextDiscoveryExcluded('src/node_modules/a.js', 'src/node_modules', bounds)).toBe(true)
  })

  it('builds actionable scope hints', () => {
    expect(fastContextScopeHint('large_workspace', '.', ['src/', 'kun/'])).toMatchObject({
      reason: 'large_workspace',
      searched: '.',
      directories: ['src/', 'kun/'],
      suggestion: expect.stringContaining('path')
    })
  })
})
