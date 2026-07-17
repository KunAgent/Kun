---
name: ppt-implement
description: implement ppt(powerpoint) project with best practices, start's with "ppt" template. Trigger keywords include "web ppt", "网页ppt", "html ppt", "生成ppt", "制作ppt", "制作教案", "write a ppt about", or any request to create presentations on specific topics. 
---

## ⚠️ CRITICAL: DO NOT Explore Project Structure

```
.
├── docs
│   ├── product
│   └── project.json
└── frontend
    ├── 404.html
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── public
    │   └── assets
    │       └── images
    ├── scripts
    │   └── build-slides.js
    ├── src
    │   ├── js
    │   │   ├── ppt-controller.js # PPT controller, DO NOT modify
    │   │   └── route-handler.js # Route handler, DO NOT modify
    │   ├── main.js # Entry file, DO NOT modify
    │   ├── slides # PPT slides, stores slide-N.js files, no manual loading needed - framework auto-loads them
    │   └── styles
    │       └── main.css
    ├── tailwind.config.js
    ├── vite.config.js
    └── yarn.lock
```

**The project framework is pre-configured and ready to use. No analysis required.**

- ❌ **DO NOT** use code-explorer subagent to analyze the project
- ❌ **DO NOT** use search_file / search_content / list_dir to explore directory structure
- ❌ **DO NOT** read package.json, vite.config, or other config files to "understand the project"
- ❌ **DO NOT** spend time figuring out "how the project works"

- ✅ **START** directly from Phase 1 (Material Collection)
- ✅ **FOLLOW** the workflow strictly: Phase 1 → Phase 9
- ✅ **ONLY READ** files explicitly specified in each phase

> Reason: The project structure is standardized. All necessary paths and configurations are documented in the phases below. Any exploration is a waste of time.

## Path Variables

Path variables used in this document:
- `CORE_DIR`: Project core directory, i.e. `${CODEBUDDY_PLUGIN_ROOT}`
- `WORKSPACE_DIR`: Project root directory, i.e. `${CODEBUDDY_PROJECT_DIR}`

## General Principles

### Key Commands

```bash
# Debugging
python3 "${$WORKSPACE_DIR}/.genie/scripts/python/fetch_monitor_errors.py"
```

### Launch Configuration

`.cloudstudio` file defines startup - DO NOT modify. Always use unified process script.

## Development Server Guidelines
  - **DO NOT** automatically start the development server (e.g., `npm run dev`, `vite`, etc.) after completing tasks
  - **DO NOT** output localhost addresses to the user (e.g., `http://localhost:5173/`)

---

## PPT Creation Workflow

### Process Overview

**Complete Workflow**:
1. **Phase 1**: Material Collection (Data Gathering, Chapter Planning) - **This Skill**
2. **Phase 2**: Style Definition (Main Visual System) - **This Skill**
3. **Phase 3**: Generate Page Images - **This Skill**
4. **Phase 4**: Generate PPT Outline - **This Skill**
5. **Phase 5**: Environment Setup - **This Skill**
6. **Phase 6**: Template Planning (Select templates for each page) - **This Skill**
7. **Phase 7**: Parallel PPT Generation (Batch invoke sub-agents) - **This Skill orchestrates, Sub-agents execute**
8. **Phase 8**: Take PPT Screenshots - **This Skill**
8. **Phase 9**: Output PPT Usage Instructions - **This Skill**
9. **Phase 10**: Handling User Modifications - **Only triggered when user requests changes**

**⚠️ Key Principles**:
- **Phase 1-9**: First-time generation flow, execute sequentially then STOP
- **Phase 10**: Only triggered when user requests modifications after initial generation
- **Phase 7: Skill orchestrates parallel sub-agent calls, each sub-agent generates ONE page**
- **Sub-agent only handles single page HTML generation (content filling)**
- **🚫 NO USER INTERACTION**: Execute ALL phases autonomously without asking user for confirmation, clarification, or approval. Make reasonable decisions based on context.

---

## Phase 1: Material Collection

### 1.1 Data Gathering

**Goal**: Search and collect materials for PPT theme, output to `${WORKSPACE_DIR}/docs/product/material.md`.

**Step 1: Generate Search Queries (8-12 queries, parallel execution)**

| Layer | Query Pattern | Example |
|-------|--------------|---------|
| Foundation | `[Theme] definition/overview` | "AI ethics overview" |
| Context | `[Theme] history/background` | "AI ethics development" |
| Evidence | `[Theme] statistics/research 2024` | "AI ethics research 2024" |
| Application | `[Theme] case study/examples` | "AI ethics real cases" |
| Trends | `[Theme] trends/future` | "AI ethics future challenges" |

> Tips: Add year (2024/2025) for time-sensitive topics; mix CN/EN queries when needed.

