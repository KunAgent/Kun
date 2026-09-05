import { describe, expect, it } from 'vitest'
import { BUILTIN_SUBAGENT_PROFILES, mergeBuiltinSubagentProfiles } from '../src/delegation/builtin-profiles.js'
import { SubagentsCapabilityConfig } from '../src/contracts/capabilities.js'
import { WORKFLOW_SUBAGENT_PROFILE_IDS } from '../src/delegation/workflow-subagent-profiles.js'
import { BUILTIN_AGENT_CATALOG } from '../src/delegation/builtin-agent-catalog.js'

describe('mergeBuiltinSubagentProfiles', () => {
  it('deep-merges a thin GUI override onto a builtin, preserving its persona', () => {
    // The GUI persists a builtin override carrying only the edited fields (here
    // a tool policy + a deny-list); the builtin's systemPrompt/description
    // must survive (a shallow replace would wipe them).
    const config = SubagentsCapabilityConfig.parse({
      profiles: { general: { toolPolicy: 'inherit', blockedTools: ['bash'] } }
    })
    const general = mergeBuiltinSubagentProfiles(config).profiles.general!

    // User fields win.
    expect(general.toolPolicy).toBe('inherit')
    expect(general.blockedTools).toEqual(['bash'])
    // Builtin persona/description fall back instead of being clobbered.
    expect(general.systemPrompt).toContain('通用代理')
    expect(general.description).toBeTruthy()
    // An un-overridden builtin is untouched.
    expect(mergeBuiltinSubagentProfiles(config).profiles.explore!.systemPrompt).toContain('Fast Context')
  })

  it('keeps user-only profiles alongside every builtin', () => {
    const config = SubagentsCapabilityConfig.parse({
      profiles: { mine: { mode: 'subagent', toolPolicy: 'readOnly' } }
    })
    const merged = mergeBuiltinSubagentProfiles(config)
    expect(Object.keys(BUILTIN_SUBAGENT_PROFILES)).toHaveLength(46)
    expect(Object.keys(merged.profiles).sort()).toEqual([...Object.keys(BUILTIN_SUBAGENT_PROFILES), 'mine'].sort())
  })

  it('uses the canonical catalog for every runtime display and default policy field', () => {
    expect(BUILTIN_AGENT_CATALOG).toHaveLength(46)
    expect(new Set(BUILTIN_AGENT_CATALOG.map((entry) => entry.id)).size).toBe(46)
    expect(Object.keys(BUILTIN_SUBAGENT_PROFILES).sort()).toEqual(
      BUILTIN_AGENT_CATALOG.map((entry) => entry.id).sort()
    )
    for (const metadata of BUILTIN_AGENT_CATALOG) {
      expect(BUILTIN_SUBAGENT_PROFILES[metadata.id]).toMatchObject({
        name: metadata.name,
        description: metadata.description,
        color: metadata.color,
        toolPolicy: metadata.toolPolicy
      })
    }
  })

  it('installs the agent-skills specialists with scoped permissions and self-contained prompts', () => {
    const profiles = mergeBuiltinSubagentProfiles(SubagentsCapabilityConfig.parse({})).profiles

    expect(profiles['code-reviewer']).toMatchObject({
      toolPolicy: 'readOnly',
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill'],
      skillsEnabled: false,
      description: expect.stringContaining('correctness')
    })
    expect(profiles['security-auditor']).toMatchObject({
      toolPolicy: 'readOnly',
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill'],
      skillsEnabled: false,
      description: expect.stringContaining('OWASP')
    })
    expect(profiles['test-engineer']).toMatchObject({
      toolPolicy: 'inherit',
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill'],
      skillsEnabled: false
    })
    expect(profiles['web-performance-auditor']).toMatchObject({
      toolPolicy: 'readOnly',
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill'],
      skillsEnabled: false
    })
    for (const id of ['code-reviewer', 'security-auditor', 'test-engineer', 'web-performance-auditor']) {
      expect(profiles[id]?.systemPrompt).toBeTruthy()
      expect(profiles[id]?.systemPrompt).not.toContain('../')
      expect(profiles[id]?.systemPrompt).not.toContain('/ship')
    }
  })

  it('installs 24 standalone workflow agents with unique prompts and no skill-loading dependency', () => {
    expect(WORKFLOW_SUBAGENT_PROFILE_IDS).toHaveLength(24)
    expect(new Set(WORKFLOW_SUBAGENT_PROFILE_IDS).size).toBe(24)
    const prompts = WORKFLOW_SUBAGENT_PROFILE_IDS.map((id) => BUILTIN_SUBAGENT_PROFILES[id]?.systemPrompt ?? '')
    expect(new Set(prompts).size).toBe(24)
    for (const id of WORKFLOW_SUBAGENT_PROFILE_IDS) {
      const profile = BUILTIN_SUBAGENT_PROFILES[id]
      expect(profile?.description).toBeTruthy()
      expect(profile?.systemPrompt?.length).toBeGreaterThan(300)
      expect(profile?.skillsEnabled).toBe(false)
      expect(profile?.blockedTools).toEqual(expect.arrayContaining(['delegate_task', 'generate_subagent', 'load_skill']))
      expect(profile?.systemPrompt).not.toMatch(/SKILL\.md|skill_id|load_skill|\.\.\//i)
    }
  })

  it('keeps every fixed builtin standalone, skill-free, and unable to recurse', () => {
    expect(Object.keys(BUILTIN_SUBAGENT_PROFILES)).toHaveLength(46)
    for (const [id, profile] of Object.entries(BUILTIN_SUBAGENT_PROFILES)) {
      expect(profile.systemPrompt, `${id} systemPrompt`).toBeTruthy()
      expect(profile.skillsEnabled, `${id} skillsEnabled`).toBe(false)
      expect(profile.blockedTools, `${id} blockedTools`).toEqual(
        expect.arrayContaining(['delegate_task', 'generate_subagent', 'load_skill'])
      )
    }
  })

  it('gives web-facing research agents an exact non-mutating tool allow-list', () => {
    for (const id of ['browser-testing-with-devtools', 'source-driven-development']) {
      expect(BUILTIN_SUBAGENT_PROFILES[id]).toMatchObject({
        toolPolicy: 'readOnly',
        allowedTools: ['read', 'grep', 'glob', 'ls', 'repo_map', 'web_fetch', 'web_search']
      })
      expect(BUILTIN_SUBAGENT_PROFILES[id]?.allowedTools).not.toEqual(
        expect.arrayContaining(['write', 'edit', 'bash', 'background_shell', 'mcp_call'])
      )
    }
    expect(BUILTIN_SUBAGENT_PROFILES['browser-testing-with-devtools']?.description).toContain('QA planner')
    expect(BUILTIN_SUBAGENT_PROFILES['browser-testing-with-devtools']?.systemPrompt).toContain(
      'no live browser automation or DevTools control'
    )
  })
})
