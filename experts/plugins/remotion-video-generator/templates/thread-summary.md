# Thread / Tweet Summary Template

## Characteristics
- **Duration**: 20-45 seconds
- **Purpose**: Convert a Twitter/X thread or long-form post into a visual video summary
- **Structure**: Thread Title → Key Points Sequence → Takeaway → CTA (Follow/Read More)
- **Target**: Twitter/X threads, blog post summaries, LinkedIn carousels, newsletter highlights
- **FPS**: 30
- **Resolution**: 1920x1080 (landscape) or 1080x1920 (vertical/stories)

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const THREAD = {
  author: '@yourhandle',
  authorName: 'Your Name',
  avatar: staticFile('avatar.png'),   // optional
  title: 'I spent 6 months building a SaaS. Here\'s what I learned.',
  points: [
    {
      number: 1,
      headline: 'Start with distribution',
      body: 'Build your audience before you build your product. I had 5k followers before writing a single line of code.',
    },
    {
      number: 2,
      headline: 'Charge from day one',
      body: 'Free users give you vanity metrics. Paying users give you real feedback.',
    },
    {
      number: 3,
      headline: 'Ship weekly',
      body: 'A weekly cadence forces you to prioritize ruthlessly. Small wins compound.',
    },
    {
      number: 4,
      headline: 'Talk to users daily',
      body: '15-minute calls taught me more than any analytics dashboard.',
    },
  ],
  takeaway: 'Build in public, charge early, ship often, and talk to your users every single day.',
  cta: 'Follow @yourhandle for more',
  threadUrl: 'x.com/yourhandle/status/123456',
};

const BRAND = {
  bg: '#15202B',          // Twitter dark
  surface: '#192734',
  text: '#E7E9EA',
  muted: '#71767B',
  accent: '#1D9BF0',
  numberColor: '#1D9BF0',
  cardBg: '#1E2732',
  cardBorder: '#2F3336',
};

const TIMING = {
  fps: 30,
  intro: { start: 0, duration: 120 },        // 0-4s
  points: { perPoint: 180 },                   // 6s each
  takeaway: { duration: 150 },                 // 5s
  cta: { duration: 90 },                       // 3s
};
```

## Scene Structure

### Scene 1: Thread Introduction (0-4 seconds)
**Purpose**: Establish the thread author and topic

**Visual Guidelines**:
- Twitter/X dark theme background
- Author avatar (circular, 80px) + name + handle
- Thread title as large text below author info
- "Thread" or "🧵" indicator
- Mimics the look of an actual tweet card

**Animation Style**:
- Author info slides in from top (20 frames)
- Title fades in below (staggered 15 frames)
- Thread indicator pulses once
- Optional: tweet card border appears

**Layout**:
```
┌────────────────────────────────────┐
│                                    │
│   [Avatar] Your Name               │
│            @yourhandle · 🧵        │
│                                    │
│   I spent 6 months building a      │
│   SaaS. Here's what I learned.     │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 2: Key Points Sequence (4-28 seconds, variable)
**Purpose**: Present each key point from the thread

**Visual Guidelines**:
- One point at a time, full attention
- Large number indicator (1, 2, 3...) in accent color
- Headline in bold (40-48px)
- Body text below in regular weight (28-32px)
- Card-style container with subtle border
- Progress indicator at bottom (dots or bar)

**Per-Point Animation**:
```
Frame 0-15:   Number springs in (scale 0→1)
Frame 10-25:  Headline slides in from right
Frame 20-35:  Body text fades in
Frame 35-150: Hold for reading
Frame 150-165: Everything fades out together
Frame 165-180: Transition pause (15 frames gap)
```

**Code Pattern**:
```typescript
const pointAnimation = (frame: number, pointIndex: number) => {
  const pointStart = TIMING.intro.duration + pointIndex * TIMING.points.perPoint;
  const localFrame = frame - pointStart;

  const numberScale = spring({
    frame: localFrame,
    fps: 30,
    config: { damping: 80, stiffness: 300 },
  });

  const headlineX = interpolate(localFrame, [10, 25], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bodyOpacity = interpolate(localFrame, [20, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const exitOpacity = interpolate(localFrame, [150, 165], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return { numberScale, headlineX, bodyOpacity, exitOpacity };
};
```

**Progress Indicator**:
```typescript
// Dot indicator showing current point
const ProgressDots = ({ current, total }: { current: number; total: number }) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} style={{
        width: i === current ? 24 : 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: i === current ? BRAND.accent : BRAND.muted,
        transition: 'width 0.3s',
      }} />
    ))}
  </div>
);
```

---

### Scene 3: Takeaway (28-33 seconds)
**Purpose**: Summarize the thread in one powerful sentence

**Visual Guidelines**:
- Larger font (40-52px), centered
- Accent color or gradient text
- Quote marks or special formatting
- Clean background (no card container)
- Optional: subtle background pattern

**Animation Style**:
- Text fades in word by word (or line by line)
- Slight scale animation (0.95→1.0)
- Hold for reading
- Optional: underline or highlight key phrase

---

### Scene 4: CTA (33-36 seconds)
**Purpose**: Drive followers or link clicks

**Visual Guidelines**:
- Author avatar + handle again
- "Follow for more" text
- Thread URL (small, bottom)
- Twitter/X blue accent

**Animation Style**:
- Avatar springs in from center
- Text fades in below
- Follow badge pulses gently

---

## Vertical Format (1080x1920)

For Instagram Stories / TikTok / YouTube Shorts:

```typescript
const VERTICAL_CONFIG = {
  width: 1080,
  height: 1920,
  // Stack layout instead of side-by-side
  // Larger font sizes for mobile viewing
  headlineSize: 52,
  bodySize: 36,
  numberSize: 72,
  // More padding
  padding: 60,
};
```

**Vertical Layout**:
```
┌──────────────────┐
│                   │
│   [Avatar] @user  │
│                   │
│      ┌─────┐     │
│      │  1  │     │
│      └─────┘     │
│                   │
│   Start with      │
│   distribution    │
│                   │
│   Build your      │
│   audience before │
│   you build your  │
│   product.        │
│                   │
│   ● ○ ○ ○        │
│                   │
└──────────────────┘
```

---

## Asset Requirements Checklist

### Essential
- [ ] Thread content (4-8 key points with headlines and bodies)
- [ ] Author name and handle
- [ ] Takeaway/summary sentence
- [ ] CTA text

### Optional
- [ ] Author avatar image (square, 200x200+)
- [ ] Thread URL
- [ ] Background music (lo-fi / chill, matches thread length)

---

## Quality Checklist

- [ ] Text fits within safe margins (no cut-off)
- [ ] Reading time per point is sufficient (3-6 seconds)
- [ ] Number indicators are consistent and clear
- [ ] Progress dots update correctly
- [ ] Takeaway is actually insightful (not just restating points)
- [ ] Author info is correct
- [ ] Constants grouped at top
- [ ] Vertical format tested if targeting stories/shorts