**Step 2: Extract & Organize into 6 Dimensions**

1. **Overview** - Definition, significance
2. **Background** - History, milestones, current status
3. **Key Info** - Facts, data, expert views
4. **Evidence** - Cases, research, visual refs
5. **Analysis** - Multiple perspectives, comparisons
6. **Outlook** - Trends, recommendations

**Step 3: Output Format** (`${WORKSPACE_DIR}/docs/product/material.md`)

```markdown
# Material: [Theme]

## 1. Overview
- [Point]

## 2. Background
- [Point]

## 3. Key Info
- [Point]

## 4. Evidence
- Case: [Name] - [Desc] (Has Images: Yes/No)

## 5. Analysis
- [Viewpoint]

## 6. Outlook
- [Trend]

## Summary
- High-authority: [N], Gaps: [List or None]
```

**Quality Rules**: Prioritize academic/official sources; exclude unverified/outdated (>5yr) content; ensure ≥3 high-authority sources and ≥5 different domains.

### 1.2 Chapter Planning (Pyramid Principle)

**Page Count**: Default `14-20` pages when unspecified. Single chapter: 1-5 pages.

**Core Principle**: Apply **Pyramid Principle** — structure content with clear hierarchy, each level supporting the one above.

**Step 1: Identify PPT Type → Select Pyramid Structure**

| PPT Type | Pyramid Structure | Chapter Flow |
|----------|-------------------|--------------|
| **Report/Summary** | Classic (Conclusion First) | Result → Evidence → Details → Next Steps |
| **Product/Sales** | Problem-Solution | Pain Point → Solution → Value → Proof → CTA |
| **Training/Education** | Progressive (Shallow→Deep) | Basics → Core → Advanced → Practice |
| **Pitch/Fundraising** | SCQA Story | Situation → Complication → Question → Answer |
| **Event/Promo** | Emotional | Hook → Resonance → Climax → Action |

**Step 2: Build Chapter Hierarchy**

```
[PPT Core Message]                    ← Answer: What's the ONE takeaway?
    ├── [Chapter 1: Sub-conclusion]   ← Support core message
    │       ├── Page: Evidence/Data
    │       └── Page: Example/Case
    ├── [Chapter 2: Sub-conclusion]
    │       ├── Page: Evidence/Data
    │       └── Page: Example/Case
    └── [Chapter 3: Sub-conclusion]
            └── ...
```

**Step 3: Validate Structure (MECE Check)**
- **Mutually Exclusive**: No overlap between chapters
- **Collectively Exhaustive**: Chapters fully support the core message
- **Logical Order**: Time sequence / Importance / Structure

Based on collected materials (`${WORKSPACE_DIR}/docs/product/material.md`), output chapter structure to `${WORKSPACE_DIR}/docs/product/chapters.md`.

