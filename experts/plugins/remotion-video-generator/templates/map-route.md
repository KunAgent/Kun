# Map Route / City Zoom Animation Template

## Characteristics
- **Duration**: 15-30 seconds
- **Purpose**: Animate a journey between locations, city highlights, or geographical storytelling
- **Structure**: Map Overview → Route Animation → Location Highlights → Summary
- **Target**: Travel content, delivery service promos, event announcements, office location showcases
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const ROUTE = {
  title: 'Our Journey',
  subtitle: 'From San Francisco to New York',
  locations: [
    { name: 'San Francisco', x: 180, y: 380, label: 'HQ', highlight: true },
    { name: 'Denver', x: 520, y: 340, label: 'Office #2' },
    { name: 'Chicago', x: 780, y: 280, label: 'Office #3' },
    { name: 'New York', x: 1050, y: 300, label: 'East Coast HQ', highlight: true },
  ],
};

const MAP = {
  // Use a static map image or SVG as background
  bgImage: staticFile('map-bg.png'),     // optional
  bgColor: '#1A1A2E',
  landColor: '#16213E',
  routeColor: '#E94560',
  routeWidth: 4,
  dotSize: 12,
  dotColor: '#E94560',
  glowColor: 'rgba(233, 69, 96, 0.4)',
};

const BRAND = {
  bg: '#0F0F1A',
  text: '#F0F0F0',
  accent: '#E94560',
  muted: '#6B7280',
  cardBg: 'rgba(26, 26, 46, 0.9)',
};

const TIMING = {
  fps: 30,
  title: { start: 0, duration: 90 },         // 0-3s
  routeDraw: { start: 90, duration: 360 },    // 3-15s
  highlights: { start: 450, duration: 300 },  // 15-25s
  summary: { start: 750, duration: 90 },      // 25-28s
};
```

## Scene Structure

### Scene 1: Map Overview + Title (0-3 seconds)
**Purpose**: Establish the geographical context

**Visual Guidelines**:
- Full map background (abstract/stylized, NOT Google Maps)
- Use SVG map, hand-drawn style, or dark themed minimal map
- Title and subtitle overlay at top or center
- All location dots visible but small and dim

**Animation Style**:
- Map fades in from black (20 frames)
- Title slides down from top (15 frames)
- Location dots pulse once (scale 0→1 with spring)

**Map Background Options**:
1. **Static image**: Pre-made dark-themed map (staticFile)
2. **SVG paths**: Draw land masses as SVG shapes (programmatic)
3. **Abstract**: Simplified geometric representation with key location points
4. **Grid**: Dark grid background with coordinate markers

---

### Scene 2: Route Drawing Animation (3-15 seconds)
**Purpose**: Animate a path being drawn between locations

**Visual Guidelines**:
- Route line draws progressively from point A to B to C...
- Active dot (current location) is larger and glowing
- Completed segments remain visible in accent color
- Upcoming segments are dim/dashed

**Animation Technique** — SVG Dash Offset:
```typescript
// Calculate total route path length
const totalSegments = ROUTE.locations.length - 1;
const framesPerSegment = Math.floor(TIMING.routeDraw.duration / totalSegments);

// For each segment
const segmentProgress = (segmentIndex: number) => {
  const segStart = TIMING.routeDraw.start + segmentIndex * framesPerSegment;
  return interpolate(frame, [segStart, segStart + framesPerSegment], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};
```

**Route Line Drawing**:
```typescript
// Using SVG path with dasharray/dashoffset for line drawing effect
const pathLength = 500; // measured or estimated
const drawProgress = interpolate(frame, [90, 450], [0, pathLength], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

<svg>
  <path
    d={routePath}
    stroke={MAP.routeColor}
    strokeWidth={MAP.routeWidth}
    fill="none"
    strokeDasharray={pathLength}
    strokeDashoffset={pathLength - drawProgress}
    strokeLinecap="round"
  />
</svg>
```

**Active Dot Animation**:
```typescript
// Dot that moves along the route
const dotPosition = getCurrentPosition(frame); // interpolate between waypoints
const glowScale = Math.sin(frame * 0.1) * 0.2 + 1; // pulsing glow
```

---

### Scene 3: Location Highlights (15-25 seconds)
**Purpose**: Zoom into each key location and show a detail card

**Visual Guidelines**:
- Zoom into each highlighted location
- Show a tooltip/card with location name and details
- Card has rounded corners, slight shadow, semi-transparent bg
- Mini icon or photo for each location (optional)

**Animation Pattern** (per location):
```
Frame 0-15:  Zoom to location (scale map 1.0→1.5, translate to center on point)
Frame 15-25: Card fades in next to dot
Frame 25-75: Hold for reading
Frame 75-90: Zoom out / transition to next
```

**Zoom Code**:
```typescript
const zoomScale = interpolate(frame, [start, start + 15], [1.0, 1.5], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

const zoomX = interpolate(frame, [start, start + 15],
  [0, -(location.x - 960) * 0.5], // center on location
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
);
```

---

### Scene 4: Summary (25-28 seconds)
**Purpose**: Wrap up the journey with a final message

**Visual Guidelines**:
- Zoom back out to full map view
- All routes visible, all dots glowing
- Summary text overlay at bottom
- Optional: distance or time metric

**Animation Style**:
- Smooth zoom out (30 frames)
- All dots pulse simultaneously
- Summary text fades in

---

## Map Creation Approaches

### Approach 1: Static Background Image
- Use a dark-themed map image (Mapbox dark style, Snazzy Maps, or custom)
- Overlay SVG elements for routes and dots
- Simplest approach, good results

### Approach 2: SVG Map
- Use simplified SVG world/country map data
- Style with CSS (dark fills, no borders or subtle borders)
- More control, resolution-independent

### Approach 3: Abstract/Stylized
- Skip realistic geography entirely
- Use a dark grid or dot-matrix background
- Place location markers at approximate positions
- Works great for conceptual routes

---

## Asset Requirements Checklist

### Essential
- [ ] Location names and approximate coordinates/positions
- [ ] Route order (which locations connect)
- [ ] Title and subtitle text

### Optional
- [ ] Map background image (dark themed, 1920x1080)
- [ ] Location icons or photos
- [ ] Summary statistics (distance, time, count)
- [ ] Background music (ambient, 15-30s)

---

## Quality Checklist

- [ ] Route line draws smoothly (no jumps)
- [ ] Location dots are clearly visible
- [ ] Zoom transitions are smooth (no jarring cuts)
- [ ] Cards are readable over map background
- [ ] Map background doesn't compete with content
- [ ] Constants grouped at top
- [ ] Location positions look geographically reasonable
- [ ] SVG paths render correctly at all zoom levels
