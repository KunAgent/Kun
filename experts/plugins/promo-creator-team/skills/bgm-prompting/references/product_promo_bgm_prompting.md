# Product Promo BGM Prompting

Use this reference when a product promo BGM feels too generic, too ambient, too "AI tech background", or too similar across options.

## Core Diagnosis

Visual style and music genre are not the same thing.

`Apple-style visuals` often means black stage, clean typography, and product focus. It does not always mean ambient pads, glass ticks, no drums, and weak energy. A product launch or product demo BGM usually needs one or more of:

- a clear rhythm bed
- a memorable but non-vocal hook
- bass movement
- section contrast
- commercial polish
- a satisfying final lift

## Anti-Convergence Rule

Do not create alternatives by only changing BPM, a few adjectives, or the same instrument family.

Each option must differ on at least 4 of these 6 axes:

| Axis | Examples |
|---|---|
| Genre | electro-pop product launch, indie electronic, corporate cinematic, future garage, synthwave, minimal house |
| Rhythm | four-on-the-floor, half-time groove, syncopated clicks, breakbeat, no percussion |
| Bass | warm sub pulse, sidechained synth bass, plucked bass, cinematic low strings |
| Hook | synth pluck motif, piano motif, marimba/glass motif, string ostinato, bass riff |
| Energy curve | slow build, early hook, mid-film lift, final drop-out, constant drive |
| Instrument palette | drums + bass + synth hook, piano + strings, modular synth + percussion, guitar + electronic drums |

If two prompts share more than two of genre, rhythm, bass, hook, and instrument palette, they are not valid alternatives.

## Better Product Promo Lanes

### Validated Default Pair

For software product promo videos similar to the WorkBuddy OPC film, start with these two lanes first:

1. **Commercial Product Launch**: use when the video should feel like a modern product release ad. This was validated by `promo-v2-commercial-launch-01.mp4`.
2. **Clean UI Demo Groove**: use when the video should closely support UI screens, cards, workflows, and product operation. This was validated by `promo-v2-ui-groove-02.mp4`.

This pair is a better default than ambient tech music because it creates two genuinely different but relevant directions:

| Direction | Main job | Sonic identity |
|---|---|---|
| Commercial Product Launch | Product ad energy, launch polish, CTA momentum | 118 BPM, tight electronic drums, sidechained synth bass, plucked synth hook |
| Clean UI Demo Groove | UI timing, cards, workflow motion, clean software feel | 112 BPM, syncopated digital percussion, rubbery synth bass, short glass-pluck motif |

When generating first-round BGM options, create this validated pair before trying quieter ambient, cinematic, or emotional lanes.

### Lane 1: Commercial Product Launch

Use when the user wants something closer to modern product ads, SaaS launch videos, or product showcase reels.

```text
modern commercial product launch music, 118 BPM, instrumental only, polished and confident, tight electronic drums, sidechained synth bass, bright plucked synth hook, warm pads, clean impact hits. Structure: sparse branded intro for 0-6s, groove enters at 6s, short impact at 14s, full product-demo beat from 15-34s, stronger lift from 34-54s, clean final resolve at 54-60s. Designed for software UI, card animations, and product reveal cuts. No vocals, no lyrics, no ambient-only bed, no sleepy pads, no trap, no cinematic trailer booms.
```

### Lane 2: Clean UI Groove

Use when the video has UI screens, dashboards, cards, and workflow animations that need momentum.

```text
clean UI demo groove, 112 BPM, instrumental only, precise and upbeat but not loud, muted kick, crisp snare snaps, syncopated digital percussion, rubbery synth bass, short glass-pluck motif, light airy pads. Structure: minimal boot-up intro, groove starts at 6s, UI reveal hit at 15s, card grid rhythm from 24s, tighter workflow pulse from 34s, wider final lift from 44s, quick clean ending. No vocals, no lyrics, no slow ambient wash, no generic corporate piano, no EDM festival drop.
```

### Lane 3: Founder Film With Momentum

Use when the story starts with pressure or loneliness but still needs product-commercial energy.

```text
emotional founder-product film score with modern electronic groove, 98 BPM, instrumental only, focused and hopeful, soft piano motif, warm synth bass, brushed electronic drums, subtle strings, glass accents. Structure: lonely sparse intro, tension under founder overload at 6s, product reveal opens harmony at 15s, rhythm becomes organized at 24s, stronger teamwork movement at 34s, warm confident lift at 44s, resolved final phrase at 54s. No vocals, no lyrics, no sad piano ballad, no ambient-only pad, no heavy trailer drums.
```

### Lane 4: Premium Tech Pop Instrumental

Use when the visuals are clean but the user wants more of a finished ad-track feel.

```text
premium tech-pop instrumental for a product showcase, 120 BPM, instrumental only, sleek, optimistic, commercially polished, punchy electronic drums, smooth synth bass, catchy plucked synth motif, soft chord stabs, subtle risers. Structure: 0-6s branded intro with filtered hook, 6-15s beat builds, 15-24s product UI groove, 24-34s hook variation for expert cards, 34-44s bigger rhythmic lift for parallel workflow, 44-54s open uplifting section, 54-60s short confident outro. No vocals, no lyrics, no sleepy ambient, no ukulele, no stock corporate jingle, no aggressive EDM.
```

### Lane 5: Executive Cinematic With Beat

Use when the brand needs credibility and polish, but not a flat corporate bed.

```text
executive cinematic product score with restrained beat, 102 BPM, instrumental only, premium, serious, forward-moving, low strings, soft piano pulses, tight hybrid percussion, controlled synth bass, clean metallic hits. Structure: serious opening, tension at 6s, brand hit at 14s, credible UI reveal at 15s, measured card rhythm at 24s, stronger process momentum at 34s, broader confident lift at 44s, resolved final cadence at 54s. No vocals, no lyrics, no cheesy corporate piano, no ambient-only bed, no trailer booms, no trap hats.
```

## Prompt Rules For Mureka

- Stay under 1024 characters for generation.
- Put genre, BPM, rhythm, bass, and hook in the first sentence.
- Include "instrumental only" and "no vocals, no lyrics".
- Avoid overusing `minimal`, `ambient`, `pads`, `glass`, `ticks`, `Apple`, `premium tech` in every option.
- For product demos, do not ban drums by default. Ban only the wrong drums: `no trap hats`, `no EDM festival drop`, `no trailer booms`.
- Use time-coded structure only after the sonic identity is clear.