**Chapter Planning Format**:
```markdown
## Page N: Page Name
- **Page Type**: Cover/TOC/Transition/Content/Ending
- **Page Title**: XXX (recommended within 15 characters, can add subtitle: XXX)
- **Selected Template**: (Leave blank, to be filled during Phase 6 Template Planning)

- **Content Structure**: (Choose appropriate structure based on page purpose)

  > **IMPORTANT - Content Richness Requirements**:
  > - Each main point MUST have 2-3 sentences of detailed explanation
  > - Each page MUST contain at least 3-5 specific data points (numbers, percentages, years)
  > - Each page body content should be 100-200 words minimum
  > - Include supporting details: comparisons, context
  
  **Content Structure by Page Type** (select appropriate structure):

  | Page Type | Core Elements |
  |-----------|---------------|
  | **Argument** | Core Argument + 3-4 Evidence (Data/Case/Quote) + Key Insight |
  | **Data** | Data Headline + 4-6 Metrics (Number\|Label\|Context) + Data Story |
  | **Process** | Goal + 4-6 Steps (Action→Output→Duration) + Success Metrics |
  | **Case Study** | Header (Company/Timeline/Scale) + Challenge + Solution + Results (Before→After) + Lessons |
  | **Comparison** | Framework + Options A/B/C (Dimensions + Best For + Limits) + Recommendation |
  | **Concept** | Definition (Simple/Technical) + 3-5 Components + Applications + Misconceptions |
  | **Problem/Solution** | Problem (Scope/Urgency) + Impacts + Root Causes + Solutions (Approach/Benefit/Risk) |
  | **Trend** | Baseline + 3-5 Trends (Desc/Evidence/Drivers/Timeline) + Projections + Actions |
  | **Summary** | Executive Summary + 4-6 Takeaways + Key Numbers + Call to Action |

  > **Universal Requirements**: Each page needs 100-200 words body content, 3-5 specific data points.

- **Content Density**: Light (≤3 main points) / Medium (4-6 points) / Heavy (7+ points or complex data)
- **Narrative Role**: [How this page advances the overall story] (e.g., "Establishes credibility with data", "Introduces key challenge", "Provides solution framework")

- **Image Requirements**:
  **Image Requirements Planning Principles**:
  - **Default to No Images**: Unless images are truly necessary, use text layout. **Control the overall proportion of pages with images to no more than 40% of total pages** (e.g., 10-page PPT with images on no more than 4 pages).
  - **Strict Evaluation Criteria** (Must meet at least one):
    1. **Complexity**: Information has inherent complexity (spatial/temporal/relational) that text cannot efficiently express
    2. **Visual Priority**: Visual form is the primary information carrier (e.g., network relationships, geographic distribution)
    3. **Efficiency Gain**: Images can significantly reduce cognitive load (e.g., trend comparisons, structural hierarchies)
    4. **Scenario Necessity**: Specific scenarios inherently require images (e.g., character introductions, visual effects demonstrations)
  
  - **Decision Framework** (Apply to any scenario):
    - **ASK**: Can text + layout clearly convey this? → If YES, do not use images
    - **ASK**: Is information complexity high (≥4 elements/dimensions/steps)? → If NO, prioritize text
    - **ASK**: Does visual form have unique advantages? → If NO, use text/cards
  
  - **Reference Examples** (Not exhaustive, apply evaluation criteria flexibly):
    - ✅ **Should Use Images**:
      - Complex spatial: Multi-location maps, architectural layouts
      - Multi-step processes: ≥4-node timelines, multi-branch flowcharts
      - Network relationships: ≥5-node ecosystem diagrams, dependency graphs
      - Data trends: Multi-dimensional curves, complex comparative charts
      - Character/roles: Avatars, portraits (when identity is key information)
    - ❌ **Should Not Use Images**:
      - Pure viewpoint exposition: Use lists, card layouts
      - Simple enumeration (≤3 items): Text layout is clearer
      - Concept definitions: Text + color/bold more direct
      - Simple data (≤3 data points): Data cards suffice
      - Short processes (≤3 steps): Text arrows more concise
      - Cover/TOC/ending: Text primary, images only decorative
  - **Flexibility Note**: Above examples are references, not exhaustive lists. Apply evaluation criteria based on actual content to decide if images are needed.
  
- **Page Weight**: Core page/Secondary page/Transition page (clarify page importance; core pages can allocate more design effort, e.g., key/difficult content pages in teaching set as core pages)
- **Content Page Selection Rationale**: (Required only for content pages, case pages, practical pages) Briefly explain page value (e.g., connecting previous chapter's classical Chinese knowledge points, breaking down lesson's key/difficult points, paving the way for subsequent interactive exercises; or concretizing modern application of Chinese elements through this case to enhance persuasiveness)
- **Notes**: (Optional, supplement special requirements) e.g., Page needs animation effects (text appears line by line); Reserve QR code position (linking to extended materials); Educational scenarios need to add mini-question (e.g., "What do you think is the beauty of the character 'green'?")
```

**Page Type Descriptions**:
- **Cover Page**: PPT opening, contains main title, subtitle, presenter information
- **TOC Page**: Chapter navigation, lists all chapter names
- **Transition Page**: Chapter transitions, indicates current chapter name
- **Content Page**: Main content, contains text, images, charts, etc.
- **Ending Page**: PPT closing, contains thank you message, contact information, etc.

---

## Phase 2: Style Definition

### 2.1 Determine PPT Style
Based on the user's input prompt, determine the PPT style and record the confirmed result in ${SlideStyle}. Currently supported styles include:
- Minimalist
- Chinese
- Educational
- Business
- Geometric
- Literary
- Black-Gold
- Cartoon
- Tech
- Flat



### 2.2 Main Visual System

#### Font Planning

**Font Selection Principles**:
- Entire PPT should not exceed **2-3 font types** (title + body + decorative optional)
- For mixed Chinese-English text, choose fonts that support both languages
- Prioritize Web-safe fonts or Google Fonts (for cross-platform display)

**Font Style Matching**: Choose fonts that match PPT tone - sans-serif (Noto Sans SC, Roboto, Inter, Montserrat) for modern/tech/business themes; serif (Noto Serif SC, Playfair Display) for traditional/premium/cultural themes; creative/handwritten fonts (Ma Shan Zheng, ZCOOL KuaiLe) for artistic/brand themes. Use Google Fonts for cross-platform compatibility.

**Common Google Fonts Quick Reference**:

