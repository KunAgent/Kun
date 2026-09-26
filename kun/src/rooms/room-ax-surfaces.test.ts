import { describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { roomResultProvider } from './room-result-tools.js'
import { ROOM_AX_SURFACES, ROOM_AX_TOOL_DESCRIPTIONS, type RoomAxToolName } from './room-ax-surfaces.js'

describe('room agent-visible surface registry', () => {
  it('keeps surface ids unique and registers at least one example each', () => {
    const ids = ROOM_AX_SURFACES.map((surface) => surface.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const surface of ROOM_AX_SURFACES) {
      expect(surface.examples.length, surface.id).toBeGreaterThan(0)
      expect(surface.kind, surface.id).toMatch(/^(prompt|instructions|system-prompt|wake-input|guidance|playbook|tool-description)$/)
      expect(surface.description.trim().length, surface.id).toBeGreaterThan(0)
    }
  })

  // One case per example keeps snapshot keys stable when examples are reordered.
  for (const surface of ROOM_AX_SURFACES) {
    for (const example of surface.examples) {
      it(`renders ${surface.id} :: ${example.name}`, () => {
        expect(surface.render(example.input)).toMatchSnapshot()
      })
    }
  }

  it('registers every advertised room tool description exactly once', () => {
    const provider = roomResultProvider(new InMemoryThreadStore())
    const registered = new Set<string>(Object.keys(ROOM_AX_TOOL_DESCRIPTIONS))
    const advertised = new Set<string>()
    for (const tool of provider.tools) {
      expect(registered.has(tool.name), `unregistered tool ${tool.name}`).toBe(true)
      expect(tool.description, tool.name).toBe(ROOM_AX_TOOL_DESCRIPTIONS[tool.name as RoomAxToolName])
      expect(advertised.has(tool.name), `duplicate tool ${tool.name}`).toBe(false)
      advertised.add(tool.name)
    }
    for (const name of registered) expect(advertised.has(name), `registered but unadvertised ${name}`).toBe(true)
  })
})
