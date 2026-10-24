import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import './timeline-records.css'

type UserBlock = Extract<ChatBlock, { kind: 'user' }>

export type PendingSteerTurnState = {
  busy: boolean
  currentTurnId?: string | null
  currentTurnUserId?: string | null
}

/**
 * Client-side ids of a guided message the runtime accepted but has not yet
 * folded into the running turn: the queued message id (`q-…`) or a Graph
 * guidance placeholder. The runtime's own user item replaces the id once the
 * message actually joins the turn at the next step boundary.
 */
function isGuidancePlaceholderId(id: string): boolean {
  return id.startsWith('q-') || id.startsWith('graph-steering-')
}

/**
 * A guided user bubble still waiting to join the running turn: a guidance
 * placeholder appended inside the turn that is running now (never the turn's
 * own opening message, and never once the turn has settled).
 */
export function isPendingSteerUserBlock(block: UserBlock, state: PendingSteerTurnState): boolean {
  if (!state.busy || !state.currentTurnId) return false
  if (!isGuidancePlaceholderId(block.id) || block.id === state.currentTurnUserId) return false
  const turnId = block.turnId?.trim() || block.meta?.turnId?.trim()
  return turnId === state.currentTurnId
}

/** Small status line under the faded bubble: "Waiting to join the current turn…". */
export function PendingSteerStatus(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <span className="ds-pending-steer-status" role="status" data-pending-steer-status>
      <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="ds-pending-steer-status-text" title={t('composerRecords.pendingSteerHint')}>
        {t('composerRecords.pendingSteer')}
      </span>
    </span>
  )
}