| Font Name | Type | Features | CDN Import |
|---------|------|------|---------|
| Ma Shan Zhen | Chinese Creative | Handwritten style, highly personalized | `@import url('https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap');` |
| Noto Sans SC | Chinese Sans-serif | Strong versatility, supports Chinese & English | `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;700&display=swap');` |
| Noto Serif SC | Chinese Serif | Elegant traditional, suitable for cultural themes | `@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap');` |
| ZCOOL KuaiLe | Chinese Creative | Handwritten style, highly personalized | `@import url('https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap');` |
| Roboto | English Sans-serif | Modern simplicity, Google default font | `@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;700&display=swap');` |
| Poppins | English Sans-serif | Rounded modern, suitable for titles | `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');` |
| Montserrat | English Sans-serif | Strong geometric feel, tech-style | `@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');` |
| Inter | English Sans-serif | High readability, suitable for body text | `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap');` |
| Playfair Display | English Serif | Premium elegance, suitable for high-end brands | `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap');` |

**Local Font Alternatives** (no loading needed, system built-in):
- **Cross-platform Safe Fonts**: Arial, Helvetica, Times New Roman, Georgia

## Phase 3: Generate Page Images

### 3.1 Scan Image Requirements

Extract all pages with **image requirements** marked from `${WORKSPACE_DIR}/docs/product/chapters.md`:

**Extraction Logic**:
```python
# Pseudocode example
image_tasks = []

for page in chapters:
    if page.image_requirements is not None and page.image_requirements != "":
        image_task = {
            "pageIndex": page.page_number,
            "pageTitle": page.page_title,
            "visualType": identify_image_type(page.image_requirements),  # Data chart/timeline/comparison chart, etc.
            "imageRequirements": page.image_requirements,  # Raw requirements, prompt generated later if needed
            "savePath": f"${WORKSPACE_DIR}/frontend/public/assets/images/page-{page.page_number}-{index}.png"
        }
        image_tasks.append(image_task)
```

**Image Type Identification**:
- **Data Visualization**: Curve charts, bar charts, pie charts, ring charts, radar charts, data cards
- **Process Display**: Timelines, step diagrams, flowcharts, route maps
- **Structure Display**: Four-grid, card sets, grid layout
- **Comparison Analysis**: Left-right comparison, A/B testing, pros/cons comparison
- **Concept Illustration**: Icon lists, illustrated text, scene schematic diagrams

### 3.2 Generate Detailed imagePrompt

**Prompt Generation Principles**:
1. **Specific Description**: Include chart type, data content, annotation information
2. **Style Unity**: Consistent with overall PPT style (business/tech/Chinese style, etc.)
3. **Clear Color Scheme**: Specify primary color system (e.g., "blue-purple gradient", "business blue tones")
4. **Generatability**: Ensure AI can understand and generate corresponding images

**Execution Flow**:
```python
# Generate prompts for all image tasks
for image_task in image_tasks:
    
    # Generate detailed prompt based on image requirements
    image_task["imagePrompt"] = generate_detailed_prompt(
        page_title=image_task["pageTitle"],
        visual_type=image_task["visualType"],
        requirements=image_task["imageRequirements"]
    )
```

### 3.3 Call ImageGen Tool to Generate Images

**Calling Method**: Use the `ImageGen` tool to generate images one by one

**ImageGen Tool Parameters**:
```json
{
  "prompt": "string",          // [Required] Image description text
  "size": "string",            // [Optional] Size, e.g., "1024x1024", "1024x1536"
  "n": "number",               // [Optional] Generation count, 1-10, default 1
  "quality": "string",         // [Optional] Quality: low, medium, high
  "style": "string",           // [Optional] Image style
  "background": "string",      // [Optional] Background: transparent, opaque
  "output_dir": "string"       // [Optional] Custom output directory
}
```

**Execution Flow**:
```python
# Pseudocode example
for image_task in image_tasks:
    # Call ImageGen tool
    ImageGen({
        "prompt": image_task["imagePrompt"],
        "size": "1024x1024",
        "quality": "high",
        "output_dir": "${WORKSPACE_DIR}/frontend/public/assets/images"
    })
    
    # Verify file exists
    save_path = image_task["savePath"]
    if not exists(save_path):
        error and stop
    
    # Record image path to image task
    image_task["generatedPath"] = save_path
```

**Key Rules**:
- ✅ **Batch Calling**: Generate images one by one using ImageGen tool
- ✅ **Unified Save Path**: Set `output_dir` to `${WORKSPACE_DIR}/frontend/public/assets/images/`
- ✅ **Validate Generation Results**: Immediately check if file exists after each image generation

### 3.4 Generate Image Mapping Table

**Output File**: `${WORKSPACE_DIR}/frontend/public/assets/images/images-mapping.json`

```json
{
  "5": {
    "imagePath": "assets/images/page-5.png",
  },
  "7": {
    "imagePath": "assets/images/page-7.png",
  }
}
```

**Key Notes**:
- Key is page number (string format)
- `imagePath` is relative to `${WORKSPACE_DIR}/frontend/public/` path

---

## Phase 4: Generate PPT Outline

