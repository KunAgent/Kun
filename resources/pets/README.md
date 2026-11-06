# Built-in companions

Kun ships Xiao Kun, iKun, and the AI characters listed in
[AI-GIRLS.md](AI-GIRLS.md). Every package has nine animation states and 57
transparent frames. Brand marks are part of the artwork; their sources are
recorded in [AI-BRANDS.md](AI-BRANDS.md).

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
2. They play one short scene, using circles, a loose triangle, a chase route,
   turn-taking, and shared props instead of a stationary row.
3. They wave goodbye and leave. The resident returns to its original position.

Most visits have one guest; occasional scenes invite two or three. Automatic
model-related greetings last about 7-8 seconds in total. Other visits last
about 10-13 seconds. Each invitation has a hard end time; continued typing or
recording never keeps guests on screen indefinitely.

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
provider label; an unknown model on a compatibility gateway does not imply GPT.

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
  `walk`, `hop`, or `peek`. Claude favors reading and tea, Kimi favors stargazing,
  iKun favors rhythm games, and MiMo favors inventions and debugging.

The 24 scene definitions reuse the existing sprite rows with coordinated
movement and props. They do not add executable package scripts. Recipe-only
changes invalidate the cached manifest. Old v1/v2 packages without recipes
retain generic feedback; invalid updates preserve the last valid cached copy.

## Library upgrades and validation

The previously retired anime/animal collection is no longer offered as built-in
pets. An old selected built-in migrates to Xiao Kun while preserving whether the
overlay was open. Local/Codex imports retain their own namespaces and saved files.

Run `node --test scripts/bundled-pets.test.cjs` for roster, decoding, margins,
57-frame coverage, unique designs and asset size checks. Pet Vitest suites cover
migration, ephemeral presence, invitation delivery/acknowledgment, randomized
scheduling, cooldowns, interruption, choreography, and the setup-free controls.
