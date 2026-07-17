# Open Source Project Promo Template

## Characteristics
- **Duration**: 15-30 seconds
- **Purpose**: Promote an open-source project, attract contributors and users
- **Structure**: Project Identity → Problem/Why → Key Features → Social Proof → CTA (Star/Install)
- **Target**: Developer tools, libraries, frameworks, CLI tools
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const PROJECT = {
  name: 'your-project',
  tagline: 'A short, memorable tagline',
  description: 'One sentence explaining what this does',
  logo: staticFile('logo.png'),   // optional
  language: 'TypeScript',
  license: 'MIT',
};

const BRAND = {
  bg: '#0D1117',          // GitHub dark
  surface: '#161B22',
  text: '#F0F6FC',
  accent: '#58A6FF',
  green: '#3FB950',
  muted: '#8B949E',
};

const FEATURES = [
  { icon: '🚀', title: 'Blazing Fast', desc: '10x faster than alternatives' },
  { icon: '📦', title: 'Zero Config', desc: 'Works out of the box' },
  { icon: '🔌', title: 'Plugin System', desc: 'Extensible architecture' },
];

const SOCIAL_PROOF = {
  stars: '12.5k',
  downloads: '500k/month',
  contributors: '200+',
};

const CTA = {
  primary: 'npm install your-project',
  secondary: 'github.com/org/your-project',
  badge: '⭐ Star on GitHub',
};

const TIMING = {
  fps: 30,
  identity: { start: 0, duration: 150 },     // 0-5s
  features: { start: 150, duration: 360 },    // 5-17s
  proof: { start: 510, duration: 150 },       // 17-22s
  cta: { start: 660, duration: 120 },         // 22-26s
};
```

## Scene Structure

### Scene 1: Project Identity (0-5 seconds)
**Purpose**: Establish what the project is with developer-friendly branding

**Visual Guidelines**:
- GitHub-dark aesthetic (#0D1117 background)
- Project logo centered (if available) or large monospace name
- Tagline below in lighter weight
- Language badge (e.g., "TypeScript") in top-right
- Terminal-style or code-font aesthetic

**Animation Style**:
- Logo: spring scale from 0→1 (damping: 80, stiffness: 200)
- Name: fade in + slide up 20px (staggered 10 frames after logo)
- Tagline: fade in 15 frames after name
- Language badge: slide in from right

**Layout**:
```
┌────────────────────────────────────┐
│                          [TS Badge]│
│                                    │
│           [Logo / Icon]            │
│         your-project               │
│    A short, memorable tagline      │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 2: Key Features (5-17 seconds)
**Purpose**: Show 3-4 core capabilities that make developers want to use this

**Visual Guidelines**:
- Each feature gets its own "card" moment (3-4 seconds each)
- Dark card/panel with subtle border
- Icon on left, title + description on right
- Accent color for icon and title
- Monospace font for code-related features

**Animation Pattern** (per feature):
```
Frame 0-10:  Card slides in from bottom (+30px, opacity 0→1)
Frame 10-80: Hold (content visible)
Frame 80-90: Card slides out to left (-30px, opacity 1→0)
```

**Optional Enhancement**: Show a mini code snippet for each feature
```
┌────────────────────────────────────┐
│  ┌──────────────────────────────┐  │
│  │ 🚀  Blazing Fast             │  │
│  │     10x faster than          │  │
│  │     alternatives             │  │
│  │                              │  │
│  │  bench: 1.2ms (avg)          │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

---

### Scene 3: Social Proof (17-22 seconds)
**Purpose**: Build trust with numbers

**Visual Guidelines**:
- Three stat cards in a row (horizontal layout)
- Each with a large number + label
- Use countUp animation for numbers
- Stars icon (⭐), download icon (📥), people icon (👥)
- Numbers in accent color, labels in muted text

**Animation Style**:
- Cards fade in with stagger (30 frames apart)
- Numbers count up from 0 to target (60 frames per number)
- Subtle scale pulse on each number when count completes

**Code Pattern**:
```typescript
const countUp = (frame: number, target: number, start: number, duration: number) =>
  Math.floor(target * interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }));

// Usage
const starCount = countUp(frame, 12500, 0, 60);
const displayStars = starCount >= 1000
  ? `${(starCount / 1000).toFixed(1)}k`
  : String(starCount);
```

**Layout**:
```
┌────────────────────────────────────┐
│                                    │
│   ⭐ 12.5k    📥 500k    👥 200+  │
│    Stars     Downloads  Contribs   │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 4: CTA — Install/Star (22-26 seconds)
**Purpose**: Give developers a clear, copy-paste action

**Visual Guidelines**:
- Terminal-style block with install command
- Monospace font (JetBrains Mono / Fira Code)
- Green text on dark background (terminal aesthetic)
- GitHub URL below in accent blue
- "⭐ Star on GitHub" badge

**Animation Style**:
- Terminal block slides up from bottom
- Command types out character by character (typewriter, 2 frames/char)
- Cursor blinks at end
- GitHub URL fades in below after command completes
- Star badge pulses gently

**Layout**:
```
┌────────────────────────────────────┐
│                                    │
│   $ npm install your-project █    │
│                                    │
│   github.com/org/your-project      │
│        ⭐ Star on GitHub           │
│                                    │
└────────────────────────────────────┘
```

---

## Visual Design Notes

### Developer Aesthetic
- Use GitHub dark color palette (#0D1117, #161B22, #21262D)
- Monospace fonts for commands and code
- Sans-serif for descriptive text
- Subtle border-radius (8-12px) on cards
- Box shadows: `0 4px 12px rgba(0, 0, 0, 0.4)`

### Typography
- Project name: JetBrains Mono, 64px, weight 700
- Tagline: Inter, 32px, weight 400
- Feature title: Inter, 40px, weight 600
- Feature desc: Inter, 24px, weight 400
- Stats numbers: JetBrains Mono, 56px, weight 700
- Terminal text: JetBrains Mono, 32px, weight 400

---

## Asset Requirements Checklist

### Essential
- [ ] Project name and tagline
- [ ] 3-4 key features with descriptions
- [ ] GitHub stars count (or approximate)
- [ ] Install command (npm/pip/cargo/etc.)
- [ ] Repository URL

### Optional
- [ ] Project logo (PNG/SVG, transparent)
- [ ] Download/usage statistics
- [ ] Contributor count
- [ ] Background music (lo-fi / chill, 15-30s)

---

## Quality Checklist

- [ ] Terminal commands are syntactically correct
- [ ] Stats are current and accurate
- [ ] Features are genuinely compelling (not generic)
- [ ] GitHub dark palette is consistent
- [ ] Monospace font renders correctly
- [ ] Typewriter speed is readable
- [ ] CountUp animation is smooth (no jumps)
- [ ] All constants grouped at top
- [ ] 30fps output is smooth