Based on the collected information (${WORKSPACE_DIR}/docs/product/material.md, ${WORKSPACE_DIR}/docs/product/chapters.md), generate the PPT Outline (file: ${WORKSPACE_DIR}/docs/product/features.md). 
**CRITICAL: You MUST follow the template below to generate the `PPT Outline`. Do NOT modify the template structure.**

Format:
```features.md
# PPT Outline

## Overview
{{PPT Overview}}

## Outline Content
{{Outline Content - Extract directly from chapters.md, but MUST remove the following template-related fields: Selected Template, Page Weight, Content Density, Narrative Role, Image Requirements, and Notes. Keep only Page Type, Page Title, Page Subtitle, and Content Structure for each page}}

## Design Style
{{Design Style}}

```


## Phase 5: Environment Setup

### 5.1 Create Global Configuration File

Generate `${WORKSPACE_DIR}/docs/page-global-config.json`, containing style configurations shared by all pages:

```json
{
  "slideStyle": "${SlideStyle}",
  "colorScheme": "Modern Tech Style",
  "primaryColor": "#4285F4",
  "accentColor1": "#34A853",
  "accentColor2": "#FBBC04",
  "neutralColor": "#5F6368",
  "background": {
    "type": "color",
    "value": "#FFFFFF"
  },
  "fontTitle": "'Montserrat', 'Noto Sans SC', sans-serif",
  "fontBody": "'Inter', 'Noto Sans SC', sans-serif"
}
```

**Background Configuration Options**:

| Type | Example | Description |
|------|---------|-------------|
| `color` | `{"type": "color", "value": "#FFFFFF"}` | Solid color background |
| `image` | `{"type": "image", "value": "assets/images/bg.png"}` | Background image (relative to `${WORKSPACE_DIR}/frontend/public/`) |
| `gradient` | `{"type": "gradient", "value": "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)"}` | CSS gradient |

**When to use background image**:
- If a global background image was generated in Phase 3, set `type: "image"`
- If no background image, use `type: "color"` with appropriate color

**Important**: 
- `fontTitle` and `fontBody` values must be valid CSS `font-family` strings (with quotes around font names containing spaces)
- These values will be directly inserted into CSS variables in `index.html`
- **Font sizes are NOT configurable globally** - templates use Tailwind's built-in size classes (`text-4xl`, `text-xl`, etc.) which are optimized for each layout

Fill in corresponding values based on color scheme and font solution selected in Phase 2.

### 5.2 Update `${WORKSPACE_DIR}/frontend/index.html` Placeholders

- `{{PPT_TITLE}}` → PPT title
- `{{FONT_IMPORTS}}` → Google Fonts import links (see below)
- `{{PRIMARY_COLOR}}` → Primary color (hex, e.g., `#4285F4`)
- `{{ACCENT_COLOR_1}}` → Accent color 1 (hex)
- `{{ACCENT_COLOR_2}}` → Accent color 2 (hex)
- `{{NEUTRAL_COLOR}}` → Neutral color (hex)
- `{{SLIDE_BACKGROUND}}` → Slide background (see below)
- `{{FONT_TITLE}}` → Title font (e.g., `'Montserrat', 'Noto Sans SC', sans-serif`)
- `{{FONT_BODY}}` → Body font (e.g., `'Inter', 'Noto Sans SC', sans-serif`)

**Slide Background Configuration** (`{{SLIDE_BACKGROUND}}`):

Based on `background` config in `page-global-config.json`, generate the appropriate CSS value:

| Config Type | CSS Value Example |
|-------------|-------------------|
| `{"type": "color", "value": "#FFFFFF"}` | `#FFFFFF` |
| `{"type": "image", "value": "assets/images/bg.png"}` | `url('/assets/images/bg.png')` |
| `{"type": "gradient", "value": "linear-gradient(...)"}` | `linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)` |

**Usage in slide HTML** (Agent applies this in geniekit-ppt-creator):
```html
<!-- Use .slide-bg class on the main slide container -->
<div class="w-[1440px] h-[810px] slide-bg relative overflow-hidden">
  <!-- slide content -->
</div>
```

**Font Import Configuration** (`{{FONT_IMPORTS}}`):
Only import fonts that are actually used in `fontTitle` and `fontBody`. Example:

```html
<!-- If fontTitle uses Montserrat and fontBody uses Inter -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Inter:wght@300;400;600&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
```

**Common Font Import URLs**:
| Font Name | Import URL Parameter |
|-----------|---------------------|
| Noto Sans SC | `family=Noto+Sans+SC:wght@400;500;700` |
| Noto Serif SC | `family=Noto+Serif+SC:wght@400;700` |
| Montserrat | `family=Montserrat:wght@400;600;700` |
| Inter | `family=Inter:wght@300;400;600` |
| Poppins | `family=Poppins:wght@400;600;700` |
| Roboto | `family=Roboto:wght@300;400;700` |

