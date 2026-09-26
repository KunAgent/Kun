import type { ReactElement } from 'react'
import { MissionControlView } from '../mission-control/MissionControlView'

/**
 * ADE home (docs/ade/12 §5): the Mission Control board over the shared
 * ActivityStore feed — needs-you / working / review / done / idle columns
 * across one-to-one threads, managers, workers, and other units.
 */
export function AdeMissionControl(): ReactElement {
  return <MissionControlView />
}
