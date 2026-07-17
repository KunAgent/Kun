---
name: tarot-reading
description: |
  A tarot reading and interpretation tool, part of the fortune-telling-skills suite.
  Based on the Rider-Waite-Smith system, it supports upright and reversed readings for all 78 cards
  (Major and Minor Arcana), with spreads including Three-Card, Celtic Cross, Relationship, and more.
  Combines randomized card draws with deep LLM interpretation to deliver symbolic insight and
  actionable guidance for your specific question.
  Trigger phrases: tarot, tarot reading, draw a card, card spread, pull cards, daily card, tarot spread.
  Not suitable for: astrology, numerology, BaZi → defer to those skills.
license: MIT
---

# Tarot Reading Interpreter

Based on the Rider-Waite-Smith system, this skill draws randomly from a complete 78-card deck and delivers a deep symbolic reading that weaves together card meanings, positional context, and your specific question — offering both insight and actionable guidance.

## Quick Start

```
"Draw me a tarot card"
"Tarot reading — I have a question about love"
"Read my career with a Celtic Cross spread"
"I'm torn about whether to change jobs — pull three cards for me"
"Daily card"
```

**Full Example** (Three-Card Spread):

Input: `I'm struggling with whether to break up with my boyfriend — can you pull three cards?`

Output:

> # 🃏 Three-Card Tarot Spread — A Decision in Love
>
> ## Cards Drawn
>
> | Position | Card | Orientation |
> |----------|------|-------------|
> | Past | Three of Wands | Upright 🔥 |
> | Present | The Moon | Reversed 🌙 |
> | Future | Page of Pentacles | Upright 🪙 |
>
> ## Card-by-Card Reading
>
> ### Past: Three of Wands — Upright
> The Three of Wands upright shows someone standing on a hilltop, gazing out toward the horizon — this relationship once carried real hope and a spirit of adventure. You planned a direction together, and that excitement, that willingness to set sail, was genuine.
>
> ### Present: The Moon — Reversed
> The Moon reversed suggests the fog is beginning to lift. The confusion, insecurity, and blurred signals that made it so hard to see clearly are now rising to the surface. You are already starting to face the answers you've been quietly avoiding.
>
> ### Future: Page of Pentacles — Upright
> The Page of Pentacles represents grounded, practical new beginnings in the material world. Whatever choice you make, the cards point toward a next chapter centered on self-growth and real, actionable steps — a version of you who moves forward with both feet on the ground.
>
> ## Synthesis
> These three cards trace an arc from "setting out with genuine hope," through "a present tangled in confusion and emerging truth," to "a clear-eyed, grounded next step." The Moon reversed is not a warning — it's the moment you finally become honest with yourself. The Page of Pentacles waiting at the end is a steadier, wiser you.
>
> ## Action Steps
> - Give yourself uninterrupted quiet time to write down what you truly feel — no conclusions required
> - Observe the ratio of what you give versus what you receive in this relationship; the data is often more honest than the feeling
>
> ---
> *Tarot offers insight at the level of symbol and meaning. The choice is always, and entirely, yours.*

## User Context

Tarot readings do **not** require personal information like birthdays — every reading is in the moment.

**Read**: Before running a reading, check in order:
1. This skill's `MEMORY.md` — any stored user preferences (e.g., preferred spread, common topics)
2. The fortune-consultant agent's broader context (if it exists) — no need for basic profile fields, just check for relevant preferences

If preference data is available, incorporate it naturally. Do not ask again.

**Write**: Only write to this skill's `MEMORY.md` when the user **explicitly asks** to save a preference:

```markdown
# User Info

## Reading Preferences
- Preferred spread: Celtic Cross
- Common topics: love, career
```

Entirely optional.

**Update**: When the user asks to change a preference, update the relevant field in `MEMORY.md`.

## Workflow

### Step 1: Parse User Intent

Identify from the user's input:

| Parameter | Parsing Rule | Default |
|-----------|-------------|---------|
| Question / Topic | Stated explicitly, or ask to clarify | General (no specific question is fine) |
| Spread | User-specified, or recommended based on question | Three-Card |
| Card Count | Determined by spread | 3 |

**Spread Recommendation Rules**:

| Scenario | Recommended Spread | Cards |
|----------|--------------------|-------|
| Daily guidance / simple question | Single Card | 1 |
| Yes/no / quick question / unspecified | Three-Card (Past–Present–Future) | 3 |
| Love / relationship question | Relationship Spread | 5 |
| Deep dive / complex situation | Celtic Cross | 10 |
| Two options / decision | Three-Card variant (Option A–Option B–Advice) | 3 |

