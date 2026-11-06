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
