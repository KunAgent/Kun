# Explainer Video Template

## Characteristics
- **Duration**: 60-180 seconds
- **Purpose**: Educate viewers about a concept, product, or process
- **Structure**: Hook → Problem → Solution → How it works → Benefits → Call-to-Action
- **Target**: Educational content, product explanations, concept introductions

## Scene Structure

### Scene 1: Hook (3-5 seconds)
**Purpose**: Grab attention immediately with a compelling question or statement

**Visual Guidelines**:
- Bold, large text (60-80px) centered on screen
- Solid background or subtle gradient
- High contrast (dark text on light, or vice versa)
- Minimal distractions

**Animation Style**:
- Fast fade-in (0-15 frames)
- Slight scale effect (0.95 → 1.0)
- Spring animation for dynamic feel

**Content Examples**:
- "Struggling with [problem]?"
- "What if you could [desired outcome]?"
- "The secret to [benefit]"

---

### Scene 2: Problem Statement (10-15 seconds)
**Purpose**: Describe the pain point or challenge the audience faces

**Visual Guidelines**:
- Icon or simple illustration representing the problem
- Text overlay describing the problem
- Muted or slightly darker color palette
- Left-aligned or split-screen layout

**Animation Style**:
- Slide in from left with fade
- Staggered reveal for multiple pain points
- Subtle parallax between icon and text

**Content Structure**:
- Clear problem description (1-2 sentences)
- Relatable scenario or statistic
- 2-3 specific pain points as bullets

---

### Scene 3: Solution Introduction (8-10 seconds)
**Purpose**: Introduce your product/concept as the answer to the problem

**Visual Guidelines**:
- Product logo or name prominently displayed
- Brighter, more vibrant colors (vs. problem scene)
- Centered composition
- Clean, professional aesthetic

**Animation Style**:
- Spring animation from center (bouncy feel)
- Glow or highlight effect
- Smooth transition from problem scene

**Content**:
- Product/concept name
- One-line tagline or value proposition
- Visual identity (logo, colors, typography)

---

### Scene 4: How It Works (30-60 seconds)
**Purpose**: Break down the solution into 3-5 digestible steps or features

**Visual Guidelines**:
- Step number (1, 2, 3...) prominently displayed
- Icon representing each step
- Short description (1-2 lines max per step)
- Consistent layout across all steps
- Use numbered circles or badges

**Animation Style**:
- Sequential reveal with stagger effect (50-100 frame delay between steps)
- Fade out previous step before next enters
- Icon animates in first, then text
- Use spring or smooth easing

**Content Structure per Step**:
```
Step [N]: [Action Verb] + [Object]
- Icon: [relevant icon]
- Description: [1-2 sentence explanation]
- Duration: 8-12 seconds per step
```

**Example Steps**:
1. Connect your data sources
2. Configure automation rules
3. Monitor results in real-time

---

### Scene 5: Benefits (12-18 seconds)
**Purpose**: Highlight the top 3 advantages or outcomes

**Visual Guidelines**:
- Checkmark icon or similar success indicator
- List or grid layout
- Positive color scheme (greens, blues)
- Each benefit gets equal visual weight

**Animation Style**:
- Pop-in animation with slight bounce
- Staggered timing (30-50 frames apart)
- Scale from 0.8 → 1.0 with spring physics
- Optional: Pulse or glow on final frame

**Content Structure**:
- ✓ [Benefit 1]: [Short description]
- ✓ [Benefit 2]: [Short description]
- ✓ [Benefit 3]: [Short description]

**Benefit Phrasing**:
- Start with power verbs: "Save", "Increase", "Reduce", "Automate"
- Include specific outcomes: "Save 10 hours per week"
- Focus on user value, not features

---

### Scene 6: Call-to-Action (5-8 seconds)
**Purpose**: Direct viewers to the next step (visit website, sign up, etc.)

**Visual Guidelines**:
- Large, prominent CTA button or text
- Contrasting color (stands out from rest of video)
- URL or action clearly visible
- Optional: QR code for easy access
- Clean, uncluttered composition

**Animation Style**:
- Fade in with scale
- Pulse or glow effect (subtle, continuous)
- Optional: Slight rotation or 3D tilt for emphasis

**Content Examples**:
- "Get Started Free at [website.com]"
- "Download Now at [website.com]"
- "Learn More: [website.com]"
- "Try it Free - No Credit Card Required"

---

## Visual Design System

### Color Palette
**Primary Color**: Main brand color (used for logos, key elements)
**Secondary Color**: Complementary color (used for accents)
**Background**: Light (white, light gray) or dark (navy, black)
**Text**: High contrast to background
**Accent**: For CTAs and important highlights

