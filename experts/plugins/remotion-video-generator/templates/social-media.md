# Social Media Video Template

## Characteristics
- **Duration**: 15-60 seconds
- **Purpose**: Grab attention quickly and convey one key message
- **Structure**: Hook → Key Message → Supporting Visual → Call-to-Action
- **Format**: Vertical (1080x1920, 9:16) or Square (1080x1080, 1:1)
- **Target**: Instagram Reels, TikTok, YouTube Shorts, LinkedIn, Twitter

## Format Specifications by Platform

### Instagram Reels
- **Aspect Ratio**: 9:16 (vertical)
- **Resolution**: 1080x1920
- **Duration**: 15-60 seconds
- **Best practices**: Fast-paced, trending music, text overlays

### TikTok
- **Aspect Ratio**: 9:16 (vertical)
- **Resolution**: 1080x1920
- **Duration**: 15-60 seconds
- **Best practices**: First 3s critical, use captions, native font style

### YouTube Shorts
- **Aspect Ratio**: 9:16 (vertical)
- **Resolution**: 1080x1920
- **Duration**: Up to 60 seconds
- **Best practices**: Hook in first 1-2s, clear CTA, subscribe reminder

### Instagram Feed
- **Aspect Ratio**: 1:1 (square) or 4:5 (vertical)
- **Resolution**: 1080x1080 or 1080x1350
- **Duration**: 15-60 seconds
- **Best practices**: Eye-catching thumbnail, works without sound

### LinkedIn
- **Aspect Ratio**: 16:9, 1:1, or 9:16
- **Resolution**: 1920x1080, 1080x1080, or 1080x1920
- **Duration**: 30-60 seconds
- **Best practices**: Professional tone, value-first content, captions

---

## Scene Structure (Vertical Format)

### Scene 1: Hook (2-3 seconds)
**Purpose**: Stop the scroll immediately - capture attention in the first second

**Critical Rule**: First frame must be visually striking or intriguing

**Visual Guidelines**:
- **Bold statement**: Large text (80-120px) with high contrast
- **Surprising fact**: Statistics that shock or intrigue
- **Question**: Rhetorical question that resonates
- **Action**: Movement or dynamic element
- **Face**: Human face showing emotion (curiosity, excitement)

**Text Placement** (for 9:16 vertical):
- Safe zone: 80px from top/bottom (avoid UI overlap)
- Center-weighted: Primary content in middle 60%
- Text size: 60-100px for main hook

**Animation Style**:
- **Ultra-fast entrance**: 10-20 frames maximum
- **Zoom**: Scale from 1.2 → 1.0 (slight zoom out)
- **Flash**: Brief color flash or glow
- **No subtlety**: Social media demands immediate impact

**Hook Examples**:

**Question Hooks**:
- "You're doing this wrong..."
- "Why doesn't anyone talk about this?"
- "Did you know [surprising fact]?"

**Stat Hooks**:
- "90% of people miss this"
- "[Big Number] can't be wrong"
- "This costs you $10,000/year"

**Statement Hooks**:
- "Stop right now."
- "This changes everything."
- "I wish I knew this sooner."

**Visual Hooks**:
- Show end result first (transformation)
- Unexpected visual (pattern interrupt)
- Bold color contrast

---

### Scene 2: Key Message (8-15 seconds)
**Purpose**: Deliver the core value proposition or main point

**Visual Guidelines**:
- **Large, readable text**: 50-80px font size
- **Word-by-word reveal** or **line-by-line** for emphasis
- **High contrast**: Dark text on light or vice versa
- **Minimal background**: Avoid busy patterns
- **Subtitle style**: Position text in lower-third (for face videos)

**Layout Options**:

**Option A: Text-Only**
```
[Background: Solid color or simple gradient]
[Text: Large, centered, appearing word by word]
```

**Option B: Text + Icon**
```
[Top 40%: Icon or simple graphic]
[Bottom 60%: Text explanation]
```

**Option C: Split Screen**
```
[Left 40%: Visual element]
[Right 60%: Text content]
```

**Animation Techniques**:

**Word-by-Word Reveal**:
```typescript
// Each word appears sequentially
const words = ["This", "is", "the", "key", "message"];
const wordsToShow = Math.floor(frame / 5); // One word every 5 frames
```

**Typewriter Effect**:
```typescript
const text = "Your key message here";
const charsToShow = Math.floor(frame / 2); // One char every 2 frames
const visibleText = text.slice(0, charsToShow);
```

**Fade-In Lines**:
```typescript
// Line 1 fades in frames 0-15
// Line 2 fades in frames 20-35
const line1Opacity = interpolate(frame, [0, 15], [0, 1]);
const line2Opacity = interpolate(frame, [20, 35], [0, 1]);
```

**Content Guidelines**:
- **One idea only**: Don't try to convey multiple messages
- **Simple language**: 5th-grade reading level
- **Short sentences**: Max 10-12 words
- **Active voice**: "Use this" not "This should be used"
- **Specific**: "Save $500/month" not "Save money"

