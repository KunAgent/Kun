# Release / Version Update Announcement Template

## Characteristics
- **Duration**: 15-30 seconds
- **Purpose**: Announce a software release, version update, or changelog highlights
- **Structure**: Version Badge → What's New List → Key Highlight → Upgrade CTA
- **Target**: Software releases, library updates, app store updates, changelog videos
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const RELEASE = {
  version: 'v3.0.0',
  codename: 'Phoenix',         // optional
  date: 'February 2026',
  type: 'major',               // 'major' | 'minor' | 'patch'
  tagline: 'The biggest update yet',
};

const CHANGES = {
  features: [
    { icon: '✨', text: 'Real-time collaboration', tag: 'NEW' },
    { icon: '⚡', text: '3x faster build times', tag: 'IMPROVED' },
    { icon: '🎨', text: 'New dark mode theme', tag: 'NEW' },
  ],
  fixes: [
    { text: 'Fixed memory leak in long sessions' },
    { text: 'Resolved auth timeout issues' },
  ],
  breaking: [
    { text: 'Dropped Node.js 16 support' },
  ],
};

const HIGHLIGHT = {
  title: 'Real-time Collaboration',
  description: 'Work together with your team in real-time. See cursors, edits, and comments as they happen.',
  image: staticFile('collab-demo.png'),  // optional
};

const BRAND = {
  bg: '#09090B',
  surface: '#18181B',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  accent: '#8B5CF6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  tagNew: '#8B5CF6',
  tagImproved: '#3B82F6',
  tagFixed: '#22C55E',
  tagBreaking: '#EF4444',
};

const TIMING = {
  fps: 30,
  badge: { start: 0, duration: 90 },          // 0-3s
  whatsnew: { start: 90, duration: 390 },      // 3-16s
  highlight: { start: 480, duration: 210 },    // 16-23s
  cta: { start: 690, duration: 90 },           // 23-26s
};
```

## Scene Structure

### Scene 1: Version Badge (0-3 seconds)
**Purpose**: Create excitement with the version number reveal

**Visual Guidelines**:
- Large version number centered (72-96px, monospace, bold)
- Codename below (if applicable, 32px)
- Release date small text (20px, muted)
- Type badge: "MAJOR RELEASE" / "MINOR UPDATE" / "PATCH"
- Dark background with subtle radial gradient from center

**Animation Style**:
- Version number: typewriter or spring scale (dramatic reveal)
- For major releases: particle burst / glow effect behind version number
- Codename fades in after version
- Type badge slides in from side

**Major Release Effect**:
```typescript
// Glow pulse on version reveal
const glowSize = spring({
  frame,
  fps: 30,
  config: { damping: 50, stiffness: 100 },
});

const versionGlow = {
  textShadow: `
    0 0 ${20 * glowSize}px ${BRAND.accent},
    0 0 ${40 * glowSize}px ${BRAND.accent},
    0 0 ${60 * glowSize}px rgba(139, 92, 246, 0.3)
  `,
};
```

**Layout**:
```
┌────────────────────────────────────┐
│                                    │
│          [MAJOR RELEASE]           │
│                                    │
│             v3.0.0                 │
│            "Phoenix"               │
│                                    │
│          February 2026             │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 2: What's New List (3-16 seconds)
**Purpose**: Show the changelog highlights categorized by type

**Visual Guidelines**:
- Three sections: Features (NEW), Improvements, Fixes
- Each item has: colored tag badge, icon, description text
- Tags: [NEW] purple, [IMPROVED] blue, [FIXED] green, [BREAKING] red
- Items appear sequentially with stagger
- Changelog-style layout (like GitHub releases page)

**Animation Pattern**:
```
Each item:
  Frame 0-10:  Tag badge slides in from left
  Frame 5-15:  Icon + text fades in from right
  Frame 15+:   Hold
  
Items staggered by 45-60 frames
```

