# Built-in companions

Kun ships exactly three built-in pets: Xiao Kun, iKun and DS (`whale-girl`).
Every package retains its original nine solo animation states and 57 transparent
frames. DS's artwork attribution is in [whale-girl/ATTRIBUTION.md](whale-girl/ATTRIBUTION.md).
Each package also includes a declarative rig for joint canvas interactions.

## One resident, occasional visitors

Choosing a desktop pet is the only setup required. The selected pet normally
stays alone. It can occasionally invite other available built-in characters
for a short scene, then return to its usual position after they leave.
There is no team checklist, fixed cast, or permanently repeating group.
The visitor pool follows the built-in catalog automatically, including when
that catalog is reduced in a later release.

A visit has three beats:

1. The resident calls a friend over; guests walk, hop or peek in from different
   directions.
2. They act together on one canvas. Hands, bodies, feet and objects share the
   same contact and motion solution.
3. They wave goodbye and leave. The resident returns to its original position.

Most visits have one guest; some invite both other pets. The joint activity lasts
12-14 seconds, plus a short entrance and departure. Each invitation has a hard
end time; continued typing or recording never keeps guests on screen indefinitely.

## Timing and interruption rules

Random visits are enabled by default. Settings > Pets > Visiting friends offers
optional frequency and pause controls:

| Frequency | Random interval during suitable idle time | Automatic limit per ten minutes |
| --- | --- | --- |
| Quiet | 8-14 minutes | 2 |
| Natural (default) | 4-7 minutes | 3 |
| Lively | 2-4 minutes | 5 |

Actual timing varies. A recent model switch can invite the matching AI after
selection settles; a fresh completed task can prompt a short celebration;
a pause after at least 90 seconds of input can suggest a stretch. These are
probabilistic opportunities, not mandatory reactions to every event. All share
a 90-second cooldown after a visit and the automatic invitation budget.
Recent guests and scenes are avoided when alternatives exist.

Automatic invitations wait while the user types, records, listens to answer
playback, drags the pet, uses pet controls, or has live/urgent work. Starting
input during an automatic visit sends guests home within a short farewell.
Interrupted opportunities are discarded. Hiding the overlay, changing the
resident, sleep/resume, and clock changes never replay a backlog of visits.
Reduced-motion mode suppresses automatic visits; explicit visits use still
poses. A manual invitation is always a single finite scene.

The toolbar and context menu can invite friends immediately. The close button
on a visit sends them home. Settings also offers an optional activity choice
for that one invitation. Neither action saves a team or starts an endless
playlist. Old saved troupe/autoplay flags are normalized off on upgrade.

## Input and model awareness

Typing, listening, measured microphone activity, transcription, and actual
answer playback animate the resident itself. A selected model does not create
a permanent side-by-side companion. The model context only influences an
eligible temporary visit. Explicit model-name matches take precedence over a
provider label. DeepSeek can invite DS; removed AI characters are never recreated
for other model names.

Main and side composers supply their own model context. The input messages carry
only state and a quantized amplitude, never typed text, transcripts or audio.
They expire after 1.8 seconds without a heartbeat and are never persisted.
Disabling input animations still lets the visit scheduler avoid interrupting
active input. No extra microphone capture or model request is started for pets.

## Bottle discoveries

A fresh `wardrobe.dropped` receipt can trigger a short solo discovery scene:
notice the falling sealed bottle, walk over, catch it, inspect it, celebrate,
and return to the saved position. Xiao Kun keeps the original logo-based white
eyes and black pupils; its careful pickup, head tilt and hop provide the extra
expression. iKun uses a playful toss-and-catch variation. The sprite artwork is
unchanged.

The workbench verifies the drop against its read-only wardrobe mirror before
sending only opaque drop IDs and time to Main. The overlay receives only a
count and a presentation request. No rarity, contents, rewards, open/stash
operation or extra drop roll is involved. The existing sealed-bottle artwork
is used throughout; rewards are still opened from the wardrobe by the user.

Shelf hydration, history replay, guest login hints, already opened/stashed
bottles, quiet notices and focus mode do not trigger the scene. Multiple live
drops are coalesced without extending the animation. A single cue can wait up
to 15 seconds for a quiet moment, then expires; hidden windows never reopen for
it. Input interrupts the scene, and account/presentation changes clear it.
Disabling event feedback suppresses it; reduced-motion mode shows a brief still
notice. Pausing random friend visits leaves these real-event reactions enabled.

## Package recipes

An optional `interactions` object in `pet.json` supplies validated data:

- `version: 1`, lowercase literal `modelAliases` and `providerAliases` identify
  built-in AI companions. Local packages can customize their resident's poses.
- `greeting.states` and `durationMs` preserve the package's greeting recipe.
- `clips.typing`, `clips.listening`, `clips.speaking`, and `clips.transcribing`
  each select a `state`, `tempo` (0.25-3), and `strength` (0-1).
- An optional `bottle` recipe sets `catchStyle` (`careful` or `bounce`),
  `inspectState`, `celebrateState`, and a bounded `durationMs` (6000-12000).
- `visits.scenes` lists one to eight preferred scene IDs; `visits.arrival` is
  `walk`, `hop`, or `peek`. DS favors shared bubbles, iKun favors passing a ball,
  and Xiao Kun favors hand-in-hand steps.
- `joint` stores the neutral sprite row, blink cells, head pivot, shoulder/hand
  anchors, feet and ground. All values are bounded numeric data.

The four joint scenes use one texture mesh renderer and shared contact constraints.
Legacy activity names map to these scenes. No executable package script is added. Recipe-only
changes invalidate the cached manifest. Old v1/v2 packages without recipes
retain generic feedback; invalid updates preserve the last valid cached copy.

## Library upgrades and validation

The retired anime/animal collection and the fourteen other AI characters are no
longer offered or bundled. Retired AI selections migrate to DS; older anime/animal
selections migrate to Xiao Kun. Both preserve whether the overlay was open. Local/Codex imports retain their own namespaces and saved files.

Run `node --test scripts/bundled-pets.test.cjs` for roster, decoding, margins,
57-frame coverage, rig metadata and asset size checks. Pet Vitest suites cover
migration, ephemeral presence, invitation delivery/acknowledgment, randomized
scheduling, cooldowns, interruption, choreography, and the setup-free controls.