**Recommended Palettes**:
- Tech/Professional: Blues (#2563EB), Grays (#1F2937)
- Creative: Purples (#7C3AED), Pinks (#EC4899)
- Eco/Health: Greens (#10B981), Teals (#14B8A6)
- Energy/Bold: Oranges (#F97316), Reds (#EF4444)

### Typography
**Heading Font**: Sans-serif, bold (Inter, Poppins, Montserrat)
- Size: 48-72px for titles
- Weight: 700-800 (bold to extra bold)

**Body Font**: Sans-serif, regular (Inter, Roboto, Open Sans)
- Size: 24-36px for descriptions
- Weight: 400-500 (regular to medium)

**Caption Font**: Same as body but smaller
- Size: 16-20px for fine print
- Weight: 400 (regular)

### Spacing & Layout
**Margins**: 80-100px from edges (safe zones)
**Padding**: 40-60px between elements
**Line Height**: 1.5-1.8 for readability
**Alignment**: Centered for titles, left-aligned for body text

---

## Animation Timing Guidelines

### Frame Rate
- **Standard**: 30 FPS (smooth, efficient)
- **Premium**: 60 FPS (extra smooth, larger file size)

### Scene Durations
- **Hook**: 90-150 frames (3-5s @ 30fps)
- **Problem**: 300-450 frames (10-15s)
- **Solution**: 240-300 frames (8-10s)
- **How It Works**: 900-1800 frames (30-60s)
- **Benefits**: 360-540 frames (12-18s)
- **CTA**: 150-240 frames (5-8s)

### Transition Timing
- **Fade**: 15-30 frames
- **Slide**: 20-40 frames
- **Spring**: Use damping: 100, stiffness: 200 (smooth)
- **Pause**: Hold key frames for 60-90 frames before transition

### Animation Easing
- **Smooth**: Spring with damping: 100, stiffness: 200
- **Snappy**: Spring with damping: 200, stiffness: 400
- **Bouncy**: Spring with damping: 50, stiffness: 300

---

## Asset Requirements Checklist

### Essential Assets
- [ ] Logo (PNG, transparent background, 512x512px or vector)
- [ ] Product icon/illustration (if applicable)
- [ ] 3-5 step icons (SVG or PNG, consistent style)

### Optional Assets
- [ ] Background pattern or texture
- [ ] Product screenshot or mockup
- [ ] Illustrations for problem/solution scenes
- [ ] Background music (60-180s, upbeat and neutral)
- [ ] Brand fonts (if not using web fonts)

### Asset Specifications
**Image Format**: PNG (with transparency) or SVG
**Image Size**: 1920x1080 or higher resolution
**Color Mode**: RGB
**File Naming**: kebab-case (logo-main.png, icon-step-1.svg)

---

## Content Writing Tips

### Hook
- Use questions, not statements
- Create curiosity or urgency
- Keep it short (5-7 words max)

### Problem Description
- Be specific and relatable
- Use "you" to make it personal
- Avoid jargon, use plain language

### Solution Positioning
- Focus on outcomes, not features
- Use confident, positive language
- One clear value proposition

### Step Descriptions
- Start with action verbs
- One concept per step
- Keep under 10 words if possible

### Benefits
- Quantify when possible ("Save 10 hours")
- Use power words ("effortless", "instant", "proven")
- Address different user motivations

### Call-to-Action
- Be direct and specific
- Remove friction ("Free", "No signup required")
- Create urgency ("Limited time", "Join 10,000+ users")

---

## Common Patterns & Variations

### Pattern A: Classic Problem-Solution
1. Hook with question
2. Show problem with multiple pain points
3. Introduce solution
4. Demonstrate 3 key features
5. List benefits
6. CTA

### Pattern B: Feature-First
1. Hook with bold claim
2. Show product immediately
3. Demonstrate 5 features rapidly
4. Show benefits/results
5. CTA

### Pattern C: Story-Based
1. Hook with relatable scenario
2. Walk through problem journey
3. Introduce solution as hero
4. Show transformation
5. Benefits as "after" state
6. CTA

---

## Quality Checklist

Before finalizing:
- [ ] Total duration is 60-180 seconds
- [ ] All text is readable (high contrast, large enough)
- [ ] Animations are smooth (no jarring transitions)
- [ ] Color scheme is consistent throughout
- [ ] Brand elements (logo, colors) appear correctly
- [ ] CTA is clear and prominent
- [ ] Audio levels are balanced (if using music/voiceover)
- [ ] Export resolution is 1920x1080 (Full HD)
- [ ] File size is reasonable (<50MB for 2 minutes)

---

## Example Storyboard

**Video: "Introducing TaskFlow - Project Management Made Simple"**

1. **Hook** (4s): "Drowning in project chaos?"
2. **Problem** (12s): "Scattered tasks, missed deadlines, confused teams..."
3. **Solution** (8s): "Meet TaskFlow - Your clarity companion"
4. **How It Works**:
   - Step 1 (10s): Centralize all tasks in one place
   - Step 2 (10s): Assign and track with ease
   - Step 3 (10s): Automate notifications and updates
5. **Benefits** (15s):
   - ✓ Save 10 hours per week
   - ✓ Zero missed deadlines
   - ✓ Team alignment in real-time
6. **CTA** (6s): "Start Free Today - TaskFlow.app"

**Total**: 65 seconds
