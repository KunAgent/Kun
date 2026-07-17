# Music Prompt Crafting Guide

Comprehensive guide to writing effective music prompts for Mureka AI.

## The Golden Rule: DESCRIBE, Don't Command

```
❌ "Create an energetic pop song with drums"
✅ "energetic pop, driving four-on-the-floor drums, bright synth hooks, 128 BPM, female vocal, festival anthem vibe"
```

The AI responds to descriptions of the music, not instructions to "make" or "create" it.

---

## Design a Dynamic Arc, Not a Static Description

The most common reason AI-generated songs sound flat is that the prompt describes one mood level throughout. Great songs are tension/release journeys — design yours explicitly.

Express the arc as a **mood progression string** in your prompt:
```
✅ "sparse and intimate opening → rising tension → full cathartic chorus → stripped-back bridge → bigger final chorus"
✅ "melancholic and sparse → building urgency → explosive release → quiet resolution"
```

The AI interprets this as an emotional journey across the song. Without it, every section gets the same energy and density.

---

## Effective Prompt Structure

### Minimum Viable Prompt (always include these)
```
[genre + sub-genre], [mood/emotion], [tempo/BPM], [key instruments], [vocal style]
```

### Standard Prompt (recommended for good results)
```
Genre: [specific genre + era, e.g., "90s trip-hop"]
Mood: [2-3 descriptors, e.g., "melancholic, introspective, nocturnal"]
Tempo: [BPM or description, e.g., "85 BPM, slow groove"]
Instruments: [3-5 key instruments, e.g., "turntable scratches, Rhodes piano, upright bass"]
Vocals: [style, e.g., "breathy female vocals, intimate delivery"]
Scene: [usage context, e.g., "late-night city driving"]
```

### Production Brief (for maximum control)
```
Genre: trip-hop | Era: mid-90s Bristol
BPM: 85 | Key: D minor
Mood: melancholic → building tension → cathartic release
Lead: Rhodes piano, tremolo
Rhythm: breakbeat, vinyl crackle texture
Bass: deep sub-bass, Moog-style
Texture: tape saturation, lo-fi warmth
Vocals: breathy female, close-mic intimacy
Structure: Intro(8bars) / Verse / Chorus / Verse / Bridge / Chorus / Outro
Avoid: auto-tune, bright synths, four-on-the-floor kick
Reference: Portishead "Roads" (breakbeat texture, Rhodes tone)
```

**Note on references**: Only use specific songs as sonic benchmarks when all other parameters are already specified. Different from "sound like [artist]" — use for named production qualities (e.g., "Roads-style breakbeat texture").

---

## What Makes Prompts FAIL (Top 7 Mistakes)

| # | Mistake | Why It Fails | Fix |
|---|---------|-------------|-----|
| 1 | **Vague prompts** ("nice pop song") | AI defaults to the statistical average — generic, forgettable | Be ruthlessly specific: sub-genre + era + mood + instruments + BPM |
| 2 | **Contradictions** ("slow and relaxing, high energy, 160 BPM") | Conflicting signals make the AI unpredictable | Check every descriptor agrees with the mood. Pick one direction |
| 3 | **"Sound like [famous artist]"** | Copyright risk + AI interprets literally, often misses the point | Describe the *qualities* you like: "warm analog synths, driving bass, 80s production style" |
| 4 | **Too many words per lyric line** | AI rushes through words → slurred, unnatural vocals | Keep lines ≤10 words. Short lines = better vocal delivery |
| 5 | **No structure tags in lyrics** | Song has no shape — verse/chorus blur together | Always use [Verse], [Chorus], [Bridge], [Outro] tags |
| 6 | **Rewriting entire prompt between iterations** | Can never isolate what improved (or worsened) the output | Change ONE element at a time. A/B test systematically |
| 7 | **Ignoring negative prompts** | Unwanted elements creep in (auto-tune, trap hi-hats, reverb) | Explicitly state what to avoid: "no auto-tune, avoid heavy reverb" |

---

## Effective vs Ineffective — Side-by-Side Examples

### Example 1: Pop Song
```
❌ "A pop song about love that sounds good"
✅ "bright synth-pop, uplifting, 120 BPM, arpeggiated synths, punchy electronic drums, female vocal with light reverb, 2020s clean production, summer anthem feel"
```

### Example 2: Lo-Fi Background
```
❌ "lofi music for studying"
✅ "lo-fi hip-hop, warm and mellow, 75 BPM, dusty vinyl crackle, jazzy Rhodes chords, muted boom-bap drums, no vocals, late-night study session atmosphere"
```

### Example 3: Cinematic
```
❌ "epic movie music"
✅ "cinematic orchestral, tension building to triumphant climax, 95 BPM, strings staccato → legato swell, French horns, timpani rolls, choir in final section, Hans Zimmer-style layered percussion"
```

### Example 4: Rock Song
```
❌ "energetic rock song, male vocals, guitar solo"
✅ "alternative rock, energetic and raw, 140 BPM, distorted electric guitar riffs, driving bass line, punchy drums, raspy male vocals, anthemic chorus, guitar solo section, garage rock aesthetic, festival anthem energy"
```

