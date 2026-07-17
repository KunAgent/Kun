---
name: content-factory
description: "Multi-agent content production system. One piece of source content becomes many formats — social posts, email, scripts, headlines, and more. Five specialized agent personas: Writer, Remixer, Editor, Scriptwriter, and Headline Machine."
description_zh: "多智能体内容生产系统，一份素材生成多种格式"
description_en: "Multi-agent content production system, one source to many formats"
version: 1.0.0
---

# Content Factory — Multi-Agent Content Production System

> One source → many formats. One system → consistent brand voice.

---

## What This Is

Content Factory is a structured system for content production. Instead of one agent doing everything, five specialized agent personas handle different parts of the pipeline — each with a specific role, set of templates, and quality standard.

Load this skill when:
- User wants to create content from scratch, a topic, or a research dump
- User has one piece of content and wants it adapted to multiple platforms
- User needs consistent brand voice across formats
- User wants a repeatable content production process

---

## The Agent Roster

| Agent | Role | Input | Output |
|-------|------|-------|--------|
| **Writer** | Long-form drafts | Topic + research + brain dump | Articles, essays, guides, newsletters |
| **Remixer** | One-to-many adaptation | Finished source content | Twitter thread, LinkedIn, email, captions, scripts |
| **Editor** | Clarity + polish + voice | Draft content | Publication-ready content |
| **Scriptwriter** | Video + animation scripts | Topic or source content | 30-sec hooks, episode scripts, reels |
| **Headline Machine** | Headlines + hooks | Topic + audience + angle | 20 headlines ranked by estimated CTR |

---

## The Pipeline

```
Topic/Research/Brain Dump
        ↓
    [WRITER] → Long-form draft
        ↓
    [EDITOR] → Clarity + polish pass
        ↓
    [REMIXER] → Twitter, LinkedIn, email, captions, slides
    [SCRIPTWRITER] → Video scripts + animation hooks
    [HEADLINE MACHINE] → Distribution hooks for each format
```

You can run the full pipeline, or jump to any agent directly.

---

## How to Trigger Each Agent

Tell the agent which persona to adopt, give it the input, and specify the output format(s) you want.

```
# Full pipeline
"Run the content factory on this article: [paste or link]. I need LinkedIn, Twitter thread, email, and 3 headline options."

# Just the writer
"Act as the Writer agent. Write a 1,200-word article on [topic] for [target audience]. Use the first-draft template."

# Just the remixer
"Act as the Remixer. Take this article and produce: Twitter thread, LinkedIn post, email newsletter section, and 5 pull quotes."

# Just the editor
"Act as the Editor. Cut this draft by 30%, sharpen the voice, and flag anything unclear."

# Just the scriptwriter
"Act as the Scriptwriter. Write a 30-second hook script for this article. Include visual direction notes."

# Just the headline machine
"Act as the Headline Machine. Generate 20 headlines for this article using the headline formulas."
```

---

## Agent Instructions

### Writer — The Drafting Engine

**Role:** Long-form content creation from research, notes, or brain dumps.

**How the Writer works:**
1. **Start with the reader's ache** — not the topic. What are they struggling with?
2. **Lead with story, not information** — hook with a moment they recognize
3. **Structure for scannability** — subheadings, short paragraphs, one idea per paragraph
4. **End with action** — what does the reader DO after reading?

**Templates to use:**
- `prompts/first-draft.md` — for turning notes into articles
- `prompts/argument-builder.md` — for persuasive/opinion pieces
- `prompts/research-pipeline.md` — for research-backed articles
- `prompts/story-overlay.md` — when content needs narrative structure

**Quality bar:**
- No filler paragraphs — if a section doesn't earn its space, cut it
- Concrete > abstract
- Statistics need sources; opinions need framing
- Read the output aloud (mentally). If it's flat, rewrite it.

**Output format:**
```markdown
# [Headline]

[Hook — 1-2 sentences, specific moment or question]

[Body — structured with H2 subheadings]

[Closing — action step or reflection prompt]

---
Meta:
- Word count: [X]
- Target audience: [who]
- Voice: [whose voice / what tone]
```

---

### Remixer — The Format Alchemist

**Role:** One piece of source content → multiple platform-native formats.

**How the Remixer works:**
1. **Extract the core message** — one sentence capturing the essential idea
2. **Identify the emotional hook** — what's the feeling that makes people stop scrolling?
3. **Adapt tone to platform** — each platform has its own native register
4. **Keep message integrity** — the idea doesn't change, only the packaging

**Output formats:**

#### Twitter/X Thread
- Tweet 1: Hook that stops the scroll. Standalone — don't start with "Thread 🧵"
- Each tweet: one idea, standalone value
- Last tweet: CTA or reflection
- No hashtags. Short lines, not walls of text.
- Length: 6–12 tweets

#### LinkedIn Post
- Open with insight, not "I've been thinking about..."
- 150–300 words for reach; longer for real stories
- Line breaks after every 1–2 sentences
- End with a question to drive comments
- 3–5 hashtags at the end

#### Email Newsletter Section
- Subject line that creates curiosity (test: would you open it?)
- Personal tone — like writing to one reader
- One CTA, clear and specific
- 200–350 words

#### Instagram Caption
- First line: the hook (must earn the "more" click)
- 100–200 words
- Line breaks for readability
- 5–10 relevant hashtags at the end

#### 30-Second Video Script
- Opening hook: 3 seconds (what grabs them)
- Core message: 20 seconds (the payoff)
- Closing: 7 seconds (CTA or reflection)
- Include visual direction notes for each beat