If the user hasn't specified a spread or a clear question, ask:

> "What area would you like to explore? Love, career, finances — or something else entirely? You can also just say 'daily card' ✨"

### Step 2: Draw Cards

Load the card reference files [references/major-arcana.md](references/major-arcana.md) and [references/minor-arcana.md](references/minor-arcana.md).

**Drawing Rules**:
1. Draw the required number of cards randomly from the full 78-card deck — no repeats
2. Determine upright or reversed independently for each card (50/50 probability)
3. Place each card in its assigned position in the spread

**The draw should feel ceremonial.** Display format:

```
🃏 Shuffling...

Cards drawn:
Position 1 (Past): Three of Wands — Upright 🔥
Position 2 (Present): The Moon — Reversed 🌙
Position 3 (Future): Page of Pentacles — Upright 🪙
```

### Step 3: Card-by-Card Reading

Load [references/spreads.md](references/spreads.md) and [references/interpretation-rules.md](references/interpretation-rules.md).

Each card reading integrates three dimensions:

1. **Card Meaning**: Upright / reversed keywords and deeper symbolism
2. **Positional Meaning**: What this position represents within the spread
3. **Question Connection**: How the card speaks to the querent's specific situation

### Step 4: Synthesis

Analyze how the cards interact with one another:

- **Elemental Interaction**: Fire + Air (supportive), Fire + Water (conflicting), etc. — the overall energetic tone
- **Repeated Numbers**: Multiple cards sharing a number = that theme is being emphasized
- **Major vs. Minor Arcana Ratio**: Mostly Major → significant life shift; Mostly Minor → everyday, manageable matters
- **Dominant Suit**: Mostly Wands → action is key; Mostly Cups → emotions are at the center; Mostly Swords → thought and conflict; Mostly Pentacles → the material and the practical
- **Overall Narrative**: Weave all cards into a single, coherent story

### Step 5: Action Steps

Based on the synthesis, offer 2–3 specific, actionable steps.

## Output Format

### Single Card

```markdown
# 🃏 Daily Card

## {Card Name} — {Upright/Reversed} {element icon}

[Core card meaning — 2–3 sentences]

### Today's Insight
[Direction for the day based on the card — 2–3 sentences]

> 💡 Action Step: [One concrete, specific suggestion]
```

### Three-Card Spread

```markdown
# 🃏 Three-Card Tarot Spread — {Question / Topic}

## Cards Drawn

| Position | Card | Orientation |
|----------|------|-------------|
| Past | {Card Name} | {Upright/Reversed} |
| Present | {Card Name} | {Upright/Reversed} |
| Future | {Card Name} | {Upright/Reversed} |

## Card-by-Card Reading

### Past: {Card Name} — {Upright/Reversed}
[2–3 sentences connecting positional meaning to the question]

### Present: {Card Name} — {Upright/Reversed}
[2–3 sentences]

### Future: {Card Name} — {Upright/Reversed}
[2–3 sentences]

## Synthesis
[3–4 sentences weaving the three cards into an overall narrative]

## Action Steps
- [Step 1]
- [Step 2]

---
*Tarot offers insight at the level of symbol and meaning. The choice is always, and entirely, yours.*
```

### Celtic Cross (10 Cards)

```markdown
# 🃏 Celtic Cross Spread — {Question / Topic}

## Cards Drawn

| Position | Meaning | Card | Orientation |
|----------|---------|------|-------------|
| 1 | Present Situation (Core) | {Card Name} | {Upright/Reversed} |
| 2 | Crossing Influence (Challenge / Aid) | {Card Name} | {Upright/Reversed} |
| 3 | Foundation (Subconscious / Root) | {Card Name} | {Upright/Reversed} |
| 4 | Recent Past | {Card Name} | {Upright/Reversed} |
| 5 | Possible Best Outcome | {Card Name} | {Upright/Reversed} |
| 6 | Near Future | {Card Name} | {Upright/Reversed} |
| 7 | Self-Perception (Your Attitude) | {Card Name} | {Upright/Reversed} |
| 8 | External Environment (Others / Surroundings) | {Card Name} | {Upright/Reversed} |
| 9 | Hopes and Fears | {Card Name} | {Upright/Reversed} |
| 10 | Final Outcome | {Card Name} | {Upright/Reversed} |

## Card-by-Card Reading

[All 10 positions read individually — 2–3 sentences each, integrating positional meaning and the card]

## Synthesis
[5–6 sentences of deep narrative — overall trajectory, key turning points, tensions worth watching]

## Action Steps
- [Step 1]
- [Step 2]
- [Step 3]

---
*Tarot offers insight at the level of symbol and meaning. The choice is always, and entirely, yours.*
```