### Example 5: Traditional Chinese
```
❌ "Chinese music, sad"
✅ "Chinese traditional guofeng, melancholic and nostalgic, 60 BPM, dizi bamboo flute lead melody, guzheng plucked strings, subtle erhu, misty atmosphere, Jiangnan water town imagery, rain and mist soundscape, instrumental only"
```

---

## Lyrics Writing: What Separates Good from Bad

### Structure Tags (always use these)

```
[Intro]
[Verse]
[Pre-Chorus]
[Chorus]
[Bridge]
[Break]
[Outro]
```

**Standard structure order**: Verse → Chorus → Verse → Chorus → Bridge → Final Chorus → Outro. The Bridge always appears after the second chorus — never before the first.

If your generated bridge sounds like a second verse, regenerate it with:
```bash
python generate_lyrics.py extend "<existing lyrics>" "write a contrasting bridge that shifts perspective, strips back to a single instrument, and sets up the final chorus"
```

### Golden Rules for Lyrics That Sing Well

1. **Keep lines short** — 6-10 words per line. Long lines get rushed.
   ```
   ❌ "I've been walking through the streets of this old town thinking about everything we used to do together"
   ✅ "Walking through the old town streets\n   Thinking of what we used to be"
   ```

2. **Match syllable count across verse lines** — Creates natural rhythm.
   ```
   ✅ "Shadows fall on empty streets"    (7 syllables)
      "Whispers lost in evening heat"    (7 syllables)
      "Dancing lights through window panes" (7 syllables)
   ```

3. **Use rhyme patterns intentionally** — ABAB or AABB, not random.
   ```
   ✅ [Verse]
      The city sleeps beneath the stars (A)
      While dreamers chase the fading light (B)
      We trace our names on passing cars (A)
      And disappear into the night (B)
   ```

4. **Chorus should be simpler and more repetitive than verses** — Fewer words, not more. Whitespace and repetition create impact; repetition IS the melody.

5. **Don't over-explain in lyrics** — Imagery > exposition.

---

## Writing a Memorable Hook

The hook is the most important line in your song. Get it right:

### 1. Length and singability
4-8 words, singable on first listen, usually contains the song's title.

```
✅ "I will always love you" — simple, universal, title, singable
✅ "Rolling in the deep" — 4 words, vivid, singable
❌ "I feel the way I feel when I think about our story" — too long, too vague
```

### 2. End chorus lines on open vowels
AI vocals hold the last syllable of each line. Open vowels (oh, ah, ay, ee) sustain beautifully. Closed consonants (mm, th, ff, ss) sound awkward when held.

```
✅ "Let me go" → ends on "oh" — sustains well
❌ "Let me breathe" → ends on closed "th" sound — awkward to hold
```

### 3. Chorus density
A chorus should have FEWER words than a verse, not more. The space around the hook gives it impact.

```
❌ "I feel sad because you left me and now I'm alone"
✅ "Empty chair across the table\n   Coffee cold, the morning grey"
```

---

## Auto-Generate Lyrics First, Then Refine

```bash
# Generate lyrics from a concept
python generate_lyrics.py generate "a bittersweet farewell song, two old friends parting ways after summer"

# Extend if you need more sections
python generate_lyrics.py extend "[Verse]\nThe last light paints the pier in gold..."
```

---

## Iteration Strategy (How Pros Refine)

1. **First generation**: Use your best-guess prompt + n=3
2. **Listen to all choices**: Note what's good and what's off
3. **Adjust ONE element**: If rhythm is wrong → change BPM/drums description. If mood is off → change mood descriptors
4. **Re-generate**: Same lyrics, tweaked prompt
5. **Compare**: Does the change improve or worsen?
6. **Repeat** until satisfied

### What to Listen For

**For vocal songs:**
| Symptom | Fix |
|---------|-----|
| Vocals feel rushed / words swallowed | Shorten lyric lines, reduce syllables per line |
| No energy build between verse and chorus | Add mood progression arc to prompt (e.g., "sparse → full cathartic release") |
| Hook doesn't stick | Simplify chorus to 4-8 words, repeat title phrase, check lines end on open vowels |
| Tempo feels wrong | Adjust BPM ±10 and regenerate |
| Listed instruments not audible | Verify each instrument is named explicitly in the prompt |

**For instrumentals / ambient:**
| Symptom | Fix |
|---------|-----|
| Tempo feels wrong | Adjust BPM ±10 |
| Mood doesn't match intent | Audit all mood descriptors for internal consistency |
| Instruments missing | Verify each is named explicitly in the prompt |

**Never rewrite the entire prompt at once.** You'll lose track of what works.

---

## Production Checklist (Before You Generate)

Before hitting generate, verify:

- [ ] **Genre is specific**: Not just "pop" but "synth-pop, 2020s, clean production"
- [ ] **Mood is consistent**: No contradictions (slow + energetic = confused AI)
- [ ] **BPM is set**: Even approximate ("~90 BPM, slow groove") helps
- [ ] **3-5 instruments listed**: Gives the AI sonic anchors
- [ ] **Vocal style specified**: Or "no vocals" / "instrumental only"
- [ ] **Lyrics have structure tags**: [Verse], [Chorus], [Bridge], [Outro]
- [ ] **Lines are short**: ≤10 words per line
- [ ] **Avoid list included**: What you DON'T want (auto-tune, trap hi-hats, etc.)
- [ ] **N > 1**: Generate 2-3 choices and pick the best. Never rely on a single generation
