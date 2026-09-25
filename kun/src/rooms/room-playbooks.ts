export type RoomPlaybookId = 'discuss-then-propose' | 'evidence-handoff' | 'coordinator-synthesis' |
  'user-fires-external' | 'when-to-ask-user' | 'follow-up-later'

export const ROOM_PLAYBOOKS: Record<RoomPlaybookId, { title: string; triggers: string[]; body: string }> = {
  'discuss-then-propose': {
    title: 'Discuss first, then converge on one proposal',
    triggers: [
      'Several members could plausibly do the same work',
      'Members are posting competing approaches with no owner',
      'The user asked for a recommendation, not more opinions'
    ],
    body: [
      'Use this when a topic has enough voices and needs one decision instead of more discussion.',
      '',
      '1. Post one position per member. State your recommendation and the evidence behind it once, via send_room_message. Do not re-argue a point a peer already made; answer only what is still open, or use skip:true.',
      '2. Disagree with handles, not volume. A correction that cites a message id, task id or file path outweighs a longer restatement.',
      '3. Remember the authority split. Room members cannot create, amend or reassign execution tasks; execution suggestions in a discussion are reference material for the coordinator, and only the user can authorize work.',
      '4. Converge into a concrete next step. When the room offers a proposal card capability, draft the agreed choice as a proposal card so the user can confirm it directly. Until then, state the recommendation plainly in your staged reply: the decision, who should do it, and what the user must approve.',
      '5. Pull in a missing voice only through structured invitations. Use inviteMemberIds or mentionMemberIds inside send_room_message; plain @ text does not wake another member.',
      '6. Stop once the proposal is on the table. Extra rounds of agreement are acknowledgements; skip them.'
    ].join('\n')
  },
  'evidence-handoff': {
    title: 'Hand off with an evidence packet',
    triggers: [
      'A piece of the work needs another permitted Agent',
      'You received a handoff and must answer it',
      'A reply keeps bouncing because context is missing'
    ],
    body: [
      'Use this whenever send_agent_message moves work between Agents. A handoff is read-only assistance inside a bounded scope, never a new execution authority.',
      '',
      'As the requester, write the body as a compact evidence packet that answers five questions:',
      '1. What you need: the exact question or deliverable, small enough for one scoped reply.',
      '2. Why: which decision, task or user request it unblocks.',
      '3. Handles: the message ids, task ids and file paths the recipient may inspect. Supply only the necessary sourceMessageIds; the recipient sees no other conversation history.',
      '4. Verified versus assumed: label every load-bearing claim.',
      '5. The exact question repeated as one line at the end.',
      '',
      'As the recipient, answer with what you found, where the evidence is, what remains uncertain and what the requester should do next. Stage that through send_room_message once and finish; say explicitly which access was missing instead of guessing.',
      '',
      'Never resend an accepted handoff after waiting. Keep the returned handoffId, finish your turn so the asynchronous result can wake a fresh response, and read the handle with get_agent_handoff only when the scope already expects a result.'
    ].join('\n')
  },
  'coordinator-synthesis': {
    title: 'Synthesize many threads into one decision surface',
    triggers: [
      'Execution tasks, replies and reviews are landing in parallel',
      'The user must choose between several finished options',
      'A topic is long and the user needs the state, not the transcript'
    ],
    body: [
      'Use this when the user needs one honest picture of the room instead of ten partial reports.',
      '',
      '1. Collect status, not stories. For each execution task and open thread, note the state, the latest verified result, and its handle (task id, message id, delivery or file path).',
      '2. Sort items into three buckets: done and verified; blocked or failed with the concrete blocker; waiting on a user decision.',
      '3. Put the pending user decisions first. For each, offer the smallest set of real options and name your recommended one with a one-line reason.',
      '4. Do not restate another member\'s result. Cite it. The member who did the work reports on it; your synthesis points at handles.',
      '5. Keep it short enough to act on. If evidence is long, attach or reference the file instead of pasting it.',
      '6. Close with the single most urgent decision and who is already able to proceed without new input.'
    ].join('\n')
  },
  'user-fires-external': {
    title: 'External effects start with the user, not the room',
    triggers: [
      'The task ends in sending, publishing, paying or deploying something',
      'An action would leave this machine, this workspace or this account',
      'You are tempted to treat room discussion as authorization to act'
    ],
    body: [
      'Use this whenever the work product is an outward action: a message to a third party, a public post, a purchase, a deployment, a deletion that cannot be rolled back locally.',
      '',
      '1. Rooms prepare; the user fires. Build everything up to the point where only the trigger remains: the draft text, the exact command, the diff, the filled form, the release notes.',
      '2. Never let room consensus substitute for the user\'s own action. Members cannot authorize external effects, and an invitation or a poll is not permission to execute.',
      '3. Make the trigger explicit. Tell the user exactly what will happen, the cost or blast radius, and how reversible it is, then hand over the prepared artifact so their confirmation is one step.',
      '4. Keep the prepared payload inspectable. Attach the file or paste the final command so the user can review the real thing, not a description of it.',
      '5. If the authorization itself is doubtful, stop preparing and ask before doing more work.'
    ].join('\n')
  },
  'when-to-ask-user': {
    title: 'Decide whether to push on or ask the user',
    triggers: [
      'The goal, scope or authority for the work is ambiguous',
      'You are about to guess between materially different outcomes',
      'A constraint seems to forbid what was asked for'
    ],
    body: [
      'Use this before silently narrowing the work or burning the budget on a guess.',
      '',
      'Proceed without asking when:',
      '- the answer is discoverable: read the referenced files, pinned agreements, task state or earlier messages first;',
      '- the choice is reversible or low-stakes: pick the reasonable default, flag the assumption in one line, and continue;',
      '- the question is already answered anywhere in the supplied context.',
      '',
      'Ask the user when:',
      '- the goal or scope is missing and a wrong guess wastes a whole task or is hard to undo;',
      '- the requested action needs an authorization the room does not hold, such as an external effect or new execution work;',
      '- two requirements genuinely conflict and picking one is a values call, not a technical call;',
      '- a remembered hold, approval or permission may have changed: re-check its current source first, then ask only if it is still blocking.',
      '',
      'How to ask: one short round in plain language. Lead with the blocking question, offer concrete options or the smallest decision needed, and state what you will do by default if the answer is the obvious one. Do not ask for confirmations the context already contains, and do not stack several questions when one unlocks the work.'
    ].join('\n')
  },
  'follow-up-later': {
    title: 'Follow up later without babysitting',
    triggers: [
      'Progress depends on something that has not happened yet',
      'A handoff result or external event is pending',
      'You are about to poll or idle inside a turn'
    ],
    body: [
      'Use this when the next step needs time or an outside trigger, not more work right now.',
      '',
      '1. Finish the current turn. An accepted handoff or a queued task wakes a fresh response when its result lands; waiting inside the turn only spends budget.',
      '2. Leave a clear marker. Say what is pending, which handle tracks it (handoffId, task id, message id), and what event should trigger the follow-up.',
      '3. Do not poll. Repeatedly calling read tools on a pending handle produces nothing new and burns turns.',
      '4. When a wait has no built-in trigger, use the room reminder capability when available to schedule the check instead of looping; if none is available, state the follow-up need plainly so a later turn or the user can pick it up.',
      '5. Write the follow-up so a cold reader can run it: what to check, where the evidence lives, and what to do in each outcome.'
    ].join('\n')
  }
}
