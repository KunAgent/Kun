# Before/After Comparison Template

## Characteristics
- **Duration**: 10-20 seconds
- **Purpose**: Show a dramatic transformation, improvement, or contrast
- **Structure**: Context Setup → Before State → Transition → After State → Summary
- **Target**: Product improvements, design revamps, performance upgrades, process changes
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const COMPARISON = {
  title: 'The Transformation',
  before: {
    label: 'BEFORE',
    headline: 'Manual deployment pipeline',
    details: ['40 minutes per deploy', '3 failure points', 'Zero rollback'],
    image: staticFile('before.png'),  // optional screenshot
    mood: 'negative',  // affects color treatment
  },
  after: {
    label: 'AFTER',
    headline: 'Automated CI/CD with YourTool',
    details: ['90 seconds per deploy', 'Zero-downtime', 'Instant rollback'],
    image: staticFile('after.png'),   // optional screenshot
    mood: 'positive',
  },
  summary: 'From 40 minutes to 90 seconds. That\'s a 26x improvement.',
};

const BRAND = {
  bg: '#0F172A',
  text: '#F1F5F9',
  beforeBg: '#1E1E2E',
  beforeAccent: '#EF4444',
  beforeMuted: '#6B7280',
  afterBg: '#0F2A1F',
  afterAccent: '#10B981',
  afterGlow: 'rgba(16, 185, 129, 0.2)',
  divider: '#3B82F6',
};

const TIMING = {
  fps: 30,
  context: { start: 0, duration: 60 },        // 0-2s
  before: { start: 60, duration: 150 },        // 2-7s
  transition: { start: 210, duration: 60 },    // 7-9s
  after: { start: 270, duration: 150 },        // 9-14s
  summary: { start: 420, duration: 90 },       // 14-17s
};

const LAYOUT = {
  style: 'split',  // 'split' | 'slider' | 'sequential' | 'overlay'
};
```

## Scene Structure

### Scene 1: Context Setup (0-2 seconds)
**Purpose**: Frame the comparison — what are we looking at?

**Visual Guidelines**:
- Title text centered, large (48-64px)
- Subtitle or context (24-32px, muted)
- Dark, neutral background
- Optional category icon/badge

**Animation Style**:
- Fade in with slight scale (0.95→1.0)
- Hold briefly, then fade to split view

---

### Scene 2: Before State (2-7 seconds)
**Purpose**: Show the "old" state — the pain, the problem, the ugly

**Visual Guidelines**:
- Left half of screen (or full screen if sequential layout)
- Muted, desaturated color palette (grays, reds)
- "BEFORE" label prominently displayed
- Screenshot or description of the old state
- Pain points listed with red/negative indicators (X marks, red dots)
- Overall "tired" aesthetic — slightly darker, lower contrast

**Animation Style**:
- Slide in from left (or fade in)
- Pain points appear one by one (staggered 30 frames)
- Each pain point has a red "X" or down-arrow that pops in
- Optional: slight shake or distortion effect

**Code Pattern**:
```typescript
// Desaturation filter for "before" mood
const beforeFilter = 'saturate(0.5) brightness(0.8)';

// Pain point animation
const painPointAnimation = (frame: number, index: number) => {
  const startFrame = 60 + index * 30;
  return {
    opacity: interpolate(frame, [startFrame, startFrame + 15], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    transform: `translateX(${interpolate(frame, [startFrame, startFrame + 15], [-20, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })}px)`,
  };
};
```

---

### Scene 3: Transition (7-9 seconds)
**Purpose**: The dramatic reveal moment — the shift from old to new

**Transition Options**:

#### Option A: Slider Wipe
```typescript
// A vertical line sweeps from left to right, revealing the "after" behind
const sliderPosition = interpolate(frame, [210, 270], [0, 100], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

// Before side: clip from left to slider position
// After side: clip from slider position to right
```

#### Option B: Split Expand
```typescript
// "After" panel expands from center, pushing "before" out
const afterWidth = interpolate(frame, [210, 270], [0, 100], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});
```

#### Option C: Flash/Pulse
```typescript
// White flash, then reveal
const flashOpacity = interpolate(frame, [210, 220, 230], [0, 1, 0], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```

#### Option D: Morph
- Before details smoothly transform into after details
- Numbers count from old value to new value
- Color shifts from red to green

---

### Scene 4: After State (9-14 seconds)
**Purpose**: Show the "new" state — the improvement, the solution, the beautiful

**Visual Guidelines**:
- Right half of screen (or full screen if sequential)
- Vibrant, saturated color palette (greens, blues)
- "AFTER" label prominently displayed
- Screenshot or description of the new state
- Benefits listed with green/positive indicators (checkmarks, green dots)
- Overall "fresh" aesthetic — brighter, higher contrast, optional glow

**Animation Style**:
- Spring animation for entry (bouncy, energetic)
- Benefits appear one by one with checkmarks
- Green glow effect on key metrics
- Optional: subtle particle/confetti burst

**Code Pattern**:
```typescript
// Glow effect for "after" highlights
const afterGlow = {
  textShadow: `0 0 20px ${BRAND.afterGlow}, 0 0 40px ${BRAND.afterGlow}`,
};

// Benefit animation
const benefitAnimation = (frame: number, index: number) => {
  const startFrame = 270 + index * 30;
  const progress = spring({
    frame: frame - startFrame,
    fps: 30,
    config: { damping: 80, stiffness: 200 },
  });
  return {
    opacity: progress,
    transform: `translateX(${(1 - progress) * 20}px) scale(${0.9 + progress * 0.1})`,
  };
};
```

---

### Scene 5: Summary (14-17 seconds)
**Purpose**: Quantify the improvement with a memorable metric

**Visual Guidelines**:
- Full screen, centered
- Large comparison metric (e.g., "40 min → 90 sec")
- Improvement percentage or multiplier ("26x faster")
- Brand name/CTA below

**Animation Style**:
- Old number appears, then morphs/counts to new number
- "26x" zooms in with spring animation
- Hold for emphasis
- CTA fades in below

---

## Layout Variants

### Split (Default)
```
┌──────────────┬──────────────┐
│              │              │
│   BEFORE     │    AFTER     │
│              │              │
│  • Pain 1    │  ✓ Benefit 1 │
│  • Pain 2    │  ✓ Benefit 2 │
│  • Pain 3    │  ✓ Benefit 3 │
│              │              │
└──────────────┴──────────────┘
```

### Sequential
```
[Full screen: BEFORE] → transition → [Full screen: AFTER]
```

### Slider
```
┌────────[slider]────────────┐
│  BEFORE  |  AFTER          │
│          |                 │
└────────────────────────────┘
(slider sweeps left to right)
```

### Overlay
```
[Before image underneath]
[After image on top, opacity reveals from 0→1]
```

---

## Asset Requirements Checklist

### Essential
- [ ] Before state description (headline + 2-3 pain points)
- [ ] After state description (headline + 2-3 benefits)
- [ ] Summary metric or improvement statement
- [ ] Brand colors

### Optional
- [ ] Before/after screenshots (matched framing)
- [ ] Product logo
- [ ] CTA URL
- [ ] Background music (15-20s, building/positive)

---

## Quality Checklist

- [ ] "Before" genuinely looks/feels worse (muted colors, negative indicators)
- [ ] "After" genuinely looks/feels better (vibrant colors, positive indicators)
- [ ] Contrast between states is obvious and dramatic
- [ ] Transition moment is satisfying
- [ ] Summary metric is accurate and impactful
- [ ] Not misleading or unfair comparison
- [ ] Constants grouped at top
- [ ] Timing allows reading all content