**Text Styling**:
- **Font**: Bold sans-serif (Montserrat, Poppins, Inter Bold)
- **Weight**: 700-900 (extra bold)
- **Color**: Pure white or pure black for maximum contrast
- **Stroke**: Optional white/black outline for text over images
- **Background**: Optional semi-transparent box behind text

---

### Scene 3: Supporting Visual (5-12 seconds)
**Purpose**: Reinforce the message with a visual demonstration or example

**Visual Options**:

**Option A: Product Shot**
- Clean product image or screenshot
- Centered composition
- Scale animation (zoom in slightly)
- Rotate slightly for 3D effect

**Option B: Before/After**
- Split screen showing transformation
- Slider animation between states
- Labels: "Before" and "After"

**Option C: List/Steps**
- Numbered points (1, 2, 3)
- Icons + short text
- Staggered reveal
- Maximum 3-4 items

**Option D: Demo Clip**
- Short screen recording (5-7s)
- Sped up 1.5-2x if needed
- Arrow or circle highlighting key action
- Text overlay explaining what's happening

**Animation Style**:
- **Fade in with scale**: 0.9 → 1.0
- **Pan across** if showing detailed image
- **Pulse** for emphasis on key elements
- **Rotate** slightly for dynamic feel (2-5 degrees)

**Timing**:
- Visual enters: Frames 0-15
- Holds: Frames 15-120
- Optional annotation appears: Frames 30-45
- Exits: Frames 120-135

---

### Scene 4: Call-to-Action (3-5 seconds)
**Purpose**: Tell viewers exactly what to do next

**Visual Guidelines**:
- **Large, clear text**: 60-80px
- **Contrasting color**: Different from rest of video
- **Simple instruction**: 3-6 words maximum
- **Platform-specific CTAs**

**Platform-Specific CTAs**:

**Instagram/TikTok**:
- "Link in bio 👆"
- "Follow for more tips"
- "Save this for later"
- "Share with a friend"

**YouTube**:
- "Subscribe for more"
- "Watch next video ➡️"
- "Visit [website]"

**LinkedIn**:
- "Connect with me"
- "Read full article [link]"
- "DM me for details"

**Animation Style**:
- Fade in with slight scale
- **Continuous pulse** (subtle, 1.0 → 1.05 → 1.0)
- Optional: Bounce animation
- Optional: Arrow pointing up/down

**Visual Elements**:
- Arrow emoji (👆, ➡️, 👇)
- Button-style background
- Contrasting color (if brand is blue, use orange/red)

---

## Vertical Format Specifications (9:16)

### Resolution & Safe Zones
- **Resolution**: 1080px width × 1920px height
- **Top safe zone**: 80px from top (Instagram/TikTok UI)
- **Bottom safe zone**: 120px from bottom (UI controls)
- **Side margins**: 60px from left/right edges
- **Content area**: 960px × 1720px (safe content zone)

### Layout Zones
```
[0-200px]: Top safe zone (avoid text)
[200-800px]: Upper content zone (hook, title)
[800-1400px]: Middle content zone (main message)
[1400-1800px]: Lower content zone (CTA, subtitle)
[1800-1920px]: Bottom safe zone (avoid text)
```

### Composition Guidelines
- **Rule of thirds**: Divide vertically into thirds
- **Center-weighted**: Most important content in middle third
- **Eye level**: Position faces/products at 40-60% from top
- **Avoid clutter**: One focal point per scene

---

## Square Format Specifications (1:1)

### When to Use Square
- Instagram feed posts
- Multi-platform repurposing
- Desktop viewing (LinkedIn)

### Resolution & Layout
- **Resolution**: 1080px × 1080px
- **Safe zone**: 80px margin all around
- **Content area**: 920px × 920px
- **Center focus**: Main content in center 70%

### Composition
- Centered layouts work best
- More horizontal space available
- Good for side-by-side comparisons

---

## Visual Style for Social Media

### Typography
**Primary Font**: Bold, thick sans-serif
- Montserrat Black (900)
- Poppins Extra Bold (800)
- Bebas Neue (all caps for impact)
- Impact (classic, highly readable)

**Size Hierarchy** (9:16 vertical):
- Hook: 80-120px
- Main message: 50-80px
- Supporting text: 30-40px
- CTA: 60-80px
- Caption: 24-30px

**Text Effects**:
- **Stroke**: 4-8px white or black outline
- **Shadow**: Drop shadow for depth
- **Background box**: Semi-transparent (rgba)
- **Gradient text**: For modern aesthetic

### Color Strategies

**High Contrast Pairs**:
- Black text on white background
- White text on dark navy/black
- Bright color on black (neon effect)

