# Data Ranking / Top N Animation Template

## Characteristics
- **Duration**: 15-30 seconds
- **Purpose**: Visualize ranked data with animated bar charts or lists
- **Structure**: Title Card → Animated Ranking → Insight Summary
- **Target**: Industry reports, tech comparisons, annual reviews, social media data
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const CHART_DATA = [
  { rank: 1, name: 'React', value: 220000, color: '#61DAFB' },
  { rank: 2, name: 'Vue', value: 210000, color: '#42B883' },
  { rank: 3, name: 'Angular', value: 95000, color: '#DD0031' },
  { rank: 4, name: 'Svelte', value: 78000, color: '#FF3E00' },
  { rank: 5, name: 'Next.js', value: 120000, color: '#000000' },
];

const CHART_CONFIG = {
  title: 'Most Popular Frontend Frameworks 2026',
  subtitle: 'By GitHub Stars',
  dataSource: 'Source: GitHub, January 2026',
  insight: 'React continues to lead, but the gap is narrowing',
  unit: 'stars',
  maxBarWidth: 1200,
  barHeight: 60,
  barGap: 20,
  barRadius: 8,
};

const BRAND = {
  bg: '#0F172A',
  cardBg: '#1E293B',
  text: '#F1F5F9',
  muted: '#94A3B8',
  accent: '#3B82F6',
};

const TIMING = {
  fps: 30,
  title: { start: 0, duration: 60 },        // 0-2s
  ranking: { start: 60, duration: 540 },     // 2-20s
  insight: { start: 600, duration: 60 },     // 20-22s
};
```

## Scene Structure

### Scene 1: Title Card (0-2 seconds)
**Purpose**: Establish what data is being shown and the source

**Visual Guidelines**:
- Large title centered (48-64px, bold)
- Subtitle below (32px, muted color)
- Data source small text bottom-right (16px)
- Dark background with subtle gradient
- Clean, authoritative aesthetic

**Animation Style**:
- Title fades in + slight slide up (20 frames)
- Subtitle fades in 10 frames later
- Source text fades in last

---

### Scene 2: Animated Ranking (2-20 seconds)
**Purpose**: Show each item entering and its bar growing to the correct width

**Visual Guidelines**:
- Horizontal bar chart layout
- Each bar has: rank number (left), name (left of bar), bar (colored), value (right of bar)
- Bars ordered by rank (top to bottom)
- Each bar's color matches the brand of the item
- Value displays as formatted number with unit

**Animation Pattern** (per bar):
```
Entry timing: staggered, each bar starts 45-60 frames after previous
Frame 0-10:  Name + rank fade in from left
Frame 10-50: Bar grows from 0 width to target width
Frame 10-50: Value counts up from 0 to target (synchronized with bar)
Frame 50+:   Hold in final position
```

**Bar Growth Code**:
```typescript
const barProgress = (frame: number, startFrame: number, duration = 40) =>
  interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

// Width calculation
const maxValue = Math.max(...CHART_DATA.map(d => d.value));
const targetWidth = (item.value / maxValue) * CHART_CONFIG.maxBarWidth;
const currentWidth = targetWidth * barProgress(frame, itemStartFrame);
```

**Layout**:
```
┌────────────────────────────────────────┐
│ Most Popular Frontend Frameworks 2026  │
│ By GitHub Stars                        │
│                                        │
│ 1  React    ████████████████  220,000  │
│ 2  Vue      ███████████████   210,000  │
│ 3  Next.js  █████████         120,000  │
│ 4  Angular  ███████            95,000  │
│ 5  Svelte   ██████             78,000  │
│                                        │
│                     Source: GitHub 2026 │
└────────────────────────────────────────┘
```

---

### Scene 3: Insight Summary (20-22 seconds)
**Purpose**: Provide a takeaway from the data

**Visual Guidelines**:
- Bars remain visible but dim slightly (opacity → 0.5)
- Insight text appears as an overlay, centered
- Larger font (36-44px), semi-bold
- Optional: highlight the relevant bar(s) that the insight references

**Animation Style**:
- Background dims (overlay with 40% black)
- Insight text fades in with slight scale (0.95 → 1.0)
- Hold for reading time

---

## Variants

### Variant A: Race Chart (Time-Series)
Show rankings changing over time (e.g., framework popularity 2020→2026)
- Bars swap positions smoothly
- Year counter in corner
- More complex: requires multi-frame data

### Variant B: Comparison Bars
Two datasets side-by-side (e.g., "2025 vs 2026")
- Double bars per row (different colors)
- Legend in top-right

### Variant C: Vertical Bars
Column chart instead of horizontal bars
- Bars grow upward from bottom
- Good for fewer items (3-5)

---

## Data Formatting

### Number Display
```typescript
const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};
```

### Bar Color Assignment
- Use brand colors for well-known items (React blue, Vue green, etc.)
- For generic data, use a palette: `['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']`
- Ensure sufficient contrast against background

---

## Asset Requirements Checklist

### Essential
- [ ] Ranked data array (name, value, optional color)
- [ ] Chart title and subtitle
- [ ] Data source citation
- [ ] Insight/takeaway text

### Optional
- [ ] Brand colors for each item
- [ ] Item logos/icons
- [ ] Background music (calm, analytical feel)

---

## Quality Checklist

- [ ] Data is sorted correctly by rank
- [ ] Bar widths are proportional to values
- [ ] Number formatting is consistent (all k, all M, etc.)
- [ ] CountUp animation is synchronized with bar growth
- [ ] Stagger timing feels natural
- [ ] Insight text is accurate and meaningful
- [ ] Source citation is present
- [ ] All constants grouped at top
- [ ] Colors have sufficient contrast