**Tag Badge Component**:
```typescript
const TagBadge = ({ tag }: { tag: string }) => {
  const colors: Record<string, string> = {
    NEW: BRAND.tagNew,
    IMPROVED: BRAND.tagImproved,
    FIXED: BRAND.tagFixed,
    BREAKING: BRAND.tagBreaking,
  };
  return (
    <span style={{
      backgroundColor: colors[tag] || BRAND.muted,
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: 700,
      padding: '4px 10px',
      borderRadius: 4,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      {tag}
    </span>
  );
};
```

**Layout**:
```
┌────────────────────────────────────┐
│ What's New in v3.0.0               │
│                                    │
│ [NEW]      ✨ Real-time collab     │
│ [IMPROVED] ⚡ 3x faster builds     │
│ [NEW]      🎨 Dark mode theme      │
│                                    │
│ [FIXED]    Memory leak resolved    │
│ [FIXED]    Auth timeout fixed      │
│                                    │
│ [BREAKING] Node.js 16 dropped     │
│                                    │
└────────────────────────────────────┘
```

---

### Scene 3: Key Highlight (16-23 seconds)
**Purpose**: Deep dive into the most important feature

**Visual Guidelines**:
- Feature title large and bold (48px)
- Description text below (28px)
- Screenshot or demo image on one side
- Feature-specific accent color
- More visual real estate than the list items

**Animation Style**:
- Title slides in from left with spring
- Description fades in after (staggered 15 frames)
- Image slides in from right (or scales up from center)
- Optional: animated border/glow around image

---

### Scene 4: Upgrade CTA (23-26 seconds)
**Purpose**: Tell users how to get the update

**Visual Guidelines**:
- Upgrade command or action (monospace)
- Version comparison: "v2.x → v3.0.0"
- Migration guide link (if breaking changes)
- Release notes URL

**Animation Style**:
- Command types out (typewriter)
- Arrow animation between old and new version
- URL fades in below

**Layout Options**:

**For npm packages**:
```
npm install your-package@latest
```

**For apps**:
```
Update now in Settings → About
```

**For GitHub releases**:
```
github.com/org/repo/releases/v3.0.0
```

---

## Semantic Versioning Visual

### Major Release (v3.0.0)
- Dramatic animation (particle burst, glow)
- Full changelog shown
- Highlight section included
- Duration: 25-30 seconds

### Minor Update (v3.1.0)
- Clean, professional animation
- Features + fixes shown
- Shorter highlight
- Duration: 15-20 seconds

### Patch (v3.1.1)
- Quick, minimal animation
- Only fixes shown
- No highlight section
- Duration: 10-15 seconds

---

## Changelog Item Categorization

| Tag | Color | Icon | Use For |
|-----|-------|------|---------|
| NEW | Purple | ✨ | New features |
| IMPROVED | Blue | ⚡ | Enhanced existing features |
| FIXED | Green | 🐛 | Bug fixes |
| BREAKING | Red | ⚠️ | Breaking changes |
| DEPRECATED | Orange | 📦 | Features being removed |
| SECURITY | Red | 🔒 | Security patches |

---

## Asset Requirements Checklist

### Essential
- [ ] Version number and release type
- [ ] Changelog items with categories (3-8 items)
- [ ] Upgrade command or action
- [ ] Release date

### Optional
- [ ] Codename
- [ ] Key feature screenshot
- [ ] Release notes URL
- [ ] Migration guide link
- [ ] Background music (upbeat for major, subtle for minor/patch)

---

## Quality Checklist

- [ ] Version number is correct and follows semver
- [ ] Tags are categorized correctly (NEW vs IMPROVED vs FIXED)
- [ ] Breaking changes are clearly marked in red
- [ ] Upgrade command is syntactically correct
- [ ] Highlight feature is the most impactful one
- [ ] Animation intensity matches release significance
- [ ] Constants grouped at top
- [ ] All text is readable
- [ ] Timing allows reading all changelog items