## Generation Rules

### Randomness

- Cards must be drawn randomly from the full 78-card deck — **never hand-pick "appropriate" cards**
- Upright/reversed is determined independently at random; do not artificially balance the ratio
- No card may appear more than once in a single spread

### Tone & Style

Default to **symbolic-narrative** — both evocative and grounded:

- Use invitational language: "This card invites you to consider...", "The card suggests..."
- Hold both sides: "While this phase may feel disorienting, The Moon reversed also signals that the fog is beginning to clear"
- Bridge symbol to life: move from symbolic language into concrete, lived experience
- Honor free will: "The cards reflect the current flow of energy — the choice is always, and entirely, yours"

**Prohibited Expressions**:

| Never Say | Say Instead |
|-----------|-------------|
| ❌ "You are destined to..." | ✅ "The cards suggest a tendency toward..." |
| ❌ "The Death card means you will die" | ✅ "Death symbolizes the end of one chapter and the birth of the next" |
| ❌ "The Tower means disaster is coming" | ✅ "The Tower suggests that structures no longer serving you are being cleared away" |
| ❌ "You must follow what the cards say" | ✅ "The cards offer one perspective worth reflecting on" |

Absolutely prohibited: fear-based language, fatalistic declarations, predictions of death or illness, upselling of spiritual services.

### Special Card Handling

| Card | Handling Principle |
|------|-------------------|
| Death (XIII) | Always emphasize "transformation and rebirth" — never literal death |
| The Tower (XVI) | Emphasize "necessary dismantling of old structures" — do not induce panic |
| The Devil (XV) | Emphasize "recognizing what binds you" — guide toward self-reflection |
| Ten of Swords | Acknowledge the pain, then emphasize "hitting bottom means the turn is coming" |

## Error Handling

| Scenario | Response |
|----------|----------|
| User doesn't know what to ask | "No specific question? That's totally fine! Try a 'daily card' and see what the universe wants to say today ✨" |
| User wants to redraw (unhappy with results) | "In tarot, the first cards drawn carry the most meaning. But if you'd like to reframe your question, we can do another reading 🃏" |
| User asks about astrology / BaZi / numerology | "That question is better served by a different system — defer to BaZi (cantian-bazi), ZiWei (ziwei-doushu), or the综合命理 skill (fortune-master)" |
| User is worried about a negative card | "There are no truly 'bad' cards in tarot. Every card carries wisdom — even the challenging ones are pointing you toward growth" |
| User asks about health / life or death | "Tarot is not appropriate for medical guidance and should never be used that way. If you have health concerns, please consult a qualified medical professional 🏥" |

## When Not to Use This Skill

Do **not** invoke this skill for:

- **Astrology / horoscopes** → fortune-master (Western astrology framework)
- **Numerology** → fortune-master (numerology-framework)
- **BaZi / Zi Wei Dou Shu / Feng Shui** → cantian-bazi / ziwei-doushu / fortune-master
- **Medical / legal / financial professional advice** → this skill is for self-exploration only and does not replace professional services

## Language & Localization

Always detect and respond in the user's language.

**English:**
- Symbolic narrative tone — mystical yet grounded
- Invitation-style phrasing: "This card invites you to consider..."
- Balance honesty with hope: "While this phase may feel unsettling, the reversed Moon also signals that the fog is clearing"
- Card-to-life bridging: move from symbolic language to concrete situations
- Honor free will: "The cards illuminate the current energy flow — the final choice is always yours"

**中文:**
- 象征叙事型语气 — 神秘但落地
- 邀请式表达："这张牌邀请你思考..."
- 正反兼顾："虽然这个阶段可能感到困惑，但月亮逆位同时意味着迷雾正在消散"
- 牌面→生活桥接：从象征语言过渡到具体情境
- 尊重自由意志："牌面展示的是当前能量的流向，最终的选择权始终在你手中"
- 禁用："你注定会...""死神牌意味着死亡""必须听从牌的指示"

## Atomic Design

This skill handles one and only one capability: **tarot card reading and interpretation**. It does not include astrology, BaZi, numerology, or any other divination system. For other domains, defer to the sibling skills in the fortune-consultant plugin.

## Disclaimer

Tarot readings are rooted in symbolic tradition and offer a lens for reflection and self-exploration — not prediction or professional advice. The decision is always, and entirely, yours.
