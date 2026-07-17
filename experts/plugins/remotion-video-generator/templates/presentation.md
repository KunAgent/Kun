# Presentation Video Template

## Characteristics
- **Duration**: 120-300 seconds (2-5 minutes)
- **Purpose**: Deliver structured information in slide format
- **Structure**: Title → Content Slides → Summary → Closing
- **Target**: Business presentations, educational content, webinars, reports

## Scene Structure

### Scene 1: Title Slide (5-7 seconds)
**Purpose**: Introduce the presentation topic and set professional tone

**Visual Guidelines**:
- **Presentation title**: Large, centered text (60-80px)
- **Subtitle**: Context or tagline (30-40px)
- **Presenter info**: Name, title, date (optional, 20-24px)
- **Clean background**: Solid color, subtle gradient, or branded pattern
- **Logo placement**: Top-right or bottom-center (small, unobtrusive)

**Layout Example**:
```
[Top 20%: Logo or branding]
[Middle 60%: 
  Title (centered, large)
  Subtitle (centered, smaller)
]
[Bottom 20%: 
  Presenter Name | Date
]
```

**Animation Style**:
- Fade in (30-45 frames)
- No flashy effects (maintain professionalism)
- Title appears first, then subtitle (stagger by 20 frames)
- Logo is static or subtle fade-in

**Design Considerations**:
- **Professional fonts**: Montserrat, Open Sans, Roboto, Lato
- **Color scheme**: Corporate/brand colors or neutral palette
- **Ample whitespace**: Don't crowd the title slide
- **Consistent template**: This design carries through all slides

---

### Scene 2-N: Content Slides (10-15 seconds each)
**Purpose**: Present information in digestible, structured format

**Standard Slide Duration**:
- Simple text slide: 10-12 seconds
- Image-heavy slide: 12-15 seconds
- Complex diagram: 15-20 seconds

#### Slide Type A: Text Slide (Bullet Points)

**Layout**:
```
[Top 20%: Slide title (left-aligned or centered)]
[Middle 70%:
  • Bullet point 1
  • Bullet point 2
  • Bullet point 3
  • Bullet point 4
]
[Bottom 10%: Slide number (optional)]
```

**Visual Guidelines**:
- **Title**: 48-60px, bold, brand color or black
- **Bullet points**: 28-36px, regular weight, 3-5 points max
- **Line spacing**: 1.6-2.0 for readability
- **Left margin**: 100-120px from edge
- **Right margin**: 100-120px from edge

**Animation Pattern**:
```typescript
// Title fades in first
Frame 0-20: Title fade in
Frame 20-60: Hold title

// Bullets reveal sequentially
Frame 30-45: Bullet 1 slides in from left
Frame 50-65: Bullet 2 slides in from left
Frame 70-85: Bullet 3 slides in from left
Frame 90-105: Bullet 4 slides in from left
Frame 105-300: Hold all content
Frame 300-330: Fade out (transition to next slide)
```

**Code Pattern**:
```typescript
const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
  extrapolateRight: 'clamp'
});

const bullet1Opacity = interpolate(frame, [30, 45], [0, 1]);
const bullet1X = interpolate(frame, [30, 45], [-50, 0]);
// Repeat for each bullet with timing offset
```

**Best Practices**:
- **Limit bullets**: Maximum 5 points per slide
- **Concise text**: 10-15 words per bullet
- **Parallel structure**: Start each point similarly
- **Visual hierarchy**: Use consistent sizing

---

#### Slide Type B: Image Slide

**Layout**:
```
[Top 20%: Slide title]
[Middle 70%: Large image with caption]
[Bottom 10%: Image caption or source]
```

