---
name: Scene Planner
description: Creates detailed video storyboards and scene breakdowns for Remotion video generation. Analyzes user requirements, determines video type, selects appropriate template, and outputs structured scene plans with visual specifications, timing, animation details, and asset requirements. Use when planning video structure before code generation.
---

# Video Scene Planner

You are responsible for transforming user video requirements into production-ready storyboards with precise specifications that the video-generator skill can implement with Remotion.

## When This Skill Activates

This skill activates automatically when:
- The video-generator skill receives a video creation request
- User explicitly requests storyboard or scene planning
- Video structure needs to be revised based on feedback

## Core Responsibilities

1. **Analyze user requirements** and extract video specifications
2. **Classify video type** (explainer, product demo, social media, presentation, product launch, open-source promo, data ranking, map route, kinetic typography, app walkthrough, before/after, thread summary, music visualization, release announcement)
3. **Select appropriate template** from the templates library
4. **Create scene breakdown** with timing and visual specifications
5. **Define design system** (colors, fonts, spacing, animations)
6. **List asset requirements** so user knows what to provide
7. **Output structured storyboard** ready for code generation

---

## Planning Process

### Step 1: Requirements Analysis

Extract the following from user input:

#### Essential Information

**Video purpose/goal**:
- What is the video trying to achieve?
- Examples: Explain concept, showcase product, drive signups, educate viewers

**Target audience**:
- Who will watch this video?
- Examples: Developers, business executives, general consumers, students

**Key messages**:
- What are the 3-5 main points to communicate?
- What should viewers remember after watching?

**Duration preference**:
- How long should the video be?
- Default based on type if not specified:
  - Explainer: 60-120 seconds
  - Product demo: 45-75 seconds
  - Social media: 15-30 seconds
  - Presentation: 120-240 seconds

#### Additional Context

**Style preferences**:
- Professional/corporate, creative/modern, minimal/clean, energetic/bold?
- Any reference videos or styles mentioned?

**Brand elements**:
- Brand colors (hex codes if provided)
- Logo availability
- Fonts (if specified)

**Available assets**:
- Images, screenshots, product photos
- Logo files
- Background music or voiceover
- Existing content (slides, documents, scripts)

**Technical constraints**:
- Aspect ratio (16:9 standard, 9:16 vertical, 1:1 square)
- Resolution (1920x1080 default)
- File size limitations
- Platform requirements (Instagram, YouTube, etc.)

#### If Information is Missing

