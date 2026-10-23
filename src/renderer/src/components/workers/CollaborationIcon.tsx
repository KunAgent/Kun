import { createLucideIcon } from 'lucide-react'

/**
 * The Collaboration mark, "汇流": three lines converge on one node. Same
 * geometry as the approved canvas option A; a Lucide-shaped icon so it drops
 * into the tab and rail icon slots that take a LucideIcon.
 */
export const CollaborationIcon = createLucideIcon('Collaboration', [
  ['path', { d: 'M3.5 6.5c5 0 6 5.5 10.5 5.5M3.5 17.5c5 0 6-5.5 10.5-5.5M3.5 12H14', key: 'lines' }],
  ['path', { d: 'M15.25 12a2.75 2.75 0 1 0 5.5 0a2.75 2.75 0 1 0-5.5 0', key: 'node' }],
  ['path', { d: 'M16.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0', key: 'core', fill: 'currentColor', stroke: 'none' }]
])