**Note**: Always include `Noto Sans SC` as fallback for Chinese characters.

**Color Handling**:
- Templates use **Tailwind's built-in color classes** (e.g., `text-blue-500`, `bg-gray-800`)
- Each template style has its own built-in color scheme optimized for that style
- The CSS variable colors are available via custom utility classes for **additional customization**:

```html
<!-- Custom color utility classes (use CSS variables) -->
<h1 class="text-primary">使用主色 --primary-color</h1>
<div class="bg-accent-1">使用强调色1背景</div>
<span class="border-primary border-2">主色边框</span>

<!-- Slide background class -->
.slide-bg  /* Uses --slide-background, supports color/image */
```

**When to use custom colors vs Tailwind colors**:
- **Tailwind colors** (default): Templates already have coordinated color schemes
- **Custom colors**: When generating new content that needs to match PPT theme precisely

---

## Phase 6: Template Planning

**Objective**: For each page in `chapters.md`, select the appropriate template and update the file with template information. This enables parallel sub-agent execution in Phase 7.

---

### 6.1 Template Selection Process

#### Internal Checklist (Execute silently):

1. Read `${WORKSPACE_DIR}/docs/page-global-config.json` to get `${SlideStyle}`
2. Read ALL template index files for required page types
| Page Type | Index File Path |
|-----------|-----------------|
| Cover | `${CORE_DIR}/skills/ppt-implement/references/templates/cover/cover-pages-index.md` |
| TOC | `${CORE_DIR}/skills/ppt-implement/references/templates/toc/toc-pages-index.md` |
| Transition | `${CORE_DIR}/skills/ppt-implement/references/templates/transition/transition-pages-index.md` |
| Content | `${CORE_DIR}/skills/ppt-implement/references/templates/content/content-templates-index.md` |
| Ending | `${CORE_DIR}/skills/ppt-implement/references/templates/ending/ending-pages-index.md` |
3. For EACH page, internally analyze:
   - Image requirements (yes/no, position)
   - Bullet point count
   - Content density (Light/Medium/Heavy)
4. Apply matching rules below
5. Verify diversity requirements (no Content template used >2 times)
6. Update `chapters.md` directly with selections

#### 6.1.1 Template Matching Rules (Priority Order)

**Priority 1: Layout Structure Match** (MOST IMPORTANT)

| Page Characteristic | Required Template Description Keywords |
|---------------------|---------------------------------------|
| Has image | `image`, `photo`, `visual`, `picture` |
| No image | `text-only`, `content-focused`, `text` |
| Image on left | `image-left`, `left-image`, `photo-left` |
| Image on right | `image-right`, `right-image`, `photo-right` |

**Priority 2: Content Density Match**

| Bullet Point Count | Template Style Keywords |
|-------------------|------------------------|
| 1-2 points | `minimal`, `centered`, `spacious`, `hero` |
| 3-4 points | `balanced`, `two-column`, `standard` |
| 5+ points | `dense`, `list`, `multi-column`, `grid` |

**Priority 3: Visual Diversity** (ENFORCED)

- ❌ Same Content template used consecutively = VIOLATION
- ❌ Same Content template used >2 times total = VIOLATION
- ✅ Each Content page should have DIFFERENT template when possible

#### 6.1.2 Page Type Selection Guidelines

##### **Cover Page**
- Only select templates from `cover/${SlideStyle}/xxx.tpl`
- Match visual emphasis with content theme

##### **TOC Page**
- Only select templates from `toc/${SlideStyle}/xxx.tpl`
- Select layout based on chapter count:
  - 3-4 chapters: `centered`, `whitespace`, `large-title`
  - 5-6 chapters: `list`, `grid`, `multi-column`
  - 7+ chapters: `multi-image-grid`, `dense`, `two-column`

##### **Transition Page**
- Only select templates from `transition/${SlideStyle}/xxx.tpl`
- **Reuse the SAME template for ALL transition pages**

##### **Ending Page**
- Only select templates from `ending/${SlideStyle}/xxx.tpl`
- Match ending purpose (Thank-you/Q&A/Contact/Summary)

##### **Content Page**
- Only select templates from `content/${SlideStyle}/xxx.tpl`
- Apply Priority 1-3 matching rules
- ❌ Same template used consecutively = VIOLATION
- ❌ Same template used >2 times total = VIOLATION


```markdown
## Page N: Page Name
- **Page Type**: Cover/TOC/Transition/Content/Ending
- **Page Title**: XXX
- **Selected Template**: {templatePath}
... (other existing fields)
```

---

## Phase 7: Sequential PPT Generation

**CRITICAL: DO NOT use any other skill/command/agent to complete the following tasks.**

**CRITICAL: ONE PAGE AT A TIME**

