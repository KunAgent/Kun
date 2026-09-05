import { describe, expect, it } from 'vitest'
import { buildComputerUseToolProviders } from './computer-use-tool-provider.js'
import type { HostController, HostScreenshot } from '../computer-use/host-control.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const SHOT: HostScreenshot = {
  mimeType: 'image/png',
  dataBase64: 'PNGDATA',
  width: 1280,
  height: 800,
  frame: {
    frameId: 'frame-1',
    sessionId: 'session-1',
    capturedAtMs: 1,
    image: { width: 1280, height: 800, mimeType: 'image/png' },
    nativeDesktop: { width: 1280, height: 800, scaleX: 1, scaleY: 1 },
    coordinateSpace: 'kun-frame-v1'
  }
}

function fakeController(overrides: Partial<Record<string, unknown>> = {}): {
  controller: HostController
  calls: string[]
} {
  const calls: string[] = []
  const controller = {
    ensureReady: async () => ({ available: true }),
    capture: async () => SHOT,
    screenSize: async () => ({ width: 1280, height: 800 }),
    cursorPosition: async () => ({ x: 10, y: 20 }),
    moveTo: async (x: number, y: number) => void calls.push(`move:${x},${y}`),
    click: async (x: number | undefined, y: number | undefined, button: string, count: number) =>
      void calls.push(`click:${x},${y},${button},${count}`),
    drag: async (a: number, b: number, c: number, d: number) => void calls.push(`drag:${a},${b}-${c},${d}`),
    scroll: async (x: number | undefined, y: number | undefined, dir: string, amt: number) =>
      void calls.push(`scroll:${dir},${amt}`),
    typeText: async (text: string) => void calls.push(`type:${text}`),
    pressHotkey: async (key: string) => void calls.push(`key:${key}`),
    wait: async (ms: number) => void calls.push(`wait:${ms}`),
    ...overrides
  } as unknown as HostController
  return { controller, calls }
}

function visionContext(image: boolean): ToolHostContext {
  return {
    threadId: 'th',
    turnId: 'tn',
    workspace: '/ws',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    model: {
      id: 'm',
      inputModalities: image ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: image ? ['text', 'image_url'] : ['text']
    }
  }
}

async function buildTool(configOverrides = {}, controllerOverrides = {}) {
  const { controller, calls } = fakeController(controllerOverrides)
  const result = await buildComputerUseToolProviders(
    { enabled: true, mode: 'auto', maxImageDimension: 1280, maxActionsPerTurn: 40, ...configOverrides },
    { controller }
  )
  const tool = result.providers[0]?.tools[0]
  return { result, tool, calls }
}

describe('buildComputerUseToolProviders gating', () => {
  it('produces no providers when disabled or off', async () => {
    expect((await buildComputerUseToolProviders({ enabled: false, mode: 'auto', maxImageDimension: 1280, maxActionsPerTurn: 40 })).providers).toHaveLength(0)
    expect((await buildComputerUseToolProviders({ enabled: true, mode: 'off', maxImageDimension: 1280, maxActionsPerTurn: 40 })).providers).toHaveLength(0)
  })

  it('reports unavailable when the backend will not load', async () => {
    const result = await buildComputerUseToolProviders(
      { enabled: true, mode: 'auto', maxImageDimension: 1280, maxActionsPerTurn: 40 },
      { controller: { ensureReady: async () => ({ available: false, reason: 'no nut' }) } as unknown as HostController }
    )
    expect(result.available).toBe(false)
    expect(result.providers[0]?.available).toBe(false)
    expect(result.providers[0]?.tools).toHaveLength(0)
  })

  it('auto mode advertises only to vision models', async () => {
    const { tool } = await buildTool()
    expect(tool?.shouldAdvertise?.(visionContext(true))).toBe(true)
    expect(tool?.shouldAdvertise?.(visionContext(false))).toBe(false)
  })

  it('always mode advertises regardless of modality', async () => {
    const { tool } = await buildTool({ mode: 'always' })
    expect(tool?.shouldAdvertise?.(visionContext(false))).toBe(true)
  })
})

describe('computer_use execution', () => {
  it('returns a screenshot image for the screenshot action', async () => {
    const { tool } = await buildTool()
    const out = (await tool!.execute({ action: 'screenshot' }, visionContext(true))) as {
      output: { kind: string; images: { data_base64: string }[]; frame_id?: string }
    }
    expect(out.output.kind).toBe('computer_screenshot')
    expect(out.output.images[0]?.data_base64).toBe('PNGDATA')
    expect(out.output.frame_id).toBe('frame-1')
  })

  it('clicks at a coordinate then returns a fresh screenshot', async () => {
    const { tool, calls } = await buildTool()
    const out = (await tool!.execute({ action: 'left_click', coordinate: [100, 200] }, visionContext(true))) as {
      output: { kind: string }
    }
    expect(calls).toContain('click:100,200,left,1')
    expect(out.output.kind).toBe('computer_screenshot')
  })

  it('routes type / key / scroll / drag / double_click', async () => {
    const { tool, calls } = await buildTool()
    const ctx = visionContext(true)
    await tool!.execute({ action: 'type', text: 'hi' }, ctx)
    await tool!.execute({ action: 'key', text: 'ctrl+c' }, ctx)
    await tool!.execute({ action: 'scroll', coordinate: [5, 5], scroll_direction: 'down', scroll_amount: 2 }, ctx)
    await tool!.execute({ action: 'left_click_drag', start_coordinate: [1, 2], coordinate: [3, 4] }, ctx)
    await tool!.execute({ action: 'double_click', coordinate: [7, 8] }, ctx)
    expect(calls).toEqual(
      expect.arrayContaining(['type:hi', 'key:ctrl+c', 'scroll:down,2', 'drag:1,2-3,4', 'click:7,8,left,2'])
    )
  })

  it('errors on missing required parameters', async () => {
    const { tool } = await buildTool()
    const ctx = visionContext(true)
    expect(((await tool!.execute({ action: 'mouse_move' }, ctx)) as { isError?: boolean }).isError).toBe(true)
    expect(((await tool!.execute({ action: 'type' }, ctx)) as { isError?: boolean }).isError).toBe(true)
    expect(((await tool!.execute({ action: 'scroll', coordinate: [1, 1] }, ctx)) as { isError?: boolean }).isError).toBe(true)
  })

  it('enforces the per-turn action budget', async () => {
    const { tool } = await buildTool({ maxActionsPerTurn: 2 })
    const ctx = visionContext(true)
    await tool!.execute({ action: 'screenshot' }, ctx)
    await tool!.execute({ action: 'screenshot' }, ctx)
    const third = (await tool!.execute({ action: 'screenshot' }, ctx)) as { isError?: boolean; output: { error?: string } }
    expect(third.isError).toBe(true)
    expect(third.output.error).toBe('action_budget_exhausted')
  })

  it('preserves structured host errors without appending misleading permission advice', async () => {
    const stale = Object.assign(new Error('take a new screenshot'), {
      code: 'stale_frame',
      retryable: true,
      needsFreshFrame: true
    })
    const { tool } = await buildTool({}, { capture: async () => { throw stale } })
    const out = (await tool!.execute({ action: 'screenshot' }, visionContext(true))) as {
      isError?: boolean
      output: { error?: string; message?: string }
    }
    expect(out.isError).toBe(true)
    expect(out.output.error).toBe('stale_frame')
    expect(out.output.message).toContain('take a new screenshot')
    expect(out.output.message).not.toContain('Accessibility')
  })
})
