import type { ReactElement } from 'react'

/** Six seats: the shape a member wears in every Collaboration surface. */
export const WORKER_SEAT_COUNT = 6

/** 24-unit paths, one per seat: circle, triangle, hexagon, diamond, star, square. */
const SEAT_PATHS: readonly string[] = [
  'M12 6.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z',
  'M12 6l6.2 11H5.8z',
  'M12 5.6l5.6 3.2v6.4L12 18.4l-5.6-3.2V8.8z',
  'M12 5.5l6.5 6.5-6.5 6.5L5.5 12z',
  'M12 5c.6 3.6 3.4 6.4 7 7-3.6.6-6.4 3.4-7 7-.6-3.6-3.4-6.4-7-7 3.6-.6 6.4-3.4 7-7z',
  'M7 7h10v10H7z'
]

/**
 * Seat numbers for one team. `settledIds` are the members the tray also lists. Members take seats 0, 1, 2… in worker-id order,
 * so every surface that lists the same team agrees, and up to six members
 * never share a shape. Colors come from the worker's id and may still collide;
 * the shape tells those apart.
 */
export function workerSeatMap(
  workerIds: readonly string[],
  settledIds: readonly string[] = workerIds
): Map<string, number> {
  const settled = new Set(settledIds)
  const ids = [...new Set(workerIds)]
  // Members with an activity row number first, as the tray (which only sees
  // those) does. A member that has none yet, such as one just dispatched,
  // takes the seats after them, so it never shifts anyone else's shape.
  const sorted = [...ids.filter((id) => settled.has(id)).sort(), ...ids.filter((id) => !settled.has(id)).sort()]
  return new Map(sorted.map((id, index) => [id, index % WORKER_SEAT_COUNT]))
}

/** The seat glyph in the current color. Decorative: the name it stands for is printed beside it. */
export function WorkerSeatGlyph({ seat, size = 16 }: { seat: number; size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d={SEAT_PATHS[seat % WORKER_SEAT_COUNT]} />
    </svg>
  )
}
