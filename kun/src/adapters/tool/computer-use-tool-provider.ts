import { createHash } from 'node:crypto'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import {
  type HostControlController,
  type HostScreenshot,
  type MouseButton,
  type ScrollDirection
} from '../computer-use/host-control.js'
import { computerUseControllerFromEnvironment } from '../computer-use/remote-host-control.js'

export type ComputerUseToolProviderOptions = {
  /** Injectable controller for tests; defaults to the initiating GUI bridge. */
  controller?: HostControlController
}

export type ComputerUseToolProviderDiagnostic = {
  id: 'computerUse'
  enabled: boolean
  available: boolean
  reason?: string
}

export type ComputerUseToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ComputerUseToolProviderDiagnostic[]
  available: boolean
  reason?: string
}

const COMPUTER_USE_ACTIONS = [
  'screenshot',
  'cursor_position',
  'mouse_move',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'left_click_drag',
  'scroll',
  'type',
  'key',
  'wait'
] as const

const TOOL_DESCRIPTION = [
  'Control the host computer through screenshots and synthesized mouse/keyboard input.',
  'Workflow: take a `screenshot`, reason about what is on screen, then act, then screenshot again to verify.',
  'Coordinates are pixel positions in the MOST RECENT screenshot you took — the screenshot result reports its width and height, and the top-left is (0,0).',
  'Always screenshot before clicking the first time so you know the current resolution and layout.',
  'Use `key` for shortcuts/special keys (e.g. "ctrl+c", "Return", "Escape"); use `type` for literal text.',
  'This drives the real desktop: act deliberately, prefer the smallest action that makes progress, and stop once the task is done.'
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...COMPUTER_USE_ACTIONS],
      description:
        'screenshot: capture the screen. cursor_position: report the cursor. mouse_move: move to coordinate. left_click/right_click/middle_click/double_click: click (optionally at coordinate). left_click_drag: press at start_coordinate and release at coordinate. scroll: wheel scroll at coordinate. type: type text. key: press a key or chord. wait: pause.'
    },
    coordinate: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '[x, y] target in screenshot pixels (clicks, mouse_move, scroll anchor, drag end).'
    },
    start_coordinate: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '[x, y] start point in screenshot pixels for left_click_drag.'
    },
    text: {
      type: 'string',
      description:
        'For `type`: the literal text. For `key`: a key or "+"-separated chord (e.g. "cmd+a", "Return"). For click actions: optional modifier keys to hold (e.g. "shift").'
    },
    scroll_direction: {
      type: 'string',
      enum: ['up', 'down', 'left', 'right'],
      description: 'Direction for the scroll action.'
    },
    scroll_amount: {
      type: 'number',
      description: 'Number of wheel clicks for the scroll action (default 3).'
    },
    duration: {
      type: 'number',
      description: 'Seconds to pause for the wait action (default 1, max 60).'
    },
    frame_id: {
      type: 'string',
      maxLength: 128,
      description: 'Optional frameId from the most recent screenshot. Stale or cross-session frames are rejected.'
    }
  },
  required: ['action'],
  additionalProperties: false
} as const

function toolError(code: string, message: string): { output: unknown; isError: true } {
  return { output: { kind: 'computer_action', error: code, message }, isError: true }
}

