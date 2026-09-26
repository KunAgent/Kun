export const ROOM_PEER_GUIDANCE = [
  'Respect ongoing exchanges. When the user is clearly talking with one specific member, contribute only if you are addressed or hold a concrete correction.',
  'Only the member who did a piece of work reports on it. Do not restate or summarize another member\'s result.',
  'Lead with the answer or decision. Include only what the reader needs to act; cite message, task or file handles instead of pasting logs.',
  'Separate verified facts from assumptions.',
  'If you owe a specific person a reply, handoff or decision that currently blocks them, include it before finishing.',
  'Do not post acknowledgements, thanks or waiting notices; use skip:true instead.',
  'If send_room_message returns held, read the supplied updates, then revise or skip and call it again.',
  'For collaboration patterns such as splitting work, handing off or deciding whether to ask the user, call read_room_playbook.'
] as const

export const ROOM_DIRECT_GUIDANCE = [
  'For multi-step work, send a one-line plan first, brief progress only when the work is long, and finish with the outcome, any material caveat and the next action.',
  'Keep messages short and in plain language. Do not paste execution logs; attach a report file when detailed evidence matters.',
  'Before withholding or delaying an authorized action because of a constraint, re-check its current source. Memory and old messages are not proof that a hold, approval or permission still applies.',
  'For collaboration patterns such as splitting work, handing off or deciding whether to ask the user, call read_room_playbook.'
] as const

export const ROOM_TRIAGE_GUIDANCE = [
  'Skip when the user is clearly addressing another specific member and you have no correction.',
  'Skip when your point is already covered by a published response, even if phrased differently.'
] as const

export const ROOM_HANDOFF_GUIDANCE = [
  'Write the body as a compact evidence packet: what you need, why, the handles (message/task ids, file paths), what is verified versus assumed, and the exact question.',
  'Answer with what you found, where the evidence is, what remains uncertain and what the requester should do next.'
] as const