**Visual Guidelines**:
- **Image size**: 60-70% of slide height
- **Aspect ratio**: Maintain original (don't distort)
- **Position**: Centered horizontally and vertically
- **Border**: Optional subtle border or shadow
- **Caption**: 20-24px, centered below image

**Animation Style**:
- Title fades in (0-20 frames)
- Image fades in with slight scale (30-50 frames)
- Caption appears after image (60-75 frames)
- Hold for 200-300 frames

**Image Guidelines**:
- High resolution (at least 1920px width)
- Relevant to content (not generic stock photos)
- Professional quality
- Properly licensed or owned

---

#### Slide Type C: Split Slide (Text + Image)

**Layout**:
```
[Top 20%: Slide title (full width)]
[Middle 70%:
  Left 50%: Text content (bullets or paragraphs)
  Right 50%: Related image or graphic
]
```

**Alternative Layout**:
```
Left 40%: Image
Right 60%: Text content
```

**Animation Style**:
- Title fades in (0-20 frames)
- Left and right content fade in together (30-50 frames)
- Or: Stagger left then right (30-50 frames, then 55-75 frames)

**Use Cases**:
- Explaining concept with visual aid
- Before/after comparisons
- Product + description
- Person + bio

---

#### Slide Type D: Data Slide (Chart/Graph)

**Layout**:
```
[Top 20%: Slide title]
[Middle 70%: Chart or graph (centered)]
[Bottom 10%: Data source or footnote]
```

**Chart Types**:
- **Bar chart**: Comparing quantities
- **Line chart**: Showing trends over time
- **Pie chart**: Showing proportions (use sparingly)
- **Area chart**: Cumulative totals
- **Table**: Structured data (keep simple, max 5x5)

**Animation for Charts**:
- Title fades in (0-20 frames)
- Chart axes appear (30-45 frames)
- Data animates in:
  - Bar chart: Bars grow from zero (staggered)
  - Line chart: Line draws from left to right
  - Pie chart: Sections appear clockwise
- Labels fade in after data (60-75 frames)

**Design Guidelines**:
- **Clear labels**: All axes and data points labeled
- **Legend**: If multiple data series
- **Color coding**: Use consistent, accessible colors
- **Simple design**: Avoid 3D effects or clutter
- **High contrast**: Ensure readability

---

#### Slide Type E: Quote Slide

**Layout**:
```
[Middle 80%:
  " Large quote text "
  
  — Attribution (name, title)
]
```

**Visual Guidelines**:
- **Quote text**: 40-60px, centered
- **Quote marks**: Large decorative quotes or subtle
- **Attribution**: 28-32px, right-aligned or centered
- **Background**: Different from standard slides (contrast)

**Animation Style**:
- Quote fades in with slight scale (0-30 frames)
- Attribution fades in after quote (45-60 frames)
- Hold for 180-250 frames

**Use Cases**:
- Expert testimonials
- Key principles or mantras
- Inspirational moments
- Section transitions

---

### Scene N+1: Summary Slide (12-15 seconds)
**Purpose**: Recap key takeaways from presentation

**Layout**:
```
[Top 20%: "Key Takeaways" or "Summary"]
[Middle 70%:
  1. First key point
  2. Second key point
  3. Third key point
  (4. Fourth key point - optional)
]
```

**Visual Guidelines**:
- **Numbered list**: Use large, bold numbers (1, 2, 3)
- **Concise points**: 8-12 words each
- **Visual consistency**: Match slide template
- **Emphasis**: Slightly larger or different color than body slides

**Animation Style**:
- Title fades in (0-20 frames)
- Each point appears sequentially (staggered by 40-50 frames)
- All points hold together (200+ frames)
- Fade out for transition (last 30 frames)

**Content Strategy**:
- Distill each main section to one sentence
- Action-oriented language
- Parallel structure
- 3-5 takeaways maximum

---

### Scene N+2: Closing Slide (5-7 seconds)
**Purpose**: Thank audience and provide contact information or next steps

**Layout Options**:

**Option A: Thank You**
```
[Middle 60%:
  "Thank You"
  
  Questions?
]
[Bottom 20%:
  Contact info or website
]
```

**Option B: Contact Info**
```
[Top 20%: "Get in Touch" or "Learn More"]
[Middle 60%:
  📧 email@example.com
  🌐 www.website.com
  📱 @socialmedia
]
```

**Option C: Call-to-Action**
```
[Middle 70%:
  "Ready to get started?"
  
  Visit: www.website.com
  Email: contact@example.com
]
```

**Visual Guidelines**:
- **Large thank you**: 60-80px, centered
- **Contact details**: 28-36px, clear and readable
- **Icons**: Optional (email, website, phone icons)
- **Logo**: Prominent placement (larger than on other slides)

**Animation Style**:
- Fade in all elements (0-30 frames)
- Hold for full duration (no exit animation needed)
- Optional: Subtle continuous animation (e.g., pulsing CTA)

---

## Presentation Design System

### Color Palette

**Corporate/Professional**:
- **Primary**: Navy blue (#1E3A8A), dark gray (#1F2937)
- **Accent**: Teal (#0D9488), blue (#3B82F6)
- **Background**: White (#FFFFFF), light gray (#F3F4F6)
- **Text**: Charcoal (#111827), medium gray (#6B7280)

**Creative/Modern**:
- **Primary**: Purple (#7C3AED), magenta (#D946EF)
- **Accent**: Orange (#F97316), pink (#EC4899)
- **Background**: White or off-white
- **Text**: Dark purple or black

**Minimal/Clean**:
- **Primary**: Black (#000000)
- **Accent**: One bright color (red, blue, green)
- **Background**: Pure white (#FFFFFF)
- **Text**: Black, dark gray for secondary

### Typography

**Heading Fonts**:
- Montserrat (versatile, modern)
- Open Sans (clean, readable)
- Roboto (neutral, professional)
- Lato (friendly, corporate)

**Body Fonts**:
- Same as heading (consistent) or complementary sans-serif
- Avoid mixing too many fonts (2 max: heading + body)

**Font Sizes** (1920x1080 resolution):
- **Slide title**: 48-60px
- **Body text**: 28-36px
- **Captions**: 20-24px
- **Footnotes**: 16-18px

**Font Weights**:
- **Titles**: Bold (700) or Semi-bold (600)
- **Body**: Regular (400) or Medium (500)
- **Emphasis**: Bold (700) for key words

### Layout Guidelines

**Standard Margins**:
- **Top**: 80-100px
- **Bottom**: 80-100px
- **Left**: 100-120px
- **Right**: 100-120px

**Content Area**:
- 1720px × 900px (within safe margins)

**Grid System**:
- Use 12-column grid for alignment
- Consistent spacing between elements (40-60px)
- Align elements to grid for professional look

**Visual Hierarchy**:
- **Title area**: Top 20% of slide
- **Content area**: Middle 70% of slide
- **Footer area**: Bottom 10% of slide

---

## Slide Transitions

### Recommended Transitions

**Fade** (most professional):
```typescript
const opacity = interpolate(frame, [0, 20], [0, 1], {
  extrapolateRight: 'clamp'
});
```

**Slide In** (dynamic but professional):
```typescript
const slideX = interpolate(frame, [0, 30], [100, 0], {
  extrapolateRight: 'clamp'
});
```

**Wipe** (clean, directional):
```typescript
// Use clip-path to create wipe effect
clipPath: `inset(0 ${100 - progress}% 0 0)`
```

**Cross Dissolve**:
```typescript
// Previous slide fades out while next fades in
const prevOpacity = interpolate(frame, [0, 20], [1, 0]);
const nextOpacity = interpolate(frame, [0, 20], [0, 1]);
```

### Avoid These Transitions
- ❌ Spinning or rotating slides
- ❌ Bouncing or elastic effects
- ❌ Checkerboard or pixelate
- ❌ Anything overly flashy or distracting

**Duration**: Keep transitions short (20-30 frames / 0.67-1 second)

---

## Element Animation Patterns

### Text Reveal

**Fade In** (simple, professional):
```typescript
const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1]);
```

**Slide In from Left**:
```typescript
const opacity = interpolate(frame, [start, start + 15], [0, 1]);
const x = interpolate(frame, [start, start + 20], [-30, 0]);
```

**Typewriter** (for emphasis):
```typescript
const charsToShow = Math.floor((frame - startFrame) / 2);
const visibleText = fullText.slice(0, charsToShow);
```

### Bullet Points

**Sequential Reveal**:
- Bullet 1: Frames 30-45
- Bullet 2: Frames 50-65 (20-frame gap)
- Bullet 3: Frames 70-85
- Bullet 4: Frames 90-105

**Slide + Fade**:
```typescript
const bulletOpacity = interpolate(frame, [start, start + 15], [0, 1]);
const bulletX = interpolate(frame, [start, start + 20], [-40, 0]);
```

### Images

**Fade + Scale** (elegant):
```typescript
const opacity = interpolate(frame, [0, 20], [0, 1]);
const scale = interpolate(frame, [0, 30], [0.95, 1]);
```

**Pan Across** (for large images):
```typescript
const x = interpolate(frame, [0, duration], [0, -200]);
// Slowly pan across image
```

---

## Timing Guidelines

### Standard Presentation (3 minutes / 180 seconds)

Example structure:
- Title slide: 6s
- Introduction slide: 12s
- Content slide 1: 15s
- Content slide 2: 15s
- Content slide 3: 15s
- Content slide 4: 15s
- Data slide: 18s
- Quote slide: 12s
- Summary slide: 15s
- Closing slide: 7s

**Total**: 130 seconds (+ buffer for transitions)

### Extended Presentation (5 minutes / 300 seconds)

- Title: 7s
- 8-10 content slides: 15-20s each
- 1-2 data/visual slides: 20-25s each
- Summary: 18s
- Closing: 7s

### Quick Presentation (2 minutes / 120 seconds)

- Title: 5s
- 5-6 content slides: 12-15s each
- Summary: 12s
- Closing: 5s

---

## Asset Requirements Checklist

### Essential
- [ ] Company/project logo (PNG, transparent, 300x300px)
- [ ] Title slide background (if using custom)
- [ ] Consistent slide template design

### Content Assets
- [ ] Images for visual slides (1920x1080 or proportional)
- [ ] Charts/graphs (export as high-res PNG or SVG)
- [ ] Icons for bullet points (optional, 48x48px, consistent style)

### Optional
- [ ] Background music (subtle, corporate-friendly, 2-5 minutes)
- [ ] Presenter photo (if including bio slide)
- [ ] Product screenshots or mockups
- [ ] Custom fonts (if not using web fonts)

---

## Best Practices

### Content

1. **One idea per slide**: Don't overload with information
2. **Minimal text**: Slides support your talk, not replace it
3. **Visual hierarchy**: Guide eye to most important element first
4. **Consistent structure**: Same layout for similar slide types
5. **Proofread**: Check spelling, grammar, formatting

### Design

1. **Brand consistency**: Use corporate colors and fonts
2. **High contrast**: Ensure text is readable
3. **White space**: Don't fill every pixel
4. **Professional imagery**: Avoid cheesy stock photos
5. **Accessibility**: Consider colorblind-friendly palettes

### Animation

1. **Subtle is better**: Professional presentations avoid flashy effects
2. **Consistent timing**: Use same animation speed throughout
3. **Purpose-driven**: Animate to reveal information progressively
4. **Don't overdo it**: Not every element needs animation
5. **Test pacing**: Ensure enough time to read each slide

---

## Common Patterns

### Pattern A: Academic/Research
- Heavy on data and charts
- More text per slide (but still concise)
- Formal color palette
- Citations and references included

### Pattern B: Corporate/Business
- Clean, minimal slides
- Focus on key messages
- Professional imagery
- Strong branding throughout

### Pattern C: Creative/Pitch
- Bold, eye-catching design
- More visual, less text
- Dynamic animations
- Storytelling flow

---

## Quality Checklist

Before finalizing:
- [ ] All slides follow consistent template
- [ ] Text is readable (size and contrast)
- [ ] Spelling and grammar checked
- [ ] Slide numbers included (if appropriate)
- [ ] Logo/branding consistent on all slides
- [ ] Animations are smooth and professional
- [ ] Timing allows enough reading time
- [ ] Total duration is appropriate (2-5 minutes)
- [ ] Export resolution is 1920x1080 (Full HD)
- [ ] File format is appropriate for distribution

---

## Example Storyboard

**Presentation: "Q4 Marketing Strategy Overview"**

1. **Title** (6s): "Q4 Marketing Strategy | October 2024"
2. **Agenda** (12s): Overview of 4 key initiatives
3. **Slide 1** (15s): Initiative 1 - Social media campaign
4. **Slide 2** (15s): Initiative 2 - Email marketing refresh
5. **Slide 3** (15s): Initiative 3 - Partnership opportunities
6. **Slide 4** (15s): Initiative 4 - Content strategy
7. **Data** (18s): Expected ROI by channel (bar chart)
8. **Quote** (12s): Customer testimonial
9. **Timeline** (18s): Implementation schedule (Gantt chart)
10. **Budget** (15s): Resource allocation (pie chart)
11. **Summary** (15s): 4 key takeaways
12. **Closing** (7s): "Questions? contact@company.com"

**Total**: 163 seconds (2 minutes 43 seconds)
**Slides**: 12
**Style**: Corporate, professional, data-driven
