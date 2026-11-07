# Visiting pet stories

A visit is a short scene with an invitation, an action, a response and a finish.
The resident stays alone between visits. A model visit uses the first scene in
the matching pet package's `interactions.visits.scenes`. Manual invitations prefer
the scene's specialist, such as Claude for reading or iKun for passing a ball.

The story runs for its authored 10–18 seconds, plus entrance and departure. It is
not squeezed into a random shorter interval. Interrupted visits freeze the current
story positions, fade the objects, and return the resident to its saved position.
Reduced motion uses a still tableau; hidden windows stop painting.

| Scene | Action and response |
| --- | --- |
| welcome | The resident waves first; the guest approaches, responds and nods. |
| high-five | Approach, raise hands, contact accent, recoil, then celebrate. |
| wave-relay | A wave passes between characters with a delayed response. |
| cheer | Notice success, tell the others, jump in sequence, then together. |
| dance | Demonstrate a step, wait for the imitation, dance together, bow. |
| circle-dance | Invite a partner, exchange mirrored steps, finish together. |
| conga | Join the queue gradually, follow a bend, arrive and wave. |
| chase | Release a star, pursue it, catch it in a hop, then return it. |
| race | Run the first leg, hand over a baton, cross the flag and celebrate. |
| hide-and-seek | Count while looking away, peek from a bush, discover the guest. |
| leapfrog | One hops over a puddle while the other makes room, then follows. |
| exercise | Stretch left and right, rise onto toes, then relax. |
| brainstorm | Bring two ideas to a worktable; the combined idea lights up. |
| coding | The resident types while the partner places the final building block. |
| debug | Notice a floor-level bug, block its escape, catch it with a net. |
| review | Show a project, inspect it closely, acknowledge a detail and respond. |
| study | Open the shared book, lean closer, turn a page and nod in understanding. |
| orchestra | Trade percussion phrases, join in, stop together and bow. |
| beatbox | iKun dribbles, passes, receives the return, then celebrates. |
| gift | Offer and receive a box, open its lid, reveal a character-specific gift. |
| tea | Pour into a cup, raise the cups, sip, set them down and chat. |
| stargazing | Point out stars, discover their neighbours and connect a constellation. |
| bubbles | Blow a bubble, follow its flight, touch and pop it, react. |
| finale | Take individual bows and finish with a shared goodbye. |

`pet-story-types.ts` defines the actors, contact anchors and object states.
The greeting, game, work and life modules author the scene beats.
`pet-storyboard.ts` keeps the output inside the available stage, and
`pet-visit-motion.ts` wraps it in arrival, interruption and departure motion.
`PetStoryProp` draws scene objects rather than using a universal floating badge.
The stage paints transforms directly; React updates only the scene caption.

The original character sheets and faces stay intact. Their existing art matters:
iKun's neutral failed-row frame has empty hands, while its ordinary frames already
carry a basketball; typing frames include a laptop. The passing scene uses the
empty-handed frame while its ball is detached, and percussion does not reuse
laptop frames. Shadows, depth ordering and gesture orientation are coordinated
with the scene.

Tests cover object identity, handoff endpoints, continuity at beats, original
sprite props, interruption, reduced motion, specialist selection and stage bounds.
Visual review should include the whole scene, not just its beginning or title.
