# Product Launch Announcement Template

## Characteristics
- **Duration**: 10-15 seconds
- **Purpose**: Create buzz for a new product or major feature release
- **Structure**: Hook → Selling Points → Before/After → CTA
- **Target**: SaaS products, developer tools, startups, tech launches
- **FPS**: 60 (high-end feel)
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const BRAND = {
  bg: '#0A0A0A',
  text: '#FAFAFA',
  accent: '#3B82F6',
  accentGlow: 'rgba(59, 130, 246, 0.3)',
  gradient: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
};

const CONTENT = {
  hook: 'Your one-line hook text here',
  sellingPoints: [
    { icon: '⚡', text: '10x Faster Processing' },
    { icon: '🔒', text: 'Enterprise-Grade Security' },
    { icon: '🌍', text: 'Global CDN Built-in' },
  ],
  before: 'Manual, error-prone process',
  after: 'Automated, reliable pipeline',
  cta: 'Join the waitlist → product.com',
  ctaSub: 'Free during beta',
};

const TIMING = {
  fps: 60,
  hook: { start: 0, duration: 120 },       // 0-2s
  points: { start: 120, duration: 300 },    // 2-7s
  compare: { start: 420, duration: 180 },   // 7-10s
  cta: { start: 600, duration: 120 },       // 10-12s
};
```

## Scene Structure

### Scene 1: Hook (0-2 seconds)
**Purpose**: Stop the scroll with a bold, provocative statement

**Visual Guidelines**:
- Pure black background (#0A0A0A)
- Single line of large white text, centered
- Maximum font size (72-96px), bold weight (800)
- No distractions — zero other elements on screen
- Subtle noise/grain texture on background (optional)

**Animation Style**:
- Typewriter effect: characters appear left-to-right (2-3 frames per character)
- Light spring bounce on complete text (scale 1.0 → 1.02 → 1.0)
- Optional: faint cursor blink during typing
- Crossfade out over last 15 frames

**Content Writing**:
- Use a question or bold claim
- Examples: "What if deploys took 3 seconds?", "We rebuilt everything.", "Meet the future of [X]"
- Maximum 8 words

---

### Scene 2: Selling Points (2-7 seconds)
**Purpose**: Rapid-fire value props that establish credibility

**Visual Guidelines**:
- Dark background with subtle gradient shift
- Each selling point on its own "card" or line
- Icon/emoji on the left, text on the right
- Key numbers or words highlighted in accent color
- Each point visible for ~1.5 seconds

**Animation Style**:
```
Point 1: Frame 120-180  — slide in from right + fade
Point 2: Frame 210-270  — slide in from right + fade
Point 3: Frame 300-360  — slide in from right + fade
```
- Stagger delay: 90 frames (1.5s @ 60fps)
- Each slides in from +40px right with opacity 0→1
- Previous point remains visible but dims slightly (opacity 1→0.5)
- Final state: all 3 visible with the last one brightest

**Layout**:
```
┌────────────────────────────────────┐
│                                    │
│      ⚡  10x Faster Processing     │
│      🔒  Enterprise Security       │
│      🌍  Global CDN Built-in       │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 3: Before/After Comparison (7-10 seconds)
**Purpose**: Visceral contrast that makes the value undeniable

**Visual Guidelines**:
- Split screen: left = "Before" (muted, desaturated), right = "After" (vibrant, accent color)
- Vertical divider line in center (accent color, 2px)
- "BEFORE" / "AFTER" labels above each half
- Before side: red/gray tones, smaller text
- After side: brand accent, larger text, optional glow

**Animation Style**:
- Divider line draws from top to bottom (30 frames)
- Left side text fades in (15 frames after divider starts)
- Right side text springs in (15 frames after left)
- Right side gets a subtle glow pulse

**Code Pattern**:
```typescript
const dividerHeight = interpolate(frame, [0, 30], [0, 100], {
  extrapolateRight: 'clamp',
});

const beforeOpacity = interpolate(frame, [15, 30], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

const afterScale = spring({
  frame: frame - 30,
  fps: 60,
  config: { damping: 100, stiffness: 200 },
});
```

---

### Scene 4: CTA (10-12 seconds)
**Purpose**: Clear next action with urgency

**Visual Guidelines**:
- Clean background (solid or subtle gradient)
- Large CTA text (48-64px, bold)
- URL or action below (32px)
- Optional "Free during beta" badge
- Accent color button/highlight

**Animation Style**:
- Fade in from center (scale 0.9→1.0)
- Subtle continuous pulse on CTA (scale oscillates 1.0→1.03→1.0)
- Duration: 120 frames (2 seconds)

---

## Visual Design Notes

### Particle Background (Optional)
- Very subtle: 20-30 tiny dots floating slowly
- Low opacity (0.1-0.2)
- Should NOT compete with text
- Disable if text readability is affected

### Typography
- Heading: Inter/Geist, 72-96px, weight 800
- Selling points: Inter/Geist, 36-48px, weight 600
- CTA: Inter/Geist, 48-64px, weight 700
- Sub-text: Inter/Geist, 24-28px, weight 400

### Color Strategy
- Primarily monochrome (black/white) with ONE accent color
- Accent used sparingly for emphasis (key words, dividers, buttons)
- Never more than 2 accent colors

---

## Timing Guidelines

### Standard (12 seconds @ 60fps = 720 frames)
| Scene | Time | Frames | Notes |
|-------|------|--------|-------|
| Hook | 0-2s | 0-120 | Bold text, typewriter |
| Points | 2-7s | 120-420 | 3 items, staggered |
| Compare | 7-10s | 420-600 | Split screen |
| CTA | 10-12s | 600-720 | Call to action |

### Quick (8 seconds @ 60fps = 480 frames)
| Scene | Time | Frames | Notes |
|-------|------|--------|-------|
| Hook | 0-1.5s | 0-90 | Faster type |
| Points | 1.5-5s | 90-300 | 2 items only |
| CTA | 5-8s | 300-480 | Extended hold |

---

## Asset Requirements Checklist

### Essential
- [ ] Brand colors (hex codes)
- [ ] Product name
- [ ] Hook text (one compelling line)
- [ ] 3 selling points with icons
- [ ] CTA URL or action

### Optional
- [ ] Product logo (PNG, transparent)
- [ ] Before/after data or descriptions
- [ ] Background music (10-15s, energetic)

---

## Quality Checklist

- [ ] All text readable at 1080p
- [ ] Accent color used consistently (not overused)
- [ ] Typewriter speed matches reading pace
- [ ] Stagger timing feels natural (not robotic)
- [ ] Before/After contrast is clear
- [ ] CTA is prominent and actionable
- [ ] Total duration 10-15 seconds
- [ ] 60fps output is smooth
- [ ] Constants are properly grouped at top
