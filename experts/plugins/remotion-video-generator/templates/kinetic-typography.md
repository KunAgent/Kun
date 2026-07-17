# Kinetic Typography Template

## Characteristics
- **Duration**: 15-60 seconds
- **Purpose**: Communicate a message through animated text as the primary visual element
- **Structure**: Text sequence with dynamic motion, scale, rotation, and color changes
- **Target**: Quotes, lyrics, manifesto videos, brand statements, social media hooks
- **FPS**: 60 (smooth text animation requires higher frame rate)
- **Resolution**: 1920x1080

## Constants-First Design

```typescript
// ============ EDITABLE CONSTANTS ============
const CONTENT = {
  lines: [
    { text: 'We don\'t just', emphasis: false },
    { text: 'BUILD', emphasis: true },
    { text: 'software.', emphasis: false },
    { text: 'We craft', emphasis: false },
    { text: 'EXPERIENCES.', emphasis: true },
  ],
  // Timing: frames each line is visible (@ 60fps)
  durations: [45, 60, 45, 45, 90],
};

const BRAND = {
  bg: '#000000',
  text: '#FFFFFF',
  emphasis: '#FF6B35',
  emphasisBg: 'transparent',
  gradient: ['#FF6B35', '#F7C948'],
};

const TYPOGRAPHY = {
  normalFont: 'Inter',
  normalSize: 48,
  normalWeight: 400,
  emphasisFont: 'Inter',
  emphasisSize: 96,
  emphasisWeight: 900,
  letterSpacing: '0.02em',
  emphasisLetterSpacing: '0.05em',
};

const ANIMATION = {
  style: 'slide-up',  // 'slide-up' | 'scale-pop' | 'split-reveal' | 'rotate-in' | 'glitch'
  springConfig: { damping: 80, stiffness: 300 },
  staggerPerChar: 3,  // frames between each character animation
};
```

## Scene Structure

### Core Concept
Each line of text gets its own "moment" — appearing with a distinct animation, holding for reading time, then transitioning out. Emphasis words get larger, bolder, colored treatment.

### Line-by-Line Animation

**For each line**:
```
Phase 1 — ENTER (15-20 frames):
  Text animates in using the chosen style
  
Phase 2 — HOLD (variable, based on durations[]):
  Text is fully visible, centered
  Emphasis text may have subtle secondary animation (pulse, glow)
  
Phase 3 — EXIT (10-15 frames):
  Text animates out (fade, slide, scale down)
  Overlaps slightly with next line's enter
```

---

## Animation Styles

### Style 1: Slide Up (Default)
```typescript
const slideUp = (frame: number, start: number, duration = 15) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }),
  transform: `translateY(${interpolate(frame, [start, start + duration], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })}px)`,
});
```

### Style 2: Scale Pop
```typescript
const scalePop = (frame: number, start: number) => {
  const progress = spring({
    frame: frame - start,
    fps: 60,
    config: { damping: 80, stiffness: 300 },
  });
  return {
    opacity: Math.min(progress * 2, 1),
    transform: `scale(${progress})`,
  };
};
```

### Style 3: Per-Character Stagger
```typescript
const charStagger = (frame: number, charIndex: number, lineStart: number) => {
  const charStart = lineStart + charIndex * ANIMATION.staggerPerChar;
  const progress = spring({
    frame: frame - charStart,
    fps: 60,
    config: { damping: 100, stiffness: 400 },
  });
  return {
    opacity: progress,
    transform: `translateY(${(1 - progress) * 30}px)`,
    display: 'inline-block',
  };
};

// Usage: split text into characters, animate each
{text.split('').map((char, i) => (
  <span key={i} style={charStagger(frame, i, lineStart)}>
    {char === ' ' ? '\u00A0' : char}
  </span>
))}
```

### Style 4: Split Reveal (Wipe)
```typescript
const splitReveal = (frame: number, start: number) => ({
  clipPath: `inset(0 ${interpolate(frame, [start, start + 20], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })}% 0 0)`,
});
```

### Style 5: Rotate In
```typescript
const rotateIn = (frame: number, start: number) => {
  const progress = spring({
    frame: frame - start,
    fps: 60,
    config: { damping: 60, stiffness: 200 },
  });
  return {
    opacity: progress,
    transform: `rotate(${(1 - progress) * -15}deg) scale(${0.8 + progress * 0.2})`,
    transformOrigin: 'left center',
  };
};
```

---

## Emphasis Treatments

### Treatment A: Color + Scale
- Emphasis words are 2x larger and in accent color
- Additional subtle glow (`textShadow: 0 0 40px ${BRAND.emphasis}`)

### Treatment B: Background Highlight
- Word has a colored background block that slides in
- Text appears white on colored bg
```typescript
const highlightWidth = interpolate(frame, [start, start + 15], [0, 100], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

<div style={{ position: 'relative', display: 'inline-block' }}>
  <div style={{
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: `${highlightWidth}%`,
    backgroundColor: BRAND.emphasis,
  }} />
  <span style={{ position: 'relative', color: '#FFF' }}>{word}</span>
</div>
```

### Treatment C: Gradient Text
```typescript
const gradientText = {
  background: `linear-gradient(135deg, ${BRAND.gradient[0]}, ${BRAND.gradient[1]})`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
};
```

---

## Layout System

### Positioning
- Always centered vertically and horizontally
- Use `display: flex`, `alignItems: center`, `justifyContent: center`
- Add generous padding (100px+ from edges)

### Multi-Word Lines
- All words in a line animate together (same timing)
- Exception: emphasis words may have independent timing

### Line Spacing
- Only one line visible at a time (replace, don't stack)
- OR: Build up a paragraph line by line (stack mode)

---

## Timing Calculator

```typescript
// Auto-calculate total duration from content
const calculateTimeline = () => {
  let currentFrame = 0;
  return CONTENT.lines.map((line, i) => {
    const enterDuration = 20;
    const holdDuration = CONTENT.durations[i];
    const exitDuration = 15;
    const result = {
      enter: currentFrame,
      hold: currentFrame + enterDuration,
      exit: currentFrame + enterDuration + holdDuration,
      end: currentFrame + enterDuration + holdDuration + exitDuration,
    };
    currentFrame = result.exit; // overlap exit with next enter
    return result;
  });
};
```

---

## Asset Requirements Checklist

### Essential
- [ ] Text content (all lines, marked with emphasis)
- [ ] Duration per line (or auto-calculate from word count)
- [ ] Brand colors (background, text, emphasis)
- [ ] Animation style preference

### Optional
- [ ] Custom fonts (loaded via @remotion/google-fonts)
- [ ] Background music synced to text beats
- [ ] Background texture or subtle animation

---

## Quality Checklist

- [ ] Text is readable at all animation phases
- [ ] Emphasis words clearly stand out
- [ ] Timing matches natural reading speed (~200-250 WPM)
- [ ] Transitions between lines are smooth (no flash/jump)
- [ ] 60fps output is smooth
- [ ] Font loading doesn't cause FOUT (flash of unstyled text)
- [ ] Line breaks look intentional (no awkward wraps)
- [ ] Constants grouped at top
- [ ] Total duration matches content length
