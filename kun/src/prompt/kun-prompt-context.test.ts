import { describe, expect, it } from 'vitest'
import {
  buildAdditionalWorkspacesInstruction,
  buildKunTurnContextInstructions,
  buildPersonaBlockContent
} from './kun-prompt-context.js'
import { projectTurnDynamicContext } from './turn-persona-context.js'

describe('buildPersonaBlockContent', () => {
  it('states that the persona governs style but not capability', () => {
    const content = buildPersonaBlockContent('Be skeptical.')
    expect(content).toContain('Be skeptical.')
    expect(content).toContain('does not change which tools exist')
  })

  it('trims the persona body', () => {
    expect(buildPersonaBlockContent('  Be terse.  ')).toContain('\nBe terse.')
  })
})

describe('persona rendered as a turn context block', () => {
  it('renders with user authority and a persona kind', () => {
    const instructions = buildKunTurnContextInstructions([
      { kind: 'persona', authority: 'user', content: buildPersonaBlockContent('Be skeptical.') }
    ])
    const rendered = instructions.join('\n')
    expect(rendered).toContain('<kun_context_block kind="persona" authority="user">')
    expect(rendered).toContain('Be skeptical.')
  })

  it('emits nothing for blank content, so an unset persona costs no tokens', () => {
    expect(buildKunTurnContextInstructions([
      { kind: 'persona', authority: 'user', content: '   ' }
    ])).toEqual([])
  })

  it('projects only this turn persona and private host control out of history', () => {
    const projected = projectTurnDynamicContext({
      turnId: 'turn-2',
      persona: '  Be skeptical.  ',
      items: [
        runtimeSource('turn-1', 'old host control'),
        runtimeSource('turn-2', 'current host control')
      ]
    })
    const rendered = projected.instructions.join('\n')
    expect(rendered).toContain('<kun_context_block kind="persona" authority="user">')
    expect(rendered).toContain('\nBe skeptical.\n')
    expect(rendered).toContain('<kun_context_block kind="host-control" authority="runtime">')
    expect(rendered).toContain('current host control')
    expect(rendered).not.toContain('old host control')
    expect(projected.privateValues).toEqual(['current host control'])
    expect(projected.historyItems).toEqual([])
  })
})

function runtimeSource(turnId: string, content: string) {
  return {
    id: `item-${turnId}`,
    threadId: 'thread',
    turnId,
    role: 'system' as const,
    status: 'completed' as const,
    createdAt: '2026-08-13T00:00:00.000Z',
    kind: 'runtime_context_source' as const,
    contextKind: 'host-control' as const,
    content
  }
}

describe('buildAdditionalWorkspacesInstruction', () => {
  it('requires absolute paths and keeps git/plan/shell on the primary root', () => {
    const instruction = buildAdditionalWorkspacesInstruction([' /tmp/backend/ ', '/tmp/backend'])
    expect(instruction).toContain('"/tmp/backend"')
    expect(instruction).toContain('absolute paths')
    expect(instruction).toContain('git_inspect')
    expect(instruction).toContain('plan worktrees')
    expect(instruction).toContain('.kun/project.json')
  })

  it('omits an empty extra-root list so the stable prefix stays unchanged', () => {
    expect(buildAdditionalWorkspacesInstruction(undefined)).toBeNull()
    expect(buildAdditionalWorkspacesInstruction([])).toBeNull()
    expect(buildAdditionalWorkspacesInstruction(['  '])).toBeNull()
  })
})
