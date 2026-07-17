# AST Theory

**AST = Audience-State-Transfer.**

> PPT is not an information container. PPT is an audience state-transfer artifact.

Humanize PPT exists because AI-generated decks often fail before visual rendering starts: raw material is passed directly into a slide generator, so the model's reasoning noise, explanatory habits, summary voice, and overstuffed structure leak into the final slides.

## A — Audience

Ask first:

- Who is listening?
- What do they already know?
- What do they not realize yet?
- What do they resist?
- Why would they keep listening?
- What judgment or action should they make after the deck?

## S — State

A deck should change an audience state.

```yaml
initial_state: "Before seeing the deck"
desired_state: "After seeing the deck"
core_tension: "The main cognitive resistance"
state_shift: "The transition the deck must create"
```

## T — Transfer

Transfer is not a table of contents. It is the audience's psychological path.

```yaml
transfer_path:
  - role: hook
    purpose: grab attention
  - role: conflict
    purpose: break the old frame
  - role: method
    purpose: explain the new frame
  - role: proof
    purpose: build trust with evidence / demo
  - role: takeaway
    purpose: leave a portable judgment
```

## Experience sources

AST abstracts lessons from several operating styles:

- **Karpathy-style structure**: explicit assumptions, small viable structures, and verifiable implementation paths.
- **Jobs-style presentation**: first-screen clarity, ruthless hierarchy, taste, and subtraction.
- **Musk-style propagation**: tension, screenshot value, memetic hooks, and public discussion energy.
- **Garry Tan / YC Office Hours**: real user need, narrow wedge, falsifiable assumptions, and product value.
- **Humanizer / humanizer-zh**: remove AI writing traces, filler phrases, fake significance, and mechanical rhythm.
- **Carl's PPT testing practice**: AI PPTs often look finished but fail because they do not know what the presenter is trying to make the audience feel, understand, and do.

## Acceptance test

A Humanize PPT outline is valid only if it answers:

1. Who is the audience?
2. What is the initial state?
3. What is the desired state?
4. What is the core tension?
5. How does each slide move the state forward?
6. Which renderer / adapter should complete the job?
