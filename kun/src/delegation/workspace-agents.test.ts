import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadWorkspaceAgentProfiles } from './workspace-agents.js'

const dirs: string[] = []

async function workspaceWith(markdown: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-workspace-agents-'))
  dirs.push(root)
  await mkdir(join(root, '.kun', 'agents'), { recursive: true })
  await writeFile(join(root, '.kun', 'agents', 'reviewer.md'), markdown)
  return root
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('loadWorkspaceAgentProfiles ADE bindings', () => {
  it('parses harness/credential-mode/delegation-notes/model frontmatter (10 §3.1)', async () => {
    const root = await workspaceWith([
      '---',
      'name: Claude Reviewer',
      'description: reviews diffs',
      'harness: claude-code',
      'credential-mode: native-login',
      'delegation-notes: best for security-sensitive reviews',
      'model: claude-sonnet-4-6',
      '---',
      'Review the patch carefully.'
    ].join('\n'))
    const [profile] = await loadWorkspaceAgentProfiles(root)
    expect(profile?.id).toBe('reviewer')
    expect(profile?.profile).toMatchObject({
      name: 'Claude Reviewer',
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      delegationNotes: 'best for security-sensitive reviews',
      model: 'claude-sonnet-4-6'
    })
  })

  it('keeps the file when harness fields are absent', async () => {
    const root = await workspaceWith([
      '---',
      'name: Plain Reviewer',
      '---',
      'Just review.'
    ].join('\n'))
    const [profile] = await loadWorkspaceAgentProfiles(root)
    expect(profile?.profile.harnessId).toBeUndefined()
    expect(profile?.profile.credentialMode).toBeUndefined()
    expect(profile?.profile.delegationNotes).toBeUndefined()
  })

  it('ignores a bare model pin that lacks a harness binding', async () => {
    const root = await workspaceWith([
      '---',
      'name: Broken',
      'model: claude-sonnet-4-6',
      '---',
      'No harness means the model pin is meaningless on the native loop.'
    ].join('\n'))
    const [profile] = await loadWorkspaceAgentProfiles(root)
    expect(profile?.profile.model).toBeUndefined()
    expect(profile?.profile.harnessId).toBeUndefined()
  })

  it('accepts camelCase aliases', async () => {
    const root = await workspaceWith([
      '---',
      'name: Aliased',
      'harnessId: codex',
      'credentialMode: native-login',
      'delegationNotes: migration runs',
      '---',
      'Migrate the schema.'
    ].join('\n'))
    const [profile] = await loadWorkspaceAgentProfiles(root)
    expect(profile?.profile).toMatchObject({
      harnessId: 'codex',
      credentialMode: 'native-login',
      delegationNotes: 'migration runs'
    })
  })
})
