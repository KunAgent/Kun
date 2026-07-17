# App Walkthrough / UI Demo Template

## Characteristics
- **Duration**: 30-60 seconds
- **Purpose**: Guide viewers through an app's key screens and user flows
- **Structure**: App Introduction → Screen-by-Screen Walkthrough → Key Interaction → Summary CTA
- **Target**: Mobile apps, web apps, SaaS products, browser extensions
- **FPS**: 30
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const APP = {
  name: 'YourApp',
  tagline: 'The smarter way to organize your life',
  platform: 'ios',  // 'ios' | 'android' | 'web' | 'desktop'
  logo: staticFile('app-icon.png'),
};

const SCREENS = [
  {
    name: 'Dashboard',
    image: staticFile('screen-dashboard.png'),
    caption: 'See everything at a glance',
    highlightArea: { x: 100, y: 200, w: 400, h: 300 },  // optional spotlight
    duration: 240,  // frames
  },
  {
    name: 'Create Task',
    image: staticFile('screen-create.png'),
    caption: 'Create tasks in seconds',
    highlightArea: null,
    duration: 180,
  },
  {
    name: 'Analytics',
    image: staticFile('screen-analytics.png'),
    caption: 'Track your productivity trends',
    highlightArea: { x: 300, y: 100, w: 500, h: 250 },
    duration: 240,
  },
];

const BRAND = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  accent: '#6366F1',
  muted: '#94A3B8',
  deviceFrame: '#1F2937',
};

const DEVICE = {
  type: 'iphone',  // 'iphone' | 'android' | 'laptop' | 'browser'
  width: 375,
  height: 812,
  scale: 0.85,      // scale within video frame
  borderRadius: 44,
  notchHeight: 44,
};

const TIMING = {
  fps: 30,
  intro: { start: 0, duration: 120 },          // 0-4s
  walkthrough: { start: 120, duration: 660 },   // 4-26s
  summary: { start: 780, duration: 120 },        // 26-30s
};
```

## Scene Structure

### Scene 1: App Introduction (0-4 seconds)
**Purpose**: Show the app icon, name, and what it does

**Visual Guidelines**:
- Clean, light background (or dark, matching app theme)
- App icon centered, large (200x200px)
- App name below icon (48px, bold)
- Tagline below name (28px, muted)
- Platform badge (e.g., "Available on iOS")

**Animation Style**:
- Icon: spring scale from 0→1 with slight bounce
- Name: fade in + slide up (staggered 15 frames)
- Tagline: fade in (staggered 10 more frames)
- Transition: icon shrinks and moves to corner, device frame appears

---

### Scene 2: Screen-by-Screen Walkthrough (4-26 seconds)
**Purpose**: Show each key screen inside a device frame with captions

**Visual Guidelines**:
- Device frame (phone/laptop mockup) centered on screen
- Current screen image fills the device frame
- Caption text below or beside the device
- Optional: spotlight/highlight on specific UI area
- Screen number indicator (dots or "1/3")

**Device Frame Code**:
```typescript
// Phone mockup container
const DeviceFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    width: DEVICE.width * DEVICE.scale,
    height: DEVICE.height * DEVICE.scale,
    borderRadius: DEVICE.borderRadius,
    overflow: 'hidden',
    border: `3px solid ${BRAND.deviceFrame}`,
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)',
    position: 'relative',
  }}>
    {/* Notch (iOS) */}
    <div style={{
      position: 'absolute',
      top: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '40%',
      height: DEVICE.notchHeight * DEVICE.scale,
      backgroundColor: BRAND.deviceFrame,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
      zIndex: 10,
    }} />
    {children}
  </div>
);
```

**Screen Transition Pattern**:
```
Screen N:
  Frame 0-15:  New screen slides in (from right or bottom)
  Frame 15-20: Caption fades in
  Frame 20+:   Hold for reading/viewing
  
  If highlightArea:
    Frame 30-40: Spotlight overlay fades in
    Frame 40+:   Hold with spotlight
    Frame hold-10: Spotlight fades out
    
  Last 15 frames: Current screen slides out
```

**Spotlight Effect**:
```typescript
// Dim everything except highlighted area
const SpotlightOverlay = ({ area, opacity }: { area: HighlightArea; opacity: number }) => (
  <div style={{
    position: 'absolute',
    inset: 0,
    backgroundColor: `rgba(0, 0, 0, ${0.6 * opacity})`,
    // Cut out the highlight area using clip-path
    clipPath: `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%,
      0% ${area.y}px, ${area.x}px ${area.y}px,
      ${area.x}px ${area.y + area.h}px, ${area.x + area.w}px ${area.y + area.h}px,
      ${area.x + area.w}px ${area.y}px, 0% ${area.y}px
    )`,
  }} />
);
```

---

### Scene 3: Summary CTA (26-30 seconds)
**Purpose**: Drive download or sign-up

**Visual Guidelines**:
- Device frame shrinks slightly and moves to one side
- CTA text on the other side
- App store badge(s) or sign-up URL
- Final app icon + name

**Animation Style**:
- Device slides left, CTA slides in from right
- CTA text fades in with stagger
- App store badges spring in
- Subtle pulse on primary CTA

---

## Transition Styles Between Screens

### Style A: Slide (Default)
- Current screen slides out left, new screen slides in from right
- Duration: 15-20 frames
- Clean and professional

### Style B: Crossfade
- Current screen fades out while new fades in
- Duration: 20-30 frames
- Soft and elegant

### Style C: Zoom Through
- Current screen zooms into a specific area
- New screen appears as if we "entered" that area
- Duration: 25-35 frames
- Dynamic and engaging

### Style D: Device Flip
- Device frame rotates on Y axis (3D perspective)
- New screen revealed on "other side"
- Use `transform: perspective(1000px) rotateY()`
- Most dramatic, use sparingly

---

## Caption Design

### Position Options
1. **Below device**: Most common, centered text
2. **Side panel**: Text beside device on wider compositions
3. **Overlay**: Semi-transparent bar at bottom of device
4. **Floating**: Tooltip-style near the highlighted area

### Caption Styling
```typescript
const captionStyle = {
  fontFamily: 'Inter',
  fontSize: 32,
  fontWeight: 500,
  color: BRAND.text,
  textAlign: 'center',
  marginTop: 24,
};
```

---

## Asset Requirements Checklist

### Essential
- [ ] App icon (PNG, 512x512, transparent or rounded)
- [ ] 3-5 key screen screenshots (matched to device resolution)
- [ ] Screen captions (1 sentence each)
- [ ] App name and tagline
- [ ] CTA (download link / URL)

### Optional
- [ ] Highlight areas for specific UI elements
- [ ] App store badge images
- [ ] Cursor/tap indicator for interactions
- [ ] Background music (upbeat, 30-60s)

### Screenshot Preparation
- Capture at device native resolution (e.g., 1170x2532 for iPhone 14 Pro)
- Use realistic sample data (not lorem ipsum)
- Remove any personal or sensitive information
- Ensure status bar shows reasonable time/battery

---

## Quality Checklist

- [ ] Device frame matches the correct platform
- [ ] Screenshots are high-resolution (no pixelation)
- [ ] Spotlight areas highlight the right feature
- [ ] Screen transitions are smooth (no stutter)
- [ ] Captions are readable and concise
- [ ] Total walkthrough covers the key user journey
- [ ] CTA is prominent and actionable
- [ ] Constants grouped at top
- [ ] Consistent visual style throughout