**Attention-Grabbing Colors**:
- **Hot pink** (#FF1B6B) - Energetic, bold
- **Electric blue** (#00D4FF) - Modern, tech
- **Neon green** (#39FF14) - Eye-catching, urgent
- **Bright orange** (#FF6B1B) - Warm, exciting
- **Pure yellow** (#FFFF00) - High visibility

**Brand Colors**:
- Use your brand primary color for CTA
- Use brand accent for highlights
- Background can be neutral or brand-aligned

### Animation Style for Social

**Fast-Paced**:
- No animation longer than 30 frames
- Quick cuts between scenes
- Rapid text reveals
- Energetic feel

**Trending Effects**:
- **Zoom snap**: Quick zoom in/out
- **Glitch**: Brief distortion effect
- **Color shift**: Hue rotation
- **Neon glow**: Bright edge lighting

**Subtle Motion**:
- Continuous slow zoom (scale 1.0 → 1.1 over full duration)
- Floating elements (subtle up/down movement)
- Background gradient shift

---

## Content Strategy by Video Type

### Educational/Tutorial
- **Hook**: "How to [achieve result]"
- **Message**: Step-by-step instructions (max 3 steps)
- **Visual**: Diagram or demonstration
- **CTA**: "Save for later" or "Follow for more"

### Product Promotion
- **Hook**: Show result or transformation
- **Message**: Key benefit or unique feature
- **Visual**: Product in use or lifestyle shot
- **CTA**: "Link in bio" or "Shop now"

### Engagement/Viral
- **Hook**: Controversial or surprising statement
- **Message**: Quick explanation or story
- **Visual**: Relatable scenario or meme
- **CTA**: "Comment your thoughts" or "Share if you agree"

### Motivational
- **Hook**: Inspirational quote or challenge
- **Message**: Expanded thought or actionable tip
- **Visual**: Aesthetic or lifestyle imagery
- **CTA**: "Follow for daily motivation"

---

## Timing Templates

### 15-Second Format (Ultra-Short)
- Hook: 2s (60 frames)
- Message: 9s (270 frames)
- CTA: 4s (120 frames)

### 30-Second Format (Standard)
- Hook: 3s (90 frames)
- Message: 12s (360 frames)
- Visual: 10s (300 frames)
- CTA: 5s (150 frames)

### 60-Second Format (Extended)
- Hook: 3s (90 frames)
- Message: 15s (450 frames)
- Visual: 25s (750 frames)
- Benefits: 12s (360 frames)
- CTA: 5s (150 frames)

---

## Asset Requirements Checklist

### Essential
- [ ] Brand logo (small, corner placement, 100x100px)
- [ ] Product image or main visual (1080x1920 for vertical)

### Optional
- [ ] Background pattern or texture
- [ ] Icons for list items (64x64px, consistent style)
- [ ] Face/person images (if using testimonial style)
- [ ] Before/after images (for transformation content)

### Audio (Optional but Recommended)
- [ ] Trending music track (15-60s)
- [ ] Sound effects (whoosh, pop, etc.)
- [ ] Voiceover (if applicable)

---

## Platform-Specific Best Practices

### Instagram Reels
- Use trending audio when possible
- Add text captions (many watch without sound)
- First frame should be eye-catching (thumbnail)
- Use stickers/GIFs sparingly
- Post at peak times (12pm, 7pm)

### TikTok
- Start with native TikTok text style
- Follow trending formats and challenges
- Use hashtags strategically (3-5 relevant)
- Engage with comments quickly
- Consistency matters (post daily if possible)

### YouTube Shorts
- Optimize first frame (it's the thumbnail)
- Include subscribe reminder
- Link to longer videos when relevant
- Use captions for accessibility
- Add end screen card pointing to next video

### LinkedIn
- Professional tone (less flashy)
- Value-driven content (education, insights)
- Longer-form okay (45-60s)
- Captions essential (most watch muted)
- Industry-specific content performs best

---

## Quality Checklist

Before publishing:
- [ ] First frame is attention-grabbing
- [ ] Text is large and readable on mobile
- [ ] All text fits within safe zones
- [ ] Video works without sound (captions included)
- [ ] CTA is clear and actionable
- [ ] Brand logo/name is visible
- [ ] Export in correct aspect ratio (9:16 or 1:1)
- [ ] File size under platform limits
- [ ] Duration is optimal for platform (15-60s)
- [ ] Preview on actual phone before posting

---

## Example Storyboard

**Video: Product Launch Announcement (Instagram Reels, 30s)**

**Format**: 1080x1920 (9:16 vertical)

1. **Hook** (3s): "This changes everything 🤯" [Bold white text on black, quick zoom]
2. **Message** (10s): "Introducing [Product] - [One-line benefit]" [Word-by-word reveal, gradient background]
3. **Visual** (12s): [Product demo or lifestyle shot with 3 key features overlaid]
4. **CTA** (5s): "Link in bio 👆" [Pulsing text, bright color]

**Total**: 30 seconds
**Aspect Ratio**: 9:16
**Music**: Upbeat, trending audio
**Text**: Always visible for muted viewing
