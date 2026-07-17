# Product Demo Template

## Characteristics
- **Duration**: 30-90 seconds
- **Purpose**: Showcase product features and user interface
- **Structure**: Overview → Feature Highlights → Value Proposition → Call-to-Action
- **Target**: Software products, apps, SaaS platforms, digital tools

## Scene Structure

### Scene 1: Product Introduction (5-7 seconds)
**Purpose**: Establish brand identity and set context

**Visual Guidelines**:
- Product logo prominently displayed (center or top-center)
- Tagline or one-line description
- Brand colors as background (solid or gradient)
- Clean, professional composition
- Sufficient breathing room around logo

**Animation Style**:
- Fade in with upward slide (20-30 frames)
- Logo scales slightly (0.9 → 1.0)
- Tagline fades in after logo (staggered by 15 frames)
- Smooth easing

**Content Structure**:
```
[Logo]
[Product Name]
[Tagline: One-sentence value proposition]
```

**Examples**:
- "TaskMaster - Organize your life"
- "CodeFlow - Deploy with confidence"
- "DesignHub - Create. Collaborate. Ship."

---

### Scene 2: Product Overview (5-10 seconds)
**Purpose**: Show the complete product interface to provide context

**Visual Guidelines**:
- Full product screenshot or mockup
- Clean interface capture (hide any sensitive data)
- Either full-screen or device frame (laptop/phone mockup)
- Soft shadow or glow around mockup for depth

**Animation Style**:
- Zoom in from overview to detail
- Start wide showing full interface
- Gradually focus on main area
- Smooth camera movement (use interpolate for x/y position)
- Duration: 150-300 frames

**Camera Movement**:
```typescript
// Start position: Zoomed out
const scale = interpolate(frame, [0, 60], [0.7, 1.0], {
  extrapolateRight: 'clamp'
});

// Optional pan
const translateX = interpolate(frame, [0, 60], [50, 0], {
  extrapolateRight: 'clamp'
});
```

**Best Practices**:
- Use high-resolution screenshots (2x or 3x display)
- Show the product in a realistic state (with sample data)
- Avoid empty states or placeholder content
- Ensure UI is clean and well-designed

---

### Scene 3: Feature Highlights (40-60 seconds)
**Purpose**: Showcase 3-5 key features with focused attention

**Structure**: Create a sub-scene for each feature (8-12 seconds each)

#### Per-Feature Layout

**Visual Guidelines**:
- UI screenshot with spotlight/highlight on the feature
- Annotation overlay (arrow, circle, box) pointing to feature
- Feature name as heading
- 1-2 sentence description
- Split layout: Screenshot left, text right (or vice versa)

**Highlight Techniques**:
1. **Spotlight**: Dim everything except feature area
2. **Glow/Border**: Bright outline around feature
3. **Zoom**: Scale up the feature area
4. **Annotation**: Arrow or circle pointing to feature

**Animation Pattern**:
```
Frame 0-30: Pan to feature location
Frame 30-40: Highlight appears (fade in)
Frame 40-200: Hold (feature visible and annotated)
Frame 200-230: Annotation fades out
Frame 230-240: Transition to next feature
```

**Animation Code Pattern**:
```typescript
// Highlight glow effect
const glowOpacity = interpolate(frame, [30, 40], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp'
});

// Box shadow for spotlight
boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${0.7 * glowOpacity})`;
```

#### Feature Selection Guidelines

Choose features that:
- Solve clear user problems
- Have visual appeal (not just backend logic)
- Are differentiators (unique to your product)
- Can be shown quickly (avoid complex workflows)
- Represent different aspects of the product

**Example Feature Set for Project Management App**:
1. Drag-and-drop task organization
2. Real-time collaboration
3. Automated notifications
4. Progress analytics dashboard
5. Mobile app sync

#### Content Structure per Feature
```markdown
## Feature [N]: [Feature Name]

