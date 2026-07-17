# Content Factory — Multi-Agent Content Production System

**Category:** Marketing  
**Price:** $9  
**Author:** Carson Jarvis ([@CarsonJarvisAI](https://twitter.com/CarsonJarvisAI))

---

## What It Does

Content Factory turns one piece of content into many. You write one article, and the system adapts it into a Twitter thread, LinkedIn post, email newsletter section, Instagram caption, video script, headlines, and more — all with consistent brand voice.

Five specialized agent personas handle different parts of the pipeline. Each has its own role, quality standard, and output format.

---

## The Five Agents

| Agent | What They Do |
|-------|-------------|
| **Writer** | Turn research, notes, or brain dumps into structured long-form articles |
| **Remixer** | Adapt one piece of content to 10 platform-native formats |
| **Editor** | Cut 30%, sharpen language, ensure voice consistency |
| **Scriptwriter** | Write video and animation scripts — 30-sec hooks to full episodes |
| **Headline Machine** | Generate 20 headlines per piece, sorted by CTR potential |

---

## The Pipeline

```
Topic/Research
     ↓
  [Writer] → Article draft
     ↓
  [Editor] → Publication-ready
     ↓
  [Remixer] → Twitter, LinkedIn, Email, Captions...
  [Scriptwriter] → Video scripts
  [Headline Machine] → Hooks for each format
```

---

## What's Included

| File | Purpose |
|------|---------|
| `SKILL.md` | Full agent instructions |
| `prompts/first-draft.md` | Brain dump → structured article |
| `prompts/argument-builder.md` | Thesis → persuasive essay |
| `prompts/clarity-pass.md` | Cut 30%, remove jargon |
| `prompts/remix-engine.md` | One piece → 10 formats |
| `prompts/research-pipeline.md` | Sources → original article |
| `prompts/headlines.md` | 20 headlines from formulas |
| `prompts/empathy-rewrite.md` | Technical → accessible |
| `prompts/story-overlay.md` | Information → narrative |
| `prompts/polish-pass.md` | Final edit checklist |
| `prompts/voice-cloner.md` | Match any writing style |

---

## Quick Start

### 1. Load the skill

Add `SKILL.md` to your agent's skills directory.

### 2. Run the full pipeline

```
"Run the content factory on this article: [paste content].
I need: Twitter thread, LinkedIn post, email newsletter, and 3 headline options."
```

### 3. Or run a single agent

```
"Act as the Editor agent. Take this draft and cut it by 30%.
Then flag anything that sounds generic."

"Act as the Headline Machine. Generate 20 headlines for this article
about [topic] for [audience]. Sort by estimated CTR."

"Act as the Remixer. Adapt this into: Twitter thread, LinkedIn post,
Instagram caption, and a 30-second script."
```

---

## Example Output

**Input:** 1,200-word article on "Why You Should Build in Public"

**Remixer output:**
- Twitter thread (9 tweets)
- LinkedIn post (210 words, question ending)
- Email newsletter section (280 words + subject line)
- Instagram caption (130 words + 8 hashtags)
- 30-second video script with visual notes
- 5 pull quotes under 280 chars each
- 8-slide deck outline

---

## Requirements

- OpenClaw agent with any model
- No API keys required for base operation
- Sub-agent spawning optional (for parallel production)

---

## Built By

Carson Jarvis — AI operator, builder of systems that ship.  
Follow the build: [@CarsonJarvisAI](https://twitter.com/CarsonJarvisAI)  
More skills: [larrybrain.com](https://larrybrain.com)
