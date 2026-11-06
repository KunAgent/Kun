# Built-in companions

Kun ships 17 offline companions: Xiao Kun, iKun, and the 15 AI characters
listed in [AI-GIRLS.md](AI-GIRLS.md). Each package contains nine animation
states and 57 transparent sprite frames. Brand marks are part of the AI
character artwork; see [AI-BRANDS.md](AI-BRANDS.md) for their sources.

## Companion theater

In Settings > Pets, expand **Companion theater** to preview the ensemble,
choose its members and start it on the desktop. The pet toolbar and context
menu also open the theater controls. Choose either or both Kun hosts and
one or more AI companions, up to the entire 17-character cast.
Six themed cast presets cover the whole collection: Xiao Kun's workshop,
iKun's rhythm party, Kimi's moonlight crew, Doubao's cozy tea, MiMo's tiny
inventors, and Whale Girl's bubble garden. Relevant AI characters lead their
scene when present, such as Doubao serving tea and MiniMax conducting music.

The 24 scenes combine the existing sprite poses with coordinated movement,
turn-taking, shared props and character-specific motifs. They do not add new
sprite sheets or invoke a model. Claude brings books, Kimi brings moonlight,
DeepSeek brings bubbles, Gemini brings stars, and each other AI has its own
performance role. These fictional roles are unrelated to model capabilities.

| Group | Scenes |
| --- | --- |
| Greetings | Meet the crew, high-five team, wave relay, victory cheer, curtain call |
| Play | Follow Kun, orbit waltz, companion train, chase the star, shuttle relay, peekaboo, jumping wave, stretch break, rhythm challenge |
| Work | Idea circle, build together, catch the bug, show and tell, reading circle |
| Life | Companion orchestra, pass the present, afternoon tea, stargazing, bubble garden |

Membership, chosen scene, automatic cycling and pause state survive restart.
Use **Solo pet** to return to the selected individual companion. Normal chat
and task notifications remain available during a performance. Reduced-motion
mode shows a still ensemble; hidden windows suspend the animation clock.

## Model and input reactions

Automatic feedback is enabled by default and can be toggled in Settings >
Pets. Selecting a recognized model invites its AI companion for a short
greeting. Typing or using voice brings that companion alongside the selected
pet until the activity ends. Main and side composers supply their own model
identity. Unknown model names on compatibility gateways do not imply GPT;
provider aliases are used only for an automatic/default model selection.

Typing uses the package's working frames. Recording silence uses listening
poses; measured microphone activity drives responsive gestures and a waveform.
Transcription uses thinking poses. Answer playback uses its actual audio
amplitude and clears feedback on stop or buffer drain. An active manual theater
keeps its chosen cast, temporarily invites the matching model companion, and
pauses its choreography while everyone reacts. Its original scene resumes
afterward. A paused theater suppresses automatic feedback. The selected solo
pet and saved ensemble membership are never changed.

Each `pet.json` can supply an optional `interactions` object with:

- `version: 1`, `modelAliases` and `providerAliases` for model identity.
- `greeting.states` (one to six existing pose names) and `durationMs`
  (1000 to 10000) for the character's entrance.
- `clips.typing`, `clips.listening`, `clips.speaking` and `clips.transcribing`,
  each with a pose `state`, `tempo` (0.25 to 3) and `strength` (0 to 1).

These recipes reuse the package's existing nine sprite rows. They are validated
declarative data, and changing just a recipe invalidates the cached manifest.
Old v1/v2 packages without recipes use the generic feedback poses. Invalid
updates retain the last valid cached package.

Only Kun's composer/editor input events and already active recording/playback
are used. Pet messages carry state and a quantized amplitude, never the typed
text, transcript or audio. Input signals expire after 1.8 seconds without a
heartbeat and are never persisted. Reduced-motion mode keeps the poses still.

## Upgrades and imports

The older bundled anime/animal collection is no longer shipped or offered as
built-in pets. If one of those built-ins was selected, the next library refresh
selects Xiao Kun while retaining whether the overlay was open. Saved copies
are left intact on disk. Local and Codex imports retain their separate
namespaces and are unaffected, even if their package IDs match a retired pet.

Run `node --test scripts/bundled-pets.test.cjs` for the exact built-in roster,
image decoding, transparent margins, 57-frame coverage, unique designs and
asset size checks. Runtime migration, ensemble preferences, IPC, scene timing
and layout are covered by the pet Vitest suites.