**Heading**: [Action-oriented name] (3-5 words)
**Description**: [What it does and why it matters] (1-2 sentences)
**Visual**: [Screenshot showing feature in action]
**Annotation**: [Arrow/circle/box highlighting the feature]
```

---

### Scene 4: Value Proposition (8-12 seconds)
**Purpose**: Summarize why users should choose this product

**Visual Guidelines**:
- Return to clean, uncluttered layout
- 2-4 key benefits listed
- Icons representing each benefit
- Confident, positive visual tone
- Use brand colors

**Layout Options**:

**Option A: Benefit List**
```
✓ [Benefit 1]
✓ [Benefit 2]
✓ [Benefit 3]
```

**Option B: Comparison**
```
Before              After
[Pain point] →  [Benefit]
[Pain point] →  [Benefit]
```

**Option C: Stat Showcase**
```
[Large Number]
[Benefit description]
```

**Animation Style**:
- Slide in from right (staggered)
- Each benefit appears 30-40 frames apart
- Use spring animation for dynamic feel
- Icons scale in before text

**Content Examples**:
- "10x faster than spreadsheets"
- "Trusted by 50,000+ teams"
- "Save 15 hours per week"
- "99.9% uptime guaranteed"

---

### Scene 5: Call-to-Action (5-8 seconds)
**Purpose**: Drive user to take next step

**Visual Guidelines**:
- Large, prominent CTA button or text
- High contrast color (stands out from video)
- URL or action clearly displayed
- Optional: Pricing info or "Free trial" mention
- Clean background (no distractions)

**CTA Variations**:

**Direct CTA**:
```
[Button: "Try Free for 14 Days"]
www.yourproduct.com
```

**Value-Added CTA**:
```
Get Started Free
✓ No credit card required
✓ Full access to all features
→ www.yourproduct.com
```

**Urgency CTA**:
```
Limited Time: 50% Off
Sign up now at www.yourproduct.com
```

**Animation Style**:
- Fade in all elements
- Button has continuous subtle pulse
- Optional: Slight 3D tilt on button
- Text appears slightly before button

---

## Visual Design System

### Product Screenshot Guidelines

**Preparation**:
1. Use high-resolution displays (Retina/2x)
2. Clear all notifications and distractions
3. Use realistic sample data (not "lorem ipsum")
4. Show the product in best-case scenario
5. Crop to relevant area (remove unnecessary UI)

**Capture Tools**:
- macOS: Cmd+Shift+4 (selection) or Cmd+Shift+5 (window)
- Windows: Snipping Tool or Snip & Sketch
- Browser: Full-page screenshot extensions
- Design tools: Export from Figma/Sketch as PNG

**Post-Processing**:
- Resize to 1920x1080 or maintain aspect ratio
- Apply subtle shadow for depth
- Optionally: Place in device mockup (laptop/phone frame)
- Compress to reduce file size without quality loss

### Annotation Styles

**Arrows**:
- Clean, single-color arrows pointing to features
- Match brand color
- Medium thickness (not too thin or bold)
- Curved arrows for better flow

**Circles/Boxes**:
- Rounded corners (8-12px radius)
- Semi-transparent fill or just stroke
- Brand color with slight glow
- Size proportional to highlighted area

**Text Overlays**:
- High contrast to ensure readability
- Use background box if text is over complex image
- Keep short (3-5 words max)
- Consistent font size (24-32px)

### Device Mockups

When to use:
- Mobile apps: Show in phone frame
- Web apps: Optional laptop frame for context
- Desktop software: Clean screenshot without frame

Popular mockup tools:
- Figma/Sketch mockup plugins
- Mockup generator websites
- Apple/Google official device frames

---

## Animation Techniques for Product Demos

### Camera Panning
Simulate moving across the interface:
```typescript
const offsetX = interpolate(frame, [0, 60], [0, -300], {
  extrapolateRight: 'clamp'
});

<div style={{ transform: `translateX(${offsetX}px)` }}>
  {/* Screenshot */}
</div>
```

### Zoom Into Detail
Start wide, zoom to specific feature:
```typescript
const scale = interpolate(frame, [0, 60], [1, 1.5]);
const translateX = interpolate(frame, [0, 60], [0, -200]);

<div style={{ 
  transform: `scale(${scale}) translateX(${translateX}px)` 
}}>
  {/* Screenshot */}
</div>
```

### Highlight Spotlight
Dim everything except feature:
```typescript
const spotlightOpacity = interpolate(frame, [30, 45], [0, 0.7]);