You MUST generate slides **one by one**. For EACH page, you MUST:
1. Read its template file
2. Process content (adapt, handle images, check overflow)
3. Write its slide-{N}.js file
4. Then move to next page

**Even if you decide to "batch create" or "generate all pages"**, you MUST still execute the full single-page workflow (7.2-7.6) for EACH page. There is NO shortcut. Skipping steps will cause broken slides.

---

Read inputs ONCE before generating all slides:
- `${WORKSPACE_DIR}/docs/page-global-config.json` → global styles/colors
- `${WORKSPACE_DIR}/docs/product/chapters.md` → content for each page

### 7.1 For Each Page (Sequential Loop)

For each page in `${WORKSPACE_DIR}/docs/product/chapters.md`, execute steps 7.2-7.6:

### 7.2 Read Template

Read from: `${CORE_DIR}/skills/ppt-implement/references/templates/{chapters.page.selected_template}`

### 7.3 Apply Global Background

Find outermost `<div class="w-[1440px] h-[810px] ...">`, remove hardcoded backgrounds, add `slide-bg`:

```html
<!-- Before -->
<div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">

<!-- After -->
<div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden slide-bg">
```

Remove: `bg-white`, `bg-[#xxx]`, `bg-slate-*`, `bg-gradient-to-*`, etc. **CRITICAL: Never use gradient colors for background or text.**

### 7.4 Fill Content

**Content Adaptation:**

| Situation | Strategy |
|-----------|----------|
| Content items > template slots | Condense: merge similar points, max 6 items |
| Content items < template slots | Remove unused template elements entirely |
| Text too long for slot | Rewrite concisely, keep core message |

**Text Length Limits:**

| Element | CN | EN |
|---------|----|----|
| Title | ≤12 | ≤25 |
| Subtitle | ≤18 | ≤35 |
| Card Title | ≤10 | ≤20 |
| Body Line | ≤25 | ≤50 |

**Font Size Specs:** H1: 38-42px, H2: 30-32px, H3: 20-22px, Body: 16-18px, Annotation: 12-14px

**Handle Placeholder Images (CRITICAL):**

| Situation | Action |
|-----------|--------|
| Chapter has assigned image | Replace `src` with path from `images-mapping.json`, set explicit `width`/`height` |
| Chapter has NO image assigned | **DELETE the entire `<img>` element and its empty container** |

```html
<!-- Template placeholder -->
<div class="image-container">
  <img src="/placeholder.svg"/>
</div>

<!-- If NO image assigned → DELETE entirely (the whole div) -->

<!-- If image assigned → Replace src with explicit dimensions -->
<div class="image-container">
  <img src="/assets/images/page-5.png" width="400px" height="300px"/>
</div>
```

**⚠️ NEVER leave placeholder images** - they show as broken images!

### 7.5 Content Overflow Prevention

**Page Constraints**: Content area is `1350px × 720px`.

**Before writing, check and fix in priority order:**

| Priority | Check | Fix Strategy |
|----------|-------|--------------|
| 1 | Total items > 6 | Reduce to max 6 items |
| 2 | Text line > limit | Truncate/rewrite to fit char limits |
| 3 | Vertical stack too tall | Reduce `gap-*`/`space-y-*` (e.g., `gap-6`→`gap-3`) |
| 4 | Still too tall | Reduce font sizes by 1 level (e.g., `text-2xl`→`text-xl`) |
| 5 | Images too large | Set explicit `max-w-[Xpx] max-h-[Ypx]` |
| 6 | Cards overflow | Reduce `p-*` padding (e.g., `p-6`→`p-4`) |

**Quick Estimation**: Text line ≈ 24-32px, Card with title + 3 lines ≈ 120-150px, Gap ≈ 16-24px

### 7.6 Write Slide File

Write to `${WORKSPACE_DIR}/frontend/src/slides/slide-{N}.js`:

```javascript
window.slideDataMap.set({N}, `
  <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden slide-bg">
    <!-- Filled HTML content using Tailwind CSS -->
  </div>
`);
```

> `N` is integer (not string). Framework auto-loads via `window.slideDataMap`.

### 7.7 After All Slides Generated

Proceed directly to Phase 8. No manual wiring needed.
---

## **Phase 8**: Take PPT Screenshots

**⚠️ Phase 8 is the ONLY legitimate next step after Phase 7 completes. It MUST be executed immediately - DO NOT skip or delay!**

### 8.1 Take Screenshots

CRITICAL: The service is already running on port 5173 by default, no need to start it again.

**Execute the following command immediately (no user confirmation needed):**

```bash
python3 "${CORE_DIR}/skills/ppt-implement/scripts/screenshot-ppt.py" --url http://localhost:5173 --output ${WORKSPACE_DIR}/frontend/public/assets/images/posters/pages
```