Ask clarifying questions (but be selective - don't overwhelm user):

**Critical questions** (always ask if unclear):
- "What's the main message or goal for this video?"
- "How long should it be?"
- "What visual assets do you have available (images, logos, etc.)?"

**Optional questions** (ask only if relevant):
- "Who is your target audience?"
- "Any specific brand colors to use?"
- "What style do you prefer: professional, creative, minimal, or bold?"

**Smart defaults** (use if user doesn't specify):
- Audience: Assume general/broad audience
- Style: Professional and clean (works for most cases)
- Colors: Use neutral palette (blacks, whites, grays with one accent color)

---

### Step 2: Video Type Classification

Determine the primary video type based on requirements:

#### Explainer Video
**Indicators**:
- User mentions: "explain", "educate", "how it works", "understand", "learn"
- Goal is teaching a concept or process
- Problem-solution structure mentioned

**Characteristics**:
- Duration: 60-180 seconds
- Structure: Hook → Problem → Solution → How It Works → Benefits → CTA
- Visual style: Clean, educational, icon-driven

#### Product Demo
**Indicators**:
- User mentions: "showcase", "demo", "features", "product", "app", "platform"
- Goal is showing software or product functionality
- Screenshots or UI mentioned

**Characteristics**:
- Duration: 30-90 seconds
- Structure: Intro → Overview → Feature Highlights → Value Prop → CTA
- Visual style: Product-focused, annotation-heavy, professional

#### Social Media
**Indicators**:
- User mentions: "Instagram", "TikTok", "Reels", "Shorts", "viral", "trending"
- Goal is attention-grabbing and brief
- Vertical format requested or implied

**Characteristics**:
- Duration: 15-60 seconds
- Structure: Hook → Message → Visual → CTA
- Visual style: Bold, high-contrast, fast-paced
- Format: Often 9:16 (vertical)

#### Presentation
**Indicators**:
- User mentions: "slides", "presentation", "deck", "pitch", "report"
- Goal is structured information delivery
- Multiple topics or sections mentioned

**Characteristics**:
- Duration: 120-300 seconds
- Structure: Title → Content Slides → Summary → Closing
- Visual style: Professional, slide-based, data-friendly

#### Product Launch Announcement
**Indicators**:
- User mentions: "launch", "announce", "new product", "waitlist", "reveal"
- Goal is creating buzz for a new product or major feature
- Short, punchy format

**Characteristics**:
- Duration: 10-15 seconds
- Structure: Hook → Selling Points → Before/After → CTA
- Visual style: Minimalist, dark background, high contrast, typewriter effects
- FPS: 60

#### Open Source Project Promo
**Indicators**:
- User mentions: "open source", "GitHub", "npm", "library", "framework", "CLI", "stars"
- Goal is attracting users/contributors to an OSS project
- Developer-oriented aesthetic

**Characteristics**:
- Duration: 15-30 seconds
- Structure: Project Identity → Features → Social Proof → Install CTA
- Visual style: GitHub dark theme, terminal aesthetic, monospace fonts

#### Data Ranking / Top N
**Indicators**:
- User mentions: "ranking", "top 10", "chart", "data", "comparison", "statistics", "leaderboard"
- Goal is visualizing ranked or comparative data
- Numerical data provided

**Characteristics**:
- Duration: 15-30 seconds
- Structure: Title → Animated Bars → Insight Summary
- Visual style: Clean, data-driven, animated bar charts

#### Map Route / City Zoom
**Indicators**:
- User mentions: "map", "route", "locations", "journey", "cities", "travel", "offices"
- Goal is showing geographical movement or location highlights
- Multiple location points mentioned

**Characteristics**:
- Duration: 15-30 seconds
- Structure: Map Overview → Route Animation → Location Highlights → Summary
- Visual style: Dark themed map, SVG route drawing, zoom effects

#### Kinetic Typography
**Indicators**:
- User mentions: "text animation", "quote", "lyrics", "words", "typography", "manifesto"
- Goal is communicating through animated text as primary visual
- Script or text-heavy content

**Characteristics**:
- Duration: 15-60 seconds
- Structure: Sequential text with motion, scale, rotation, color
- Visual style: Bold typography, minimal background, emphasis effects
- FPS: 60

#### App Walkthrough / UI Demo
**Indicators**:
- User mentions: "walkthrough", "UI", "screens", "app demo", "user flow", "tutorial"
- Goal is guiding through app screens with device frame
- Screenshots or screen recordings mentioned

**Characteristics**:
- Duration: 30-60 seconds
- Structure: App Intro → Screen-by-Screen → Key Interaction → CTA
- Visual style: Device mockup, spotlight highlights, captions

#### Before/After Comparison
**Indicators**:
- User mentions: "before", "after", "comparison", "transformation", "improvement", "upgrade"
- Goal is showing dramatic contrast between old and new states
- Two-state data mentioned

**Characteristics**:
- Duration: 10-20 seconds
- Structure: Context → Before State → Transition → After State → Summary
- Visual style: Split screen, desaturated vs vibrant, red vs green

#### Thread / Post Summary
**Indicators**:
- User mentions: "thread", "tweet", "summary", "key points", "newsletter", "carousel"
- Goal is converting long-form text into visual video
- Sequential points or numbered list provided

**Characteristics**:
- Duration: 20-45 seconds
- Structure: Thread Title → Key Points Sequence → Takeaway → CTA
- Visual style: Twitter/X dark theme, card-based, progress dots

#### Music Visualization
**Indicators**:
- User mentions: "music", "audio", "visualization", "waveform", "spectrum", "podcast"
- Goal is creating visual response to audio
- Audio file provided or referenced

**Characteristics**:
- Duration: Matches audio length
- Structure: Audio Analysis → Visual Response → Continuous Visualization
- Visual style: Bars/circles/waves, gradient colors, glow effects
- FPS: 60

#### Release / Version Announcement
**Indicators**:
- User mentions: "release", "version", "update", "changelog", "v2", "v3", "patch"
- Goal is announcing a software version update
- Changelog items or feature list provided

**Characteristics**:
- Duration: 15-30 seconds
- Structure: Version Badge → What's New List → Key Highlight → Upgrade CTA
- Visual style: Dark, changelog-style, colored tags (NEW/IMPROVED/FIXED)

**Multiple types**: If video crosses categories, choose primary type based on dominant goal.

---

### Step 3: Template Selection

Load the appropriate template from `${CODEBUDDY_PLUGIN_ROOT}/templates/`:

**Core Templates**:
- **explainer-video.md**: For educational/explanatory content
- **product-demo.md**: For software/product showcases
- **social-media.md**: For short-form social content
- **presentation.md**: For slide-based presentations

**Extended Templates**:
- **product-launch.md**: For product launch announcements (10-15s, 60fps)
- **open-source-promo.md**: For open-source project promotion
- **data-ranking.md**: For Top N / data ranking animations
- **map-route.md**: For map route / city zoom animations
- **kinetic-typography.md**: For text-as-visual kinetic typography (60fps)
- **app-walkthrough.md**: For app UI walkthroughs with device frames
- **before-after.md**: For before/after comparison videos
- **thread-summary.md**: For Twitter/X thread summaries
- **music-visualization.md**: For audio-reactive visualizations (60fps)
- **release-announcement.md**: For software release/changelog announcements

**How to use templates**:
1. Read the template file for the selected video type
2. Use its structure as the foundation
3. Adapt to user's specific requirements
4. Apply template guidelines (timing, layout, animation patterns)

---

### Step 4: Scene Breakdown

Create a detailed scene-by-scene breakdown following this structure:

#### Scene Specification Format

For each scene, define:

```json
{
  "scene_id": 1,
  "name": "Hook",
  "duration_seconds": 5,
  "from_frame": 0,
  "duration_frames": 150,
  "type": "title|content|feature|transition|cta",
  
  "content": {
    "heading": "Scene heading text",
    "body": "Main content text",
    "typography": {
      "heading_font": "Inter",
      "heading_size": 60,
      "heading_weight": 700,
      "heading_color": "#1a1a1a",
      "body_font": "Inter",
      "body_size": 28,
      "body_weight": 400,
      "body_color": "#4a5568"
    },
    "layout": "centered|left-aligned|split-screen|full-bleed",
    "background": {
      "type": "solid|gradient|image",
      "value": "#ffffff" or "linear-gradient(...)" or "asset-path.jpg"
    }
  },
  
  "animations": [
    {
      "element": "heading|body|image|icon",
      "type": "fade-in|slide-in|scale|spring|typewriter",
      "start_frame": 0,
      "duration_frames": 30,
      "easing": "smooth|snappy|bouncy",
      "config": {
        "damping": 100,
        "stiffness": 200
      }
    }
  ],
  
  "assets": [
    {
      "type": "image|video|icon|logo",
      "name": "Descriptive asset name",
      "path": "public/assets/filename.ext",
      "position": "background|foreground|centered|top-right",
      "size": "full|large|medium|small",
      "fit": "cover|contain|fill",
      "optional": false
    }
  ],
  
  "transitions": {
    "in": "fade|slide|wipe|none",
    "out": "fade|slide|wipe|none",
    "duration_frames": 20
  }
}
```

#### Scene Calculation

**Frame rate**: Default to 30 fps
- Alternative: 60 fps for ultra-smooth (mention if needed)

**Frame calculation**:
```
duration_frames = duration_seconds * fps
```

Example: 5 seconds @ 30fps = 150 frames

**Cumulative timing**:
- Scene 1: from_frame = 0
- Scene 2: from_frame = Scene 1 duration_frames
- Scene 3: from_frame = Scene 1 + Scene 2 duration_frames
- And so on...

#### Scene Types

**Title/Hook Scene**:
- Purpose: Grab attention or introduce topic
- Duration: 3-5 seconds
- Visual: Centered text, bold typography, solid background
- Animation: Fade in + slight scale

**Content Scene**:
- Purpose: Deliver main information
- Duration: 10-15 seconds
- Visual: Heading + body text or bullets
- Animation: Sequential reveals

**Feature Scene** (for demos):
- Purpose: Highlight specific functionality
- Duration: 10-12 seconds
- Visual: Screenshot + annotation
- Animation: Pan or spotlight effect

**Transition Scene**:
- Purpose: Bridge between major sections
- Duration: 1-2 seconds
- Visual: Minimal (often just animation)
- Animation: Wipe, fade, or slide

**CTA Scene**:
- Purpose: Drive user action
- Duration: 5-7 seconds
- Visual: Bold CTA text + URL
- Animation: Pulse or glow effect

---

### Step 5: Visual Design System

Define a consistent visual language for the entire video:

#### Color Palette

Choose based on:
- User-specified brand colors (if provided)
- Video type and audience
- Accessibility (ensure sufficient contrast)

**Standard palette structure**:
```json
{
  "primary": "#2563EB",        // Main brand color
  "secondary": "#7C3AED",      // Complementary color
  "accent": "#F97316",         // Highlight/CTA color
  "background": "#FFFFFF",     // Main background
  "background_alt": "#F3F4F6", // Alternate background
  "text_primary": "#111827",   // Main text color
  "text_secondary": "#6B7280"  // Secondary text
}
```

**Color psychology**:
- Blue: Trust, professionalism, tech
- Green: Growth, health, eco
- Purple: Creativity, luxury, innovation
- Orange/Red: Energy, urgency, excitement
- Black/White: Elegance, simplicity, clarity

**Ensure accessibility**:
- Contrast ratio 4.5:1 minimum for normal text
- Contrast ratio 3:1 minimum for large text (18px+ bold or 24px+ regular)

#### Typography

**Font selection**:
- Sans-serif for modern/digital content (Inter, Roboto, Poppins, Montserrat)
- Serif for formal/traditional (Merriweather, Lora)
- Monospace for technical content (Fira Code, JetBrains Mono)

**Size hierarchy** (for 1920x1080):
```json
{
  "hero": 72,          // Main titles
  "h1": 60,            // Scene titles
  "h2": 48,            // Subtitles
  "body_large": 36,    // Emphasis text
  "body": 28,          // Standard text
  "body_small": 24,    // Secondary text
  "caption": 18        // Fine print, footnotes
}
```

**Weight scale**:
- 400: Regular (body text)
- 500: Medium (secondary headings)
- 600: Semi-bold (subheadings)
- 700: Bold (headings)
- 800-900: Extra bold (hero text, impact)

#### Spacing & Layout

**Margins** (safe zones):
- Standard 16:9: 80-100px from edges
- Vertical 9:16: 60px sides, 80px top, 120px bottom
- Square 1:1: 80px all sides

**Padding** (between elements):
- Between heading and body: 40-60px
- Between paragraphs: 30-40px
- Between list items: 20-30px

**Grid system**:
- Use 12-column grid for alignment
- Consistent spacing multiples (8px, 16px, 24px, 32px, 40px, 48px)

#### Animation Style

**Easing presets** (for Remotion spring animations):

**Smooth** (professional, subtle):
```json
{
  "damping": 100,
  "stiffness": 200
}
```

**Snappy** (dynamic, responsive):
```json
{
  "damping": 200,
  "stiffness": 400
}
```

**Bouncy** (playful, energetic):
```json
{
  "damping": 50,
  "stiffness": 300
}
```

**Timing guidelines**:
- Fade: 15-30 frames (0.5-1 second)
- Slide: 20-40 frames (0.67-1.33 seconds)
- Scale: 15-30 frames
- Spring: Let physics determine (usually 30-60 frames)

**Stagger timing** (sequential reveals):
- Between list items: 15-30 frames apart
- Between words: 5-10 frames apart
- Between characters (typewriter): 2-3 frames apart

---

### Step 6: Technical Specifications

#### Video Configuration

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "aspectRatio": "16:9",
  "durationInFrames": 1800,
  "durationInSeconds": 60,
  "format": "mp4",
  "codec": "h264",
  "audioCodec": "aac"
}
```

**Frame rate selection**:
- 30 fps: Standard, efficient, works for most content
- 60 fps: Ultra-smooth, for high-motion content, larger files

**Resolution options**:
- 1920x1080: Full HD, standard (default)
- 3840x2160: 4K, premium quality, much larger files
- 1080x1920: Vertical (social media)
- 1080x1080: Square (Instagram feed)
- 1280x720: HD, smaller files, acceptable quality

**Audio** (if applicable):
- Background music track
- Voiceover narration
- Sound effects

---

### Step 7: Asset Requirements

Generate a comprehensive checklist of all assets needed:

#### Essential Assets
Mark as **required** - video cannot be generated without these:

```markdown
- [ ] Logo (PNG, transparent background, minimum 512x512px)
- [ ] Product screenshot 1 (1920x1080 or higher)
- [ ] Main visual/hero image (1920x1080 or higher)
```

#### Optional Assets
Mark as **optional** - video can proceed without these but will be enhanced with them:

```markdown
- [ ] Background music (MP3/WAV, duration matching video length)
- [ ] Additional product screenshots
- [ ] Icon set (SVG or PNG, 64x64px each)
- [ ] Custom fonts (if not using web fonts)
```

**Asset specifications**:
- **Images**: PNG or JPG, RGB color mode, minimum 1920x1080 resolution
- **Logos**: PNG with transparency, square aspect ratio, vector-based if possible
- **Icons**: SVG (preferred) or PNG with transparency, 64x64px or larger
- **Audio**: MP3 (256kbps) or WAV, length should match or exceed video duration
- **Fonts**: TTF or OTF files, include all weights needed

---

## Output Format

Generate a structured markdown storyboard document:

```markdown
# Video Storyboard: [Video Title]

## Project Overview

**Type**: [Explainer Video | Product Demo | Social Media | Presentation]
**Duration**: [X] seconds ([Y] frames @ [Z] fps)
**Resolution**: 1920x1080 (16:9)
**Purpose**: [Brief description of video goal]
**Target Audience**: [Who this is for]

---

## Design System

### Color Palette
- **Primary**: #2563EB (Blue - trust, professional)
- **Secondary**: #7C3AED (Purple - creative)
- **Accent**: #F97316 (Orange - CTA, attention)
- **Background**: #FFFFFF (White)
- **Text Primary**: #111827 (Near black)
- **Text Secondary**: #6B7280 (Gray)

### Typography
- **Font Family**: Inter (sans-serif)
- **Heading Sizes**: 72px (hero), 60px (h1), 48px (h2)
- **Body Sizes**: 36px (large), 28px (standard), 24px (small)
- **Weights**: 400 (regular), 600 (semi-bold), 700 (bold)

### Animation Style
- **Easing**: Smooth spring (damping: 100, stiffness: 200)
- **Timing**: Fade 20 frames, Slide 30 frames
- **Stagger**: 20 frames between sequential elements

---

## Scene Breakdown

### Scene 1: Hook / Title Screen
**Duration**: 5 seconds (0:00 - 0:05, frames 0-150)

**Visual Description**:
- Centered bold text on solid blue background
- White typography, 72px
- Clean, minimal composition

**Content**:
- Heading: "[Attention-grabbing question or statement]"
- No body text

**Animation**:
- Frame 0-20: Fade in from 0% to 100% opacity
- Frame 10-30: Scale from 0.95 to 1.0 (slight zoom)
- Frame 120-150: Hold steady

**Assets Required**:
- Logo (top-right corner, 100x100px)

**Transitions**:
- In: Fade (20 frames)
- Out: Fade (20 frames)

---

### Scene 2: [Next Scene Name]
[Repeat structure for each scene...]

---

## Complete Timeline

| Scene | Content | Duration | Frames | Cumulative Time |
|-------|---------|----------|--------|-----------------|
| 1 | Hook | 5s | 0-150 | 0:00-0:05 |
| 2 | Problem | 12s | 150-510 | 0:05-0:17 |
| 3 | Solution | 8s | 510-750 | 0:17-0:25 |
| 4 | How It Works | 30s | 750-1650 | 0:25-0:55 |
| 5 | CTA | 5s | 1650-1800 | 0:55-1:00 |
| **Total** | | **60s** | **1800** | **0:00-1:00** |

---

## Asset Requirements

### Essential (Required)
- [ ] Logo (PNG, transparent, 512x512px minimum)
- [ ] [Specific asset 1]
- [ ] [Specific asset 2]

### Optional (Recommended)
- [ ] Background music (MP3, 60s, upbeat/neutral)
- [ ] [Optional asset 1]
- [ ] [Optional asset 2]

### Asset Specifications
- **Image Format**: PNG or JPG, RGB mode
- **Minimum Resolution**: 1920x1080
- **File Naming**: Use kebab-case (logo-main.png, screenshot-1.jpg)
- **Asset Location**: Place in public/assets/ directory

---

## Technical Configuration

```json
{
  "composition_name": "[video-name]",
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "duration_frames": 1800,
  "video_image_format": "jpeg",
  "overwrite_output": true
}
```

---

## Notes & Considerations

- [Any special notes about implementation]
- [Platform-specific requirements]
- [Accessibility considerations]
- [Performance optimizations]

---

## Next Steps

1. **Review storyboard**: Confirm structure and content
2. **Gather assets**: Collect all required files
3. **Generate code**: Proceed to Remotion implementation
4. **Preview**: Use Remotion Studio to review
5. **Render**: Generate final MP4 file
```

---

## Best Practices

### Content Planning

**One idea per scene**: Don't try to communicate multiple concepts in one scene

**Visual hierarchy**: Most important content should be most prominent

**Pacing**: Allow enough time to read text (general rule: 3 seconds per sentence)

**Consistency**: Maintain visual style throughout all scenes

**Progressive disclosure**: Reveal information sequentially, not all at once

### Timing Guidelines

**Minimum scene duration**: 3 seconds (anything shorter feels rushed)

**Maximum scene duration**: 20 seconds (unless it's complex data visualization)

**Reading time**: Allow 2-3 seconds per line of text for viewers to read comfortably

**Animation duration**: Keep transitions under 1 second (20-30 frames @ 30fps)

**Pause between scenes**: Brief hold (30-60 frames) before transition

### Animation Principles

**Ease in**: Use for scene entrances (feels natural)

**Ease out**: Use for scene exits (graceful departure)

**Spring physics**: Use for interactive feel (buttons, icons)

**Avoid motion sickness**: No rapid spinning, excessive shaking, or jarring movements

**Purposeful movement**: Every animation should have a reason (reveal, emphasis, transition)

### Accessibility

**Color contrast**: Ensure text is readable (4.5:1 ratio minimum)

**Font size**: Don't go below 24px for important text

**Captions**: Include text on screen (many watch without sound)

**Simple language**: Avoid jargon, use clear terminology

**Visual clarity**: Don't overlay text on busy backgrounds

---

## Template Adaptation

When adapting templates to user requirements:

**Preserve structure**: Keep the proven scene flow from templates

**Customize content**: Replace placeholder text with user's specific content

**Adapt timing**: Adjust durations based on content complexity

**Apply branding**: Use user's colors, fonts, and visual style

**Respect best practices**: Follow template guidelines for timing and animation

**Add personality**: Incorporate user's unique style while maintaining quality

---

## Example Workflow

**User Request**: "I need a 60-second explainer video about our task management app"

**Planning Process**:

1. **Analyze requirements**:
   - Purpose: Explain task management app
   - Type: Explainer video
   - Duration: 60 seconds
   - Audience: Productivity-focused users

2. **Load template**: explainer-video.md

3. **Scene breakdown** (based on template):
   - Scene 1: Hook (4s) - "Drowning in tasks?"
   - Scene 2: Problem (12s) - Scattered tasks, missed deadlines
   - Scene 3: Solution (8s) - Introduce app
   - Scene 4: How It Works (26s) - 3 key features
   - Scene 5: Benefits (7s) - Time saved, clarity
   - Scene 6: CTA (3s) - "Try free at [website]"

4. **Define design**:
   - Colors: Blue (trust, productivity), White (clean)
   - Fonts: Inter (modern, readable)
   - Animation: Smooth spring (professional feel)

5. **List assets**:
   - App logo
   - 3 feature screenshots
   - App icon

6. **Output storyboard**: Complete markdown document as specified above

**Total planning time**: 2-3 minutes

---

## Integration with Other Skills

### Called by video-generator

The video-generator skill invokes this skill to plan video structure before generating Remotion code.

### Uses templates

This skill reads template files from `${CODEBUDDY_PLUGIN_ROOT}/templates/` directory.

### Output to video-generator

Returns complete storyboard specification that video-generator uses to:
- Generate Remotion React components
- Create scene-specific files
- Configure composition timing
- Set up asset references

---

## Extended Video Type Classification

Beyond the 4 core types (explainer, product demo, social media, presentation), this skill also supports these high-impact video styles from the prompt library:

### Product Launch / Feature Announcement
**Indicators**: "launch", "announce", "release", "new feature", "공告"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/01-product-launch.md`
**Characteristics**: 10-15s, dark background, high contrast, typewriter + blur effects

### Developer Tool Promo
**Indicators**: "open source", "CLI", "SDK", "developer tool", "npm", "GitHub"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/02-developer-tool-promo.md`
**Characteristics**: 12-18s, terminal-style cards, command typing, counter animations

### Data Ranking / Top N
**Indicators**: "ranking", "top 10", "leaderboard", "chart", "data", "statistics"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/03-data-ranking.md`
**Characteristics**: 15-30s, animated bar charts, count-up numbers, staggered reveals

### Kinetic Typography
**Indicators**: "quote", "lyrics", "金句", "caption", "口播", "typography"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/04-kinetic-typography.md`
**Characteristics**: 8-15s, word-by-word reveals, highlight emphasis, gradient backgrounds

### App Walkthrough
**Indicators**: "walkthrough", "tutorial", "step by step", "how to use", "UI demo"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/05-app-walkthrough.md`
**Characteristics**: 15-25s, phone frame, highlight boxes, info bubbles

### Before vs After
**Indicators**: "before after", "comparison", "对比", "vs", "versus"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/06-before-after.md`
**Characteristics**: 10-15s, split screen, staggered reveals, breathing divider

### Release Announcement
**Indicators**: "changelog", "version", "update", "release notes", "v2.0"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/07-release-announcement.md`
**Characteristics**: 8-12s, version badge, typewriter, blur-in effects

### Thread / Post Summary
**Indicators**: "thread", "summary", "帖子", "list", "要点", "takeaways"
**Template**: `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/08-thread-summary.md`
**Characteristics**: 15-25s, card-based, news-style header, numbered points

---

## Post-Generation Polish Process

After the initial storyboard and code generation, apply a structured polish process to elevate quality from "functional" to "professional". Reference the polish prompts at `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/09-polish-prompts.md`.

### Polish Round 1: Structure Check
- Verify content is correct and complete
- Check timeline is logical (hook fast → content steady → CTA clear)
- Ensure every scene has enough reading time (2-3s per line)
- Add "hold" periods after key information (30-60 frames)

### Polish Round 2: Visual Consistency
- Unify to maximum 2 fonts (heading + body)
- Limit to 1 primary + 1 accent color (rest is grayscale)
- Align all spacing to 8px grid
- Verify contrast ratios (4.5:1 for text, 3:1 for large text)
- Check: no pure black (#000) or pure white (#FFF) — use near-black and near-white

### Polish Round 3: Animation Refinement
- Replace linear animations with spring() where appropriate
- Add clamp to all interpolate() calls
- Apply subtle background motion (gradient drift, noise float, breathing scale)
- Ensure text reveals are staggered (not everything at once)
- Scene exits should be 30% faster than entrances
- All transitions use crossfade + subtle blur (15-25 frames)

### Polish Round 4: Detail Enhancement
- Add box-shadow for depth (cards, panels)
- Check safe zones (80px from edges for 16:9, 60px sides + 80px top/120px bottom for 9:16)
- Verify text line width doesn't exceed 60 chars (EN) or 30 chars (ZH)
- Add subtle glow effects on CTA elements

### Anti-Pattern Checklist
During polish, verify these common mistakes are avoided:

- ❌ Per-character opacity for typewriter → ✅ Use string.slice()
- ❌ Abrupt cursor blink → ✅ Smooth interpolated blink
- ❌ No fixed width on word carousel → ✅ Measure longest word
- ❌ CSS transition/animation → ✅ useCurrentFrame() + interpolate/spring
- ❌ HTML <img>/<video> → ✅ Remotion <Img>/<Video>
- ❌ Hardcoded paths → ✅ staticFile()
- ❌ interpolate without clamp → ✅ Always add extrapolateLeft/Right: 'clamp'

---

## Constants-First Design Principle

> Source: remotion-dev/template-prompt-to-motion-graphics

All generated code MUST follow the Constants-First Design pattern:

1. **All editable values at the top** of each file as typed constants
2. **Grouped by concern**: BRAND (colors), TYPOGRAPHY (fonts/sizes), CONTENT (text), TIMING (frames/durations)
3. **Single source of truth**: No duplicated color/font/size values scattered in component code
4. **Type-safe**: Use TypeScript interfaces for brand and content configurations

This ensures generated videos can be quickly customized by editing only the constant block at the top, without understanding component internals.

---

## Skill Detection and Injection

> Source: remotion-dev/template-prompt-to-motion-graphics

When planning a video, analyze the requirements to determine which Remotion skill rules to reference:

| Video Need | Inject Rules From |
|------------|------------------|
| Text animations | `rules/text-animations.md` |
| Charts/graphs | `rules/charts.md` (if exists) |
| Scene transitions | `rules/transitions.md` |
| Spring physics | `rules/timing.md` |
| Image handling | `rules/images.md` |
| Audio sync | `rules/audio.md` (if exists) |
| 3D elements | `rules/three.md` (if exists) |
| Captions | `rules/display-captions.md`, `rules/import-srt-captions.md` |

Only inject relevant rules — avoid bloating context with unused skill content.

---

## Brand Configuration System

> Source: digitalsamba/claude-code-video-toolkit

When user provides brand information, structure it into a reusable brand config:

```typescript
const BRAND_CONFIG = {
  colors: {
    primary: '#[user-color]',
    accent: '#[derived-or-specified]',
    background: '#[dark-or-light]',
    text: '#[contrast-to-bg]',
  },
  typography: {
    heading: { font: '[user-font or Inter]', weight: 700, sizes: [72, 60, 48] },
    body: { font: '[user-font or Inter]', weight: 400, sizes: [36, 28, 24] },
  },
  animation: {
    style: 'smooth', // or 'snappy' or 'bouncy'
    springConfig: { damping: 100, stiffness: 200 },
  },
};
```

This config is embedded at the top of every generated component, ensuring brand consistency across all scenes.

---

This skill transforms vague video ideas into precise, implementable specifications that result in high-quality, professional videos. It leverages community-proven templates, the Constants-First Design principle, and structured polish rounds to consistently produce polished output.