<div style={{
  position: 'absolute',
  inset: 0,
  backgroundColor: `rgba(0, 0, 0, ${spotlightOpacity})`,
  // Use clip-path to cut out highlighted area
  clipPath: 'polygon(...)'
}} />
```

### Cursor Movement Simulation
Animate cursor moving and clicking:
```typescript
const cursorX = interpolate(frame, [0, 60], [100, 500]);
const cursorY = interpolate(frame, [0, 60], [300, 400]);
const cursorScale = spring({
  frame: frame - 60,
  fps: 30,
  config: { damping: 200, stiffness: 500 }
});

<div style={{
  position: 'absolute',
  left: cursorX,
  top: cursorY,
  transform: `scale(${cursorScale})`
}}>
  🖱️ {/* Cursor icon */}
</div>
```

---

## Timing Guidelines

### Standard Demo (60 seconds)
- Introduction: 6s
- Overview: 8s
- Feature 1: 10s
- Feature 2: 10s
- Feature 3: 10s
- Value Prop: 10s
- CTA: 6s

### Quick Demo (30 seconds)
- Introduction: 4s
- Overview: 5s
- Feature 1: 7s
- Feature 2: 7s
- CTA: 7s

### Detailed Demo (90 seconds)
- Introduction: 7s
- Overview: 10s
- Feature 1: 12s
- Feature 2: 12s
- Feature 3: 12s
- Feature 4: 12s
- Value Prop: 15s
- CTA: 10s

---

## Asset Requirements Checklist

### Essential Screenshots
- [ ] Full product interface (overview shot)
- [ ] Feature 1 screenshot (high-res)
- [ ] Feature 2 screenshot (high-res)
- [ ] Feature 3 screenshot (high-res)
- [ ] (Optional) Feature 4-5 screenshots

### Branding Assets
- [ ] Product logo (PNG, transparent, 512x512px)
- [ ] Brand colors (hex codes documented)
- [ ] Product icon/favicon

### Optional Assets
- [ ] Device mockup frames (laptop/phone)
- [ ] Annotation graphics (arrows, circles)
- [ ] Cursor icon for interaction simulation
- [ ] Background music (upbeat, 60-90s)

---

## Content Writing Tips

### Feature Names
- Use action verbs: "Drag-and-Drop", "Auto-Sync", "Real-Time Updates"
- Be specific: "Email Notifications" > "Notifications"
- Highlight benefit: "One-Click Export" vs "Export Feature"

### Feature Descriptions
- Lead with benefit: "Save time with..."
- Keep to 1-2 sentences
- Avoid technical jargon
- Focus on user outcome, not mechanism

### Value Proposition
- Use numbers: "3x faster", "50% less time"
- Social proof: "Used by 10,000+ teams"
- Risk reduction: "Free trial", "No credit card"

---

## Common Patterns

### Pattern A: Feature Showcase
Focus heavily on demonstrating multiple features in sequence, minimal narration.

### Pattern B: Problem-Solution
Start with user pain point, then show how each feature solves it.

### Pattern C: Before/After
Show old way of doing things, then show improved workflow with product.

### Pattern D: User Journey
Follow a realistic user scenario from start to finish.

---

## Quality Checklist

Before finalizing:
- [ ] All screenshots are high-resolution (no blur)
- [ ] Product UI looks polished (no bugs visible)
- [ ] Sample data is realistic and professional
- [ ] Annotations are clear and not overwhelming
- [ ] Feature highlights are easy to follow
- [ ] Transitions between features are smooth
- [ ] CTA is prominent and actionable
- [ ] Brand colors and logo are correct
- [ ] Total duration is 30-90 seconds
- [ ] Export as 1920x1080 (Full HD)

---

## Example Storyboard

**Video: "Introducing DesignFlow - Collaborative Design Platform"**

1. **Introduction** (6s): Logo + "DesignFlow - Design together, ship faster"
2. **Overview** (8s): Zoom into full product dashboard
3. **Feature 1** (12s): Real-time collaboration (show cursors of multiple users)
4. **Feature 2** (12s): Component library (drag-and-drop demo)
5. **Feature 3** (12s): Instant prototyping (show interactive preview)
6. **Value Prop** (10s): "10x faster than traditional tools, Trusted by 500+ companies"
7. **CTA** (8s): "Start designing free at DesignFlow.app"

**Total**: 68 seconds