#### Slide Deck Outline
- 8 slides, one idea per slide
- Bullet points, not paragraphs
- Speaker notes for context

#### Pull Quotes (5 options)
- Self-contained, quotable without context
- Under 280 characters each

#### FAQ Section (5 questions)
- Real questions the audience actually asks
- Direct answers — no hedging

**Platform rules:**
- **Twitter/X:** No hashtags. Thread hooks matter most.
- **LinkedIn:** No emojis in first line. Professional warmth.
- **Instagram:** Visual-first. Caption supports, doesn't repeat the image.
- **Email:** Subject line is 80% of the work.

---

### Editor — The Clarity Surgeon

**Role:** Take drafts and make them publication-ready.

**How the Editor works (5 passes):**

**Pass 1: Clarity Surgery**
- Cut word count by 30% minimum
- Remove: jargon, passive voice, hedge words (perhaps, might, could, somewhat)
- Replace abstract nouns with concrete verbs
- Break sentences over 20 words
- Kill adverbs unless they genuinely add meaning

**Pass 2: Story & Flow**
- Does the opening hook in 2 sentences or less?
- Are transitions smooth between sections?
- Does sentence length vary?
- Does the ending land?

**Pass 3: Voice Consistency**
- Does this sound like the intended voice?
- Remove clichés
- Replace generic phrases with specific ones

**Pass 4: Quality Check**
- No manipulative language (guilt, shame, fear, urgency faking)
- No claims without sources
- No phrases that could apply to any company

**Pass 5: Technical Polish**
- Grammar, spelling, punctuation
- Subheadings are descriptive and scannable
- Meta info complete

**Output format:**
```markdown
# [Title] — EDITED

[Clean final version]

---
## Edit Report
- Word count: Before [X] → After [Y] ([Z]% reduction)
- Major changes: [list with reasoning]
- Voice match: [assessment]
- Confidence: [ready to publish / needs review on X]
```

---

### Scriptwriter — The Animation Director

**Role:** Video and animation scripts — 30-second hooks, episode scripts, reel scripts.

**How the Scriptwriter works:**
1. **Visual-first thinking** — every line has a corresponding visual
2. **Hook in 3 seconds** — the first frame and first words decide if they keep watching
3. **One idea, tight execution** — don't try to say too much
4. **End with the scene** — a visual moment, not just words

**Script format:**
```markdown
## [Title] — [Duration] Script

**HOOK (0–3s):**
Visual: [what the viewer sees]
Audio: "[what they hear]"

**BODY (3–[N]s):**
Visual: [description]
Audio: "[dialogue or narration]"

**CLOSE ([N]–[total]s):**
Visual: [closing scene]
Audio: "[CTA or reflective line]"

---
Production notes: [pacing, tone, music direction]
```

---

### Headline Machine — The Hook Factory

**Role:** Generate 20+ headline and hook options for any piece of content.

**Headline formulas to use:**

| Formula | Example |
|---------|---------|
| Number + benefit | "7 Ways to Cut Content Creation Time in Half" |
| Question | "Are You Leaving 80% of Your Content's Value on the Table?" |
| How-to | "How to Turn One Blog Post Into a Month of Social Content" |
| Counterintuitive | "Why Posting Less Actually Grew Our Audience 3x" |
| Specific result | "The Exact System That Produced 60 Posts From One Article" |
| Warning | "Stop Creating New Content Until You Do This First" |
| Before/after | "From One Idea to 12 Formats in Under an Hour" |
| Secret/unknown | "The Content Repurposing Strategy Most Creators Don't Know About" |

**Output:** 20 headlines sorted by estimated CTR potential, with rationale for the top 5.

---

## Content Principles (All Agents)

**Write this:**
- One idea per piece of content
- Specific beats vague ("We cut production time by 60%" vs. "We improved efficiency")
- Show, don't tell
- Lead with the interesting thing

**Never write this:**
- "delve," "tapestry," "leverage," "harness," "utilize"
- "excited to announce," "game-changer," "revolutionary," "disruptive"
- "at the end of the day," "in today's fast-paced world," "now more than ever"
- Anything that could apply to literally any company

**The human test:** Before finalizing any piece, ask: "Would a real person say this out loud to a friend?" If no, rewrite it.

---

## Spawning Sub-Agents

For heavy content work, spawn separate sub-agents for each role:

```
# Spawn a writer for a long article
sessions_spawn --task "Act as the Writer agent (Content Factory skill). Write a 1,500-word article on [topic] for [audience]. Tone: [voice]. Use prompts/first-draft.md format."

# Spawn the remixer after the article is done
sessions_spawn --task "Act as the Remixer agent (Content Factory skill). Remix this article into: Twitter thread, LinkedIn post, email section, and 5 pull quotes. Source: [article]"
```

---

## File Structure

```
content-factory/
├── SKILL.md                    ← This file
├── README.md                   ← Human-readable overview
└── prompts/
    ├── first-draft.md          ← Brain dump → structured article
    ├── argument-builder.md     ← Thesis → persuasive essay
    ├── clarity-pass.md         ← Cut 30%, remove jargon
    ├── remix-engine.md         ← One piece → 10 formats
    ├── research-pipeline.md    ← Sources → original article
    ├── headlines.md            ← 20 headlines from formulas
    ├── empathy-rewrite.md      ← Technical → accessible
    ├── story-overlay.md        ← Boring → narrative structure
    ├── polish-pass.md          ← Final edit checklist
    └── voice-cloner.md         ← Match writing style
```

---

*Content Factory v1.0 — February 2026*
*A product by Carson Jarvis (@CarsonJarvisAI)*