### 8.2 Update poster Field in ${WORKSPACE_DIR}/docs/pages.json

**After screenshots are complete, immediately update the poster field (no user confirmation needed):**

```
"poster": "/assets/images/posters/pages/page-{N}.png",
```

Example:
```json
[
  {
    "pageKey": "ppt-1",
    "title": "",
    "url": "/index.html?page=1",
    "poster": "/assets/images/posters/pages/page-1.png",
    "pageNum": 1
  }
]
```
---

## Phase 9: Final Output

**⚠️ Output ONLY the following 3 lines, say nothing more:**

```
"{PPT_TOPIC}" PPT generation complete.
"presentation.pptx" generated.

Usage: Press ← → to navigate pages, press Space for next page
```

**🚫 NEVER output the following:**
- ❌ Tables (any form of tables)
- ❌ Page number lists
- ❌ File paths
- ❌ "Summary" / "总结"
- ❌ "All N pages completed"
- ❌ "Files generated to..."
- ❌ Any validation statements

---

## Phase 10: Handling User Modifications

**⚠️ This phase is ONLY triggered when users request modifications after initial PPT generation is complete.**
- First-time generation: Phase 1 → Phase 8, then STOP
- User requests changes: Enter Phase 9

### Understanding Slide File Structure

Each PPT page is stored in `${WORKSPACE_DIR}/frontend/src/slides/slide-N.js`, which registers HTML content to a global Map:

```javascript
// slide-N.js structure
window.slideDataMap.set(N, `
  <div class="...">
    <!-- Page N HTML content -->
  </div>
`);
```

The `ppt-controller.js` reads from `slideDataMap` and renders pages dynamically. **Therefore, modifying page content requires editing `slide-N.js` files.**

When users request modifications, determine which files need to be changed based on the scope of modification:

### 10.1 Modification Scope Identification

| Modification Type | Example | Files to Modify | Notes |
|-------------------|---------|-----------------|-------|
| **Single Page Content** | "Change the title of page 3 to..." | `chapters.md` → `slide-3.js` | Content only, no template change |
| **Add/Delete Pages** | "Add a page after page 5" | `chapters.md` → Create/delete `slide-N.js` | New pages need template selection |
| **Single Page Template** | "Change layout of page 4" | `chapters.md`(update Selected Template) → Regenerate `slide-4.js` | Switch template within same style |
| **Image Replacement** | "Replace the image on page 6" | `images-mapping.json` → `images/` directory → Update path in `slide-6.js` | May need to regenerate images |
| **Overall Style** | "Change to Chinese style" | See detailed flow below | **Largest impact scope** |

### 10.2 Overall Style Modification Flow

When users request a style change (e.g., "change to Chinese style", "make it more tech-looking"), modify the following files in order:

| Step | File | Changes |
|------|------|---------|
| 1 | `${WORKSPACE_DIR}/docs/page-global-config.json` | Update `slideStyle`, color scheme, font scheme |
| 2 | `${WORKSPACE_DIR}/frontend/index.html` | Update CSS variables (colors, font import links) |
| 3 | `${WORKSPACE_DIR}/docs/product/chapters.md` | **Re-select templates for ALL pages** (Phase 6 Template Planning) |
| 4 | `${WORKSPACE_DIR}/frontend/src/slides/slide-*.js` | **Regenerate ALL slide files** (Phase 7 Parallel Generation) |
| 5 | `${WORKSPACE_DIR}/frontend/public/assets/images/` | May need to regenerate some images to match new style |

**⚠️ Important Notes**:
- Style modification = Full redo of Phase 2 ~ Phase 7
- Templates are organized by style (e.g., `cover/chinese/`, `cover/business/`), changing style requires re-selecting all templates
- Transition page templates must be globally consistent, need to re-specify after style change

### 10.3 Modification Flow Summary

```
User requests modification
         │
         ▼
┌─────────────────────┐
│ Identify scope      │
└──────────┬──────────┘
           │
    ┌──────┴──────┬────────────┬────────────┐
    ▼             ▼            ▼            ▼
Single Page   Single Page   Add/Delete   Overall
 Content       Template      Pages        Style
    │             │            │            │
    ▼             ▼            ▼            ▼
  Update        Update       Update      Update
 chapters      chapters     chapters     config
    │             │            │            │
    ▼             ▼            ▼            ▼
 Regenerate   Regenerate   Create/Del   Re-select
 slide-N.js   slide-N.js   slide-N.js   all templates
                                           │
                                           ▼
                                      Regenerate
                                      ALL slide-*.js
```

## Export PPTX File

When user requests to export a PPTX file, run the following command:

```
node \"${CORE_DIR}/skills/ppt-implement/scripts/export-ppt.js\" \"${CORE_DIR}\" \"${WORKSPACE_DIR}\" > /dev/null 2>&1
```