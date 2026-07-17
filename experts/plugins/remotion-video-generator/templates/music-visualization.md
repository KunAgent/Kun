# Music Visualization Template

## Characteristics
- **Duration**: Matches audio length (typically 15-120 seconds)
- **Purpose**: Create visual representations that react to audio frequencies and beats
- **Structure**: Audio Analysis → Visual Response → Continuous Visualization
- **Target**: Music promotion, podcast intros, soundtracks, social media audio posts
- **FPS**: 30 or 60 (60 recommended for smooth visualizations)
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const AUDIO = {
  src: staticFile('audio.mp3'),
  title: 'Track Title',
  artist: 'Artist Name',
  album: 'Album Name',
  coverArt: staticFile('cover.png'),  // optional
  bpm: 120,       // beats per minute (for beat-synced animations)
  duration: 60,   // seconds
};

const VISUAL_STYLE = {
  type: 'waveform',  // 'waveform' | 'bars' | 'circular' | 'particles' | 'spectrum'
  colorScheme: 'gradient',  // 'solid' | 'gradient' | 'reactive'
};

const BRAND = {
  bg: '#000000',
  primary: '#8B5CF6',
  secondary: '#EC4899',
  gradient: ['#8B5CF6', '#EC4899', '#F97316'],
  text: '#FFFFFF',
  muted: '#6B7280',
  glow: 'rgba(139, 92, 246, 0.4)',
};

const VIZ_CONFIG = {
  // Bar visualizer
  barCount: 64,
  barWidth: 20,
  barGap: 4,
  barRadius: 4,
  barMinHeight: 4,
  barMaxHeight: 400,
  
  // Circular visualizer
  circleRadius: 200,
  circleLineCount: 128,
  circleLineWidth: 3,
  
  // Waveform
  wavePoints: 200,
  waveAmplitude: 100,
  waveSmoothing: 0.8,
  
  // General
  sensitivity: 1.5,    // audio reactivity multiplier
  smoothing: 0.85,     // smoothing factor (0-1, higher = smoother)
};

const TIMING = {
  fps: 60,
  intro: { start: 0, duration: 90 },   // 0-1.5s (fade in)
  outro: { duration: 60 },              // last 1s (fade out)
};
```

## Audio Analysis

### Using Remotion Audio APIs

```typescript
import { useAudioData, visualizeAudio } from '@remotion/media-utils';
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// Inside component:
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const audioData = useAudioData(AUDIO.src);

if (!audioData) return null;

const visualization = visualizeAudio({
  fps,
  frame,
  audioData,
  numberOfSamples: VIZ_CONFIG.barCount, // power of 2 recommended: 32, 64, 128
  smoothing: true,
});
// visualization is an array of values 0-1 representing frequency bins
```

### Frequency Band Mapping
```typescript
// Split visualization data into frequency bands
const getBands = (data: number[]) => {
  const len = data.length;
  return {
    sub: data.slice(0, Math.floor(len * 0.1)),           // 0-10%: sub-bass
    bass: data.slice(Math.floor(len * 0.1), Math.floor(len * 0.25)),  // 10-25%: bass
    mid: data.slice(Math.floor(len * 0.25), Math.floor(len * 0.6)),   // 25-60%: mids
    high: data.slice(Math.floor(len * 0.6)),              // 60-100%: highs
  };
};

// Average of a band (for reactive effects)
const bandAvg = (band: number[]) =>
  band.reduce((a, b) => a + b, 0) / band.length;