function readCoordinate(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = Number(value[0])
  const y = Number(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return [Math.round(x), Math.round(y)]
}

function modifiersFromText(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  return value
    .split(/[\s+]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function sessionIdForTurn(threadId: string, turnId: string): string {
  return `kun-${createHash('sha256').update(`${threadId}:${turnId}`).digest('hex').slice(0, 24)}`
}

function screenshotOutput(action: string, shot: HostScreenshot, note?: string): { output: unknown } {
  return {
    output: {
      kind: 'computer_screenshot',
      action,
      screen: { width: shot.width, height: shot.height },
      ...(shot.frame ? { frame: shot.frame, frame_id: shot.frame.frameId } : {}),
      note:
        note ??
        `Screenshot is ${shot.width}x${shot.height}px. Coordinates for the next action use this pixel space (top-left is 0,0).`,
      images: [
        {
          mime_type: shot.mimeType,
          data_base64: shot.dataBase64,
          width: shot.width,
          height: shot.height
        }
      ]
    }
  }
}

/**
 * Builds the `computer_use` tool provider. The tool is advertised only
 * when the capability is enabled, the native backend loaded, and (in
 * `auto` mode) the active model accepts image input — so a vision model
 * turns it on for itself while text-only models never see it.
 */
export async function buildComputerUseToolProviders(
  config: KunCapabilitiesConfig['computerUse'] | undefined,
  options: ComputerUseToolProviderOptions = {}
): Promise<ComputerUseToolProviderBuildResult> {
  if (!config?.enabled || config.mode === 'off') {
    return { providers: [], diagnostics: [], available: false }
  }

  const controller =
    options.controller ?? computerUseControllerFromEnvironment()
  const readiness = await controller.ensureReady()
  if (!readiness.available) {
    const reason = readiness.reason ?? 'computer-use backend is unavailable'
    return {
      providers: [{ id: 'computerUse', kind: 'gui', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'computerUse', enabled: true, available: false, reason }],
      available: false,
      reason
    }
  }

  const mode = config.mode
  const maxActionsPerTurn = config.maxActionsPerTurn
  const actionsByTurn = new Map<string, number>()

  const shouldAdvertise = (context: ToolHostContext): boolean => {
    if (mode === 'always') return true
    // auto: require an image-capable (vision) model.
    return context.model?.inputModalities?.includes('image') ?? false
  }

  const tool = LocalToolHost.defineTool({
    name: 'computer_use',
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
    toolKind: 'command_execution',
    policy: 'on-request',
    shouldAdvertise,
    execute: async (args, context) => {
      const action = typeof args.action === 'string' ? args.action : ''
      if (!action) return toolError('invalid_action', 'action is required')

      const turnKey = `${context.threadId}:${context.turnId}`
      const used = actionsByTurn.get(turnKey) ?? 0
      if (used >= maxActionsPerTurn) {
        return toolError(
          'action_budget_exhausted',
          `reached the computer_use action limit (${maxActionsPerTurn}) for this turn; summarize progress or ask the user how to proceed`
        )
      }
      actionsByTurn.set(turnKey, used + 1)
      if (actionsByTurn.size > 64) {
        // Evict the oldest OTHER turn — never the active turn, or its budget
        // would silently reset mid-run and defeat the runaway backstop.
        for (const key of actionsByTurn.keys()) {
          if (key !== turnKey) {
            actionsByTurn.delete(key)
            break
          }
        }
      }

      if (context.abortSignal.aborted) {
        return toolError('aborted', 'the turn was cancelled before this action ran')
      }

      const ready = await controller.ensureReady()
      if (!ready.available) {
        return toolError('computer_use_unavailable', ready.reason ?? 'computer-use backend is unavailable')
      }

      const actionContext = {
        sessionId: sessionIdForTurn(context.threadId, context.turnId),
        frameId: typeof args.frame_id === 'string' ? args.frame_id : undefined,
        signal: context.abortSignal
      }
      const coordinate = readCoordinate(args.coordinate)
      try {
        switch (action) {
          case 'screenshot':
            return screenshotOutput('screenshot', await controller.capture(actionContext))

          case 'cursor_position': {
            const pos = await controller.cursorPosition(actionContext)
            const size = await controller.screenSize(actionContext)
            return {
              output: {
                kind: 'computer_action',
                action,
                cursor: [pos.x, pos.y],
                screen: size
              }
            }
          }

          case 'mouse_move': {
            if (!coordinate) return toolError('missing_coordinate', 'mouse_move requires coordinate [x,y]')
            await controller.moveTo(coordinate[0], coordinate[1], actionContext)
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'left_click':
          case 'right_click':
          case 'middle_click':
          case 'double_click': {
            const button: MouseButton =
              action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left'
            const count = action === 'double_click' ? 2 : 1
            await controller.click(
              coordinate?.[0],
              coordinate?.[1],
              button,
              count,
              modifiersFromText(args.text),
              actionContext
            )
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'left_click_drag': {
            const start = readCoordinate(args.start_coordinate)
            if (!start || !coordinate) {
              return toolError('missing_coordinate', 'left_click_drag requires start_coordinate and coordinate')
            }
            await controller.drag(start[0], start[1], coordinate[0], coordinate[1], actionContext)
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'scroll': {
            const direction = typeof args.scroll_direction === 'string' ? args.scroll_direction : ''
            if (!['up', 'down', 'left', 'right'].includes(direction)) {
              return toolError('missing_scroll_direction', 'scroll requires scroll_direction (up/down/left/right)')
            }
            const amount = Number.isFinite(Number(args.scroll_amount)) ? Number(args.scroll_amount) : 3
            await controller.scroll(
              coordinate?.[0],
              coordinate?.[1],
              direction as ScrollDirection,
              amount,
              actionContext
            )
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'type': {
            const text = typeof args.text === 'string' ? args.text : ''
            if (!text) return toolError('missing_text', 'type requires text')
            await controller.typeText(text, actionContext)
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'key': {
            const text = typeof args.text === 'string' ? args.text : ''
            if (!text) return toolError('missing_text', 'key requires text (e.g. "ctrl+c")')
            await controller.pressHotkey(text, actionContext)
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          case 'wait': {
            const seconds = Number.isFinite(Number(args.duration)) ? Number(args.duration) : 1
            await controller.wait(Math.max(0, seconds) * 1000, context.abortSignal)
            return screenshotOutput(action, await controller.capture(actionContext))
          }

          default:
            return toolError('unsupported_action', `unsupported computer_use action: ${action}`)
        }
      } catch (error) {
        const candidate = error as {
          code?: unknown
          message?: unknown
          retryable?: unknown
          needsFreshFrame?: unknown
        }
        const code = typeof candidate.code === 'string' ? candidate.code : 'execution_failed'
        const message = typeof candidate.message === 'string' ? candidate.message : String(error)
        return {
          output: {
            kind: 'computer_action',
            error: code,
            message: `computer_use ${action} failed: ${message}`,
            retryable: candidate.retryable === true,
            needsFreshFrame: candidate.needsFreshFrame === true
          },
          isError: true
        }
      }
    }
  })

  return {
    providers: [{ id: 'computerUse', kind: 'gui', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'computerUse', enabled: true, available: true }],
    available: true
  }
}
