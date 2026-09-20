import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { GRAPH_LEAD_MODE_INSTRUCTION } from '../prompt/graph-lead-mode.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from './design-mode.js'
import { PLAN_MODE_INSTRUCTION } from './plan-mode.js'
import { WORK_MODE_INSTRUCTION } from './work-mode.js'

type TurnModeState = {
  agentSurface?: 'code' | 'write' | 'design'
  orchestration: 'direct' | 'graph'
  guiDesignArtifact?: { kind: string }
  guiDesignMode?: boolean
  designProfile?: unknown
}

export function buildTurnModeInstruction(
  turn: TurnModeState,
  planTurnActive: boolean,
  roomContext?: ThreadRecord['roomContext'],
  history: readonly TurnItem[] = [],
  turnId?: string
): string {
  const resultTool = roomContext?.kind === 'coordination' ? 'submit_room_plan' : roomContext?.kind === 'review' ? 'submit_room_review' : undefined
  if (resultTool && turnId) {
    let rejected = 0
    for (const item of history) {
      if (item.turnId !== turnId || item.kind !== 'tool_result' || item.toolName !== resultTool) continue
      if (item.isError && ++rejected >= 3) throw new Error('Room result format failed after two repairs; retry this room step explicitly')
    }
  }
  const readOnlyRoomInstruction = roomContext && roomContext.kind !== 'conversation' ? [
    'This is a read-only Kun room ' + roomContext.kind + ' step. Use only advertised tools; do not modify source files or execute commands.',
    'Room discussion is coordinated by the host. Do not create standalone plans, goals, or delegated agents.',
    roomContext.kind === 'coordination' ? 'Submit the room decision with submit_room_plan when available; otherwise return the requested JSON object.' :
      roomContext.kind === 'review' ? 'Inspect the pinned delivery and submit findings with submit_room_review when available; otherwise return the requested JSON object.' :
        'Answer as the current member using attributed room context. Never claim unperformed checks.'
  ].join('\n') : PLAN_MODE_INSTRUCTION
  return [
    ...(turn.agentSurface === 'write' ? [WORK_MODE_INSTRUCTION] : []),
    ...(turn.orchestration === 'graph' ? [GRAPH_LEAD_MODE_INSTRUCTION] : []),
    ...(planTurnActive ? [readOnlyRoomInstruction] : []),
    ...(turn.guiDesignArtifact?.kind === 'svg'
      ? [SVG_ARTIFACT_MODE_INSTRUCTION]
      : turn.guiDesignMode === true || Boolean(turn.designProfile)
        ? [DESIGN_MODE_INSTRUCTION]
        : [])
  ].join('\n\n')
}