```

---

## Visualization Types

### Type 1: Bar Spectrum

**Visual**: Vertical bars that bounce to the beat

```typescript
const BarVisualizer = ({ data }: { data: number[] }) => (
  <div style={{
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: VIZ_CONFIG.barMaxHeight,
    gap: VIZ_CONFIG.barGap,
  }}>
    {data.map((value, i) => {
      const height = Math.max(
        VIZ_CONFIG.barMinHeight,
        value * VIZ_CONFIG.barMaxHeight * VIZ_CONFIG.sensitivity
      );
      const color = getGradientColor(i / data.length);
      return (
        <div key={i} style={{
          width: VIZ_CONFIG.barWidth,
          height,
          borderRadius: VIZ_CONFIG.barRadius,
          backgroundColor: color,
          boxShadow: `0 0 ${height * 0.3}px ${color}`,
        }} />
      );
    })}
  </div>
);
```

### Type 2: Circular Visualizer

**Visual**: Lines radiating from a circle, length reacting to audio

```typescript
const CircularVisualizer = ({ data }: { data: number[] }) => (
  <svg width={800} height={800} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
    {data.map((value, i) => {
      const angle = (i / data.length) * Math.PI * 2 - Math.PI / 2;
      const innerR = VIZ_CONFIG.circleRadius;
      const outerR = innerR + value * 200 * VIZ_CONFIG.sensitivity;
      const x1 = 400 + Math.cos(angle) * innerR;
      const y1 = 400 + Math.sin(angle) * innerR;
      const x2 = 400 + Math.cos(angle) * outerR;
      const y2 = 400 + Math.sin(angle) * outerR;
      return (
        <line key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={getGradientColor(i / data.length)}
          strokeWidth={VIZ_CONFIG.circleLineWidth}
          strokeLinecap="round"
        />
      );
    })}
    {/* Center circle */}
    <circle cx={400} cy={400} r={VIZ_CONFIG.circleRadius}
      fill="none" stroke={BRAND.primary} strokeWidth={2} />
  </svg>
);
```

### Type 3: Waveform

**Visual**: Smooth oscillating wave that reacts to audio

```typescript
const WaveformVisualizer = ({ data }: { data: number[] }) => {
  // Create smooth path from audio data
  const points = data.map((value, i) => {
    const x = (i / data.length) * 1920;
    const y = 540 + (value - 0.5) * VIZ_CONFIG.waveAmplitude * 2 * VIZ_CONFIG.sensitivity;
    return `${x},${y}`;
  });
  
  const pathD = `M ${points[0]} ${points.slice(1).map(p => `L ${p}`).join(' ')}`;
  
  return (
    <svg width={1920} height={1080}>
      <defs>
        <linearGradient id="waveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          {BRAND.gradient.map((color, i) => (
            <stop key={i}
              offset={`${(i / (BRAND.gradient.length - 1)) * 100}%`}
              stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <path d={pathD} fill="none"
        stroke="url(#waveGradient)" strokeWidth={3} />
      {/* Mirror below */}
      <path d={pathD} fill="none"
        stroke="url(#waveGradient)" strokeWidth={2}
        opacity={0.3}
        transform="scale(1, -1) translate(0, -1080)" />
    </svg>
  );
};
```

---

## Overlay Elements

### Track Info Display
```
┌────────────────────────────────────┐
│                                    │
│   [Cover Art]  Track Title         │
│                Artist Name         │
│                Album Name          │
│                                    │
│         [VISUALIZATION]            │
│                                    │
│   ────────●──────── 1:23 / 3:45   │
│                                    │
└────────────────────────────────────┘
```

### Progress Bar
```typescript
const ProgressBar = ({ frame, totalFrames }: { frame: number; totalFrames: number }) => {
  const progress = (frame / totalFrames) * 100;
  return (
    <div style={{ position: 'absolute', bottom: 60, left: 100, right: 100, height: 4 }}>
      <div style={{
        width: '100%', height: '100%',
        backgroundColor: BRAND.muted, borderRadius: 2,
      }} />
      <div style={{
        width: `${progress}%`, height: '100%',
        backgroundColor: BRAND.primary, borderRadius: 2,
        position: 'absolute', top: 0,
      }} />
      {/* Dot indicator */}
      <div style={{
        position: 'absolute',
        left: `${progress}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 12, height: 12,
        borderRadius: '50%',
        backgroundColor: BRAND.primary,
      }} />
    </div>
  );
};
```

---

## Color Utilities

### Gradient Color Generator
```typescript
const getGradientColor = (position: number): string => {
  const colors = BRAND.gradient;
  const segment = position * (colors.length - 1);
  const index = Math.floor(segment);
  const t = segment - index;
  
  if (index >= colors.length - 1) return colors[colors.length - 1];
  
  // Simple hex interpolation
  const c1 = hexToRgb(colors[index]);
  const c2 = hexToRgb(colors[index + 1]);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
};
```

### Reactive Background
```typescript
// Background color/brightness reacts to bass
const bassLevel = bandAvg(getBands(visualization).bass);
const bgBrightness = 5 + bassLevel * 15; // 5-20% brightness on beat
```

---

## Asset Requirements Checklist

### Essential
- [ ] Audio file (MP3/WAV, properly licensed)
- [ ] Track metadata (title, artist)
- [ ] Visualization style preference
- [ ] Brand colors

### Optional
- [ ] Album/cover art (square, 500x500+)
- [ ] BPM information (for beat-synced effects)
- [ ] Custom color gradient

### Audio Guidelines
- Use compressed audio (MP3, 192kbps+) for reasonable file sizes
- Ensure audio is properly licensed for video use
- Trim silence from beginning/end
- Normalize audio levels

---

## Quality Checklist

- [ ] Visualization reacts convincingly to audio (not random)
- [ ] No lag between audio and visual (synchronization)
- [ ] Bars/lines don't clip outside visible area
- [ ] Color gradient is smooth (no banding)
- [ ] Glow effects don't cause visual noise
- [ ] Track info is readable throughout
- [ ] Progress bar is accurate
- [ ] 60fps output for smooth motion
- [ ] Audio plays correctly (no pops/clicks)
- [ ] Constants grouped at top
