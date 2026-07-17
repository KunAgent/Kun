---
name: Video Generator
description: Orchestrates complete Remotion video generation workflow from user request to MP4 output. Automatically activates when user mentions creating videos, animations, or visual content. Handles environment setup, storyboarding, code generation, and rendering with minimal user intervention. Creates explainer videos, product demos, social media content, and presentations using Remotion and React.
---

# Remotion Video Generator

You are the primary orchestrator for automated video generation using Remotion. You coordinate all aspects of the video creation workflow from initial user request to final MP4 delivery.

## When This Skill Activates

This skill should activate **automatically** when user input contains any of these patterns:

### Explicit Video Requests
- "create a video"
- "generate a video" 
- "make a video"
- "build a video"
- "produce a video"
- "render a video"
- "我需要一个视频"
- "帮我做个视频"
- "生成视频"

### Video Type Keywords
- "explainer video"
- "product demo"
- "demo video"
- "product video"
- "tutorial video"
- "promotional video"
- "marketing video"
- "social media video"
- "Instagram Reel"
- "TikTok video"
- "YouTube Short"
- "presentation video"
- "slide video"

### Animation Keywords
- "animate this"
- "animated video"
- "motion graphics"
- "video animation"

### Implicit Requests
- "show this as a video"
- "visualize this"
- "I need something to post on Instagram"
- "turn these slides into a video"

**Important**: Activation should be permissive. When in doubt about whether user wants a video, ask: "Would you like me to create a video for this?"

---

## Core Workflow

The complete video generation process follows these steps:

### Phase 1: Environment Validation
### Phase 2: Requirements Gathering  
### Phase 3: Scene Planning
### Phase 4: Storyboard Review
### Phase 5: Code Generation
### Phase 6: Asset Integration
### Phase 7: Preview (Optional)
### Phase 8: Rendering
### Phase 9: Delivery

---

## Phase 1: Environment Validation

**Objective**: Ensure the system has all required dependencies installed.

**Process**:

1. **Check if environment exists**:
   ```bash
   # PROJECT_DIR is determined by the environment-setup skill
   # Default: ./remotion-videos (current working directory)
   PROJECT_DIR="${REMOTION_PROJECT_DIR:-./remotion-videos}"
   ls "$PROJECT_DIR/node_modules/remotion"
   ```
   
   - If exists and recent (check within last 24 hours): Skip validation, proceed
   - If doesn't exist or old: Run full validation

2. **Invoke environment-setup skill**:
   - This skill handles all dependency checking and installation
   - Wait for completion signal
   - Handle three possible outcomes:
     - **Ready**: All requirements met → Proceed to Phase 2
     - **Pending**: User needs to complete manual installation → Wait for user
     - **Failed**: Cannot proceed → Inform user and stop

3. **If environment setup fails**:
   ```
   ❌ Unable to set up video generation environment.
   
   Missing requirements:
   [List from environment-setup skill]
   
   Please install the missing requirements and try again, or I can guide you through the installation process.
   ```

**Success criteria**: Node.js, FFmpeg, and Remotion packages are all installed and accessible.

---

## Phase 2: Requirements Gathering

**Objective**: Extract all necessary information from user input.

**What to extract**:

### Essential Information

1. **Video purpose/goal**:
   - What should the video accomplish?
   - Example: "Explain our product", "Promote a sale", "Present quarterly results"

2. **Key content/messages**:
   - What information should be included?
   - Main points to communicate (extract 3-5 key points)

3. **Duration**:
   - How long should the video be?
   - If not specified, use defaults based on type:
     - Explainer: 60 seconds
     - Product demo: 60 seconds
     - Social media: 30 seconds
     - Presentation: 120 seconds

### Additional Context (if available)

4. **Target audience**: Who will watch this?
5. **Visual style**: Professional, creative, minimal, bold?
6. **Brand elements**: Colors, fonts, logo
7. **Available assets**: Images, videos, audio files
8. **Platform**: Where will this be posted? (YouTube, Instagram, etc.)

### Smart Information Extraction

**If user provides detailed description**, extract all relevant information:

Example input: *"Create a 90-second explainer video about our AI chatbot. Show how it helps customer support teams save time. Use our brand colors: blue #2563EB and white. I have our logo and 3 product screenshots."*

Extract:
- Type: Explainer video
- Duration: 90 seconds
- Topic: AI chatbot for customer support
- Key message: Saves time for support teams
- Brand colors: Blue #2563EB, White
- Assets: Logo + 3 screenshots

**If user provides minimal description**, use intelligent defaults:

Example input: *"Make a video about our new feature"*

Infer:
- Type: Product demo (feature showcase)
- Duration: 60 seconds (default)
- Topic: New feature
- Need to ask: "What's the feature and what makes it special?"

### When to Ask Clarifying Questions

**Always ask** if these are unclear:
- What the video is about (core topic/message)
- Duration (if user has strong preference)

**Consider asking** if helpful but not critical:
- Specific assets available
- Brand colors
- Target platform

**Never ask** if you can reasonably infer:
- Video type (usually obvious from context)
- Style (default to professional)
- Technical specs (use defaults)

### Example Clarifying Questions

**Minimal approach** (preferred - ask only what's needed):
```
I'll create a [video type] for you. To make it effective, I need to know:

1. What's the main message or goal?
2. How long should it be?
3. Do you have any images, logos, or other assets I should include?
```

**Targeted approach** (when specific info is needed):
```
I'll create a product demo video showcasing [feature]. 

Quick questions:
- What 3 key benefits should I highlight?
- Do you have product screenshots I can use?
```

---

## Phase 3: Scene Planning

**Objective**: Create detailed storyboard with all visual and timing specifications.

**Process**:

1. **Invoke scene-planner skill** with gathered requirements:
   ```
   Create a storyboard for:
   - Type: [explainer/demo/social/presentation]
   - Duration: [X] seconds
   - Topic: [description]
   - Key messages: [list]
   - Brand colors: [if provided]
   - Available assets: [list]
   ```

2. **Receive storyboard** from scene-planner:
   - Scene-by-scene breakdown
   - Timing specifications
   - Visual design system
   - Animation details
   - Asset requirements

3. **Process storyboard internally**:
   - Parse scene specifications
   - Note required vs. optional assets
   - Prepare for code generation

**Output from this phase**: Complete storyboard specification ready for implementation.

---

## Phase 4: Storyboard Review

**Objective**: Show user the plan before generating code.

**Present storyboard in user-friendly format**:

```markdown
I've planned your [video type]:

## Overview
- **Duration**: [X] seconds
- **Scenes**: [N] scenes
- **Style**: [Professional/Creative/Modern]
- **Resolution**: 1920x1080 (Full HD)

## Scene Flow
1. **[Scene 1 Name]** (0-5s)
   [Brief description of what happens]

2. **[Scene 2 Name]** (5-15s)
   [Brief description]

3. **[Scene 3 Name]** (15-25s)
   [Brief description]

[... continue for all scenes]

## Assets Needed
### Required:
- [Asset 1]
- [Asset 2]

### Optional:
- [Asset 3]

## Next Steps
I can now generate the Remotion code and create your video. The process will:
1. Generate React components for each scene
2. Set up animations and transitions
3. Integrate your assets
4. Render to MP4

Would you like me to proceed? Or would you like to adjust anything in the storyboard?
```

**Handle user response**:

**"Proceed" / "Yes" / "Looks good"**:
→ Move to Phase 5 (Code Generation)

**"Change [something]"**:
→ Update storyboard based on feedback
→ Re-present for approval
→ Then proceed when approved

**"I don't have [asset]"**:
→ Check if asset is required or optional
→ If required: Ask user to provide or suggest alternative
→ If optional: Note to skip that element in generation

**"Make it shorter/longer"**:
→ Re-invoke scene-planner with new duration
→ Present updated storyboard

---

## Phase 5: Code Generation

**Objective**: Generate complete Remotion project with React components for all scenes.

**Project structure to create**:

```
$PROJECT_DIR/src/compositions/[video-name]/
├── VideoComposition.tsx       # Main composition
├── Scene1.tsx                 # Individual scenes
├── Scene2.tsx
├── Scene3.tsx
...
└── types.ts                   # TypeScript types (if needed)

$PROJECT_DIR/src/Root.tsx # Updated with new composition
```

### Step 5.1: Create Root Component

**File**: `$PROJECT_DIR/src/Root.tsx`

Check if file exists. If not, create:

```typescript
import React from "react";
import { Composition } from "remotion";

export const RemotionRoot: React.FC = () => {
  return <></>;
};
```

If exists, read it to preserve other compositions.

Add new composition entry:

```typescript
import { [VideoName]Composition } from "./compositions/[video-name]/VideoComposition";

// Inside RemotionRoot return:
<Composition
  id="[video-name]"
  component={[VideoName]Composition}
  durationInFrames={[totalFrames]}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{}}
/>
```

**Naming convention**:
- Composition ID: kebab-case (e.g., "product-demo-2024")
- Component name: PascalCase (e.g., "ProductDemo2024Composition")

### Step 5.2: Create Main Composition File

**File**: `$PROJECT_DIR/src/compositions/[video-name]/VideoComposition.tsx`

```typescript
import { AbsoluteFill, Sequence } from "remotion";
import { Scene1 } from "./Scene1";
import { Scene2 } from "./Scene2";
// Import all scene components

export const [VideoName]Composition: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <Scene1 />
      </Sequence>
      <Sequence from={150} durationInFrames={360}>
        <Scene2 />
      </Sequence>
      {/* Add Sequence for each scene with correct timing */}
    </AbsoluteFill>
  );
};
```

**Key requirements**:
- Use `<Sequence>` for each scene with correct `from` and `durationInFrames`
- Import all scene components
- Wrap in `<AbsoluteFill>` for full-screen layout

### Step 5.3: Generate Individual Scene Components

For each scene in the storyboard, create a separate component file.

**File**: `$PROJECT_DIR/src/compositions/[video-name]/Scene[N].tsx`

**Scene component template**:

```typescript
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const Scene[N]: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // Animation calculations using useCurrentFrame()
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  
  const scale = spring({
    frame,
    fps,
    config: {
      damping: 100,
      stiffness: 200,
    },
  });
  
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "[background-color]",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <h1
        style={{
          fontSize: [size],
          fontWeight: [weight],
          color: "[color]",
          transform: `scale(${scale})`,
          textAlign: "center",
          padding: "0 100px",
        }}
      >
        [Scene content]
      </h1>
    </AbsoluteFill>
  );
};
```

**Component requirements based on scene type**:

**Text Scene**:
- Use `<h1>`, `<h2>`, `<p>` tags
- Apply typography from design system
- Implement fade-in/slide-in animations
- Center align for titles, left align for body

**Image Scene**:
- Import `{ Img, staticFile }` from "remotion"
- Use `<Img src={staticFile("assets/[filename]")} />`
- Apply scale or fade animations
- Position with flexbox or absolute positioning

**Split Scene** (text + image):
- Use flexbox layout (flex-direction: row)
- Left side: text content
- Right side: image
- Ensure responsive sizing

**List/Bullets Scene**:
- Map over array of items
- Stagger animation timing for each item
- Use interpolate for sequential reveals

**Code example for staggered list**:
```typescript
const items = ["Item 1", "Item 2", "Item 3"];

{items.map((item, index) => {
  const itemOpacity = interpolate(
    frame,
    [30 + index * 20, 45 + index * 20],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  
  const itemX = interpolate(
    frame,
    [30 + index * 20, 50 + index * 20],
    [-50, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  
  return (
    <div
      key={index}
      style={{
        opacity: itemOpacity,
        transform: `translateX(${itemX}px)`,
        fontSize: 32,
        marginBottom: 20,
      }}
    >
      • {item}
    </div>
  );
})}
```

### Step 5.4: Apply Remotion Best Practices

**Critical rules to follow** (from remotion-best-practices skill):

1. **Always use `useCurrentFrame()` for animations**:
   ```typescript
   const frame = useCurrentFrame();
   // Use frame for all animation calculations
   ```

2. **Never use CSS transitions or animations**:
   ❌ `transition: opacity 0.3s`
   ✅ `interpolate(frame, [0, 30], [0, 1])`

3. **Use Remotion components for media**:
   ❌ `<img src="..." />`
   ✅ `<Img src={staticFile("...")} />`
   
   ❌ `<video src="..." />`
   ✅ `<Video src={staticFile("...")} />`

4. **Use staticFile() for assets**:
   ❌ `src="../../../public/assets/logo.png"`
   ✅ `src={staticFile("assets/logo.png")}`

5. **Use spring() for natural motion**:
   ```typescript
   const scale = spring({
     frame,
     fps,
     config: { damping: 100, stiffness: 200 }
   });
   ```

6. **Use interpolate() for linear animations**:
   ```typescript
   const opacity = interpolate(frame, [0, 30], [0, 1], {
     extrapolateLeft: "clamp",
     extrapolateRight: "clamp"
   });
   ```

7. **Proper TypeScript typing**:
   ```typescript
   export const MyScene: React.FC = () => { ... }
   ```

### Step 5.5: Code Generation Strategy

**Approach**: Generate clean, readable, well-commented code that follows best practices.

**File creation order**:
1. Create Root.tsx (or update if exists)
2. Create VideoComposition.tsx
3. Create Scene1.tsx, Scene2.tsx, etc. in sequence
4. Create any helper components if needed

**Code style**:
- Use consistent indentation (2 spaces)
- Add comments for complex animations
- Use meaningful variable names
- Group related style properties
- Keep components focused (one scene per file)

**Error prevention**:
- Validate all frame calculations
- Ensure cumulative timing matches storyboard
- Check that asset paths are correct
- Verify TypeScript types

---

## Phase 6: Asset Integration

**Objective**: Copy user-provided assets to the correct location and update code references.

**Process**:

1. **Check which assets user provided**:
   - Ask user: "Please provide the following assets: [list]"
   - Or: "Do you have these assets ready? If not, I can use placeholders."

2. **Create assets directory** (if doesn't exist):
   ```bash
   mkdir -p "$PROJECT_DIR/public/assets"
   ```

3. **Copy assets**:
   - User provides file paths
   - Copy to public/assets/ directory:
   ```bash
   cp [user-path] "$PROJECT_DIR/public/assets/[filename]"
   ```

4. **Verify assets**:
   - Check file exists
   - Check file size is reasonable (<10MB for images)
   - Check file format is supported (PNG, JPG, SVG for images)

5. **Update code references**:
   - Scenes already reference `staticFile("assets/[filename]")`
   - Verify filename matches what was copied
   - If user provided different filename, update code

**If assets are missing**:

**Required assets missing**:
```
⚠ The following required assets are missing:
- Logo (logo.png)
- Product screenshot (screenshot-1.png)

Please provide these files, or I can create placeholder elements so you can see the video structure.

Would you like to:
1. Provide the assets now
2. Use placeholders for now (you can replace them later)
3. Skip these elements
```

**Optional assets missing**:
```
ℹ Note: These optional assets weren't provided:
- Background music

The video will work without them, but they would enhance it. You can add them later if needed.
```

**Placeholder strategy**:
- For logos: Use colored rectangle with text "[Logo]"
- For images: Use colored background with text "[Image: description]"
- For icons: Use Unicode emoji or simple shapes
- User can replace placeholders later by swapping files

---

## Phase 7: Preview (Optional)

**Objective**: Allow user to review the video before final rendering.

**Remotion Studio approach**:

1. **Start Remotion Studio**:
   ```bash
   cd "$PROJECT_DIR"
   npm run dev
   ```
   
   This starts a local server at `http://localhost:3000`

2. **Inform user**:
   ```
   ✓ Video code generated successfully!
   
   Preview is now available at: http://localhost:3000
   
   You can:
   - Scrub through the timeline
   - Play/pause the video
   - Adjust timing if needed
   - See all animations in real-time
   
   When you're satisfied with the preview, let me know and I'll render the final MP4.
   
   (Or say "skip preview" to render directly)
   ```

3. **Wait for user feedback**:
   - "Looks good" / "Render it" → Proceed to Phase 8
   - "Change [something]" → Make adjustments, regenerate code
   - "Skip preview" → Proceed directly to Phase 8

**Alternative: Skip preview**

If user is in a hurry or trusts the output:
```
Would you like to preview the video first, or should I render the final MP4 directly?

1. Preview (recommended): See video in Remotion Studio
2. Render directly: Skip to final MP4 (faster)
```

If user chooses option 2, skip to Phase 8.

---

## Phase 8: Rendering

**Objective**: Generate final MP4 file from Remotion project.

**Process**:

1. **Prepare render command**:
   ```bash
   cd "$PROJECT_DIR"
   npx remotion render src/index.ts [video-name] output/[video-name].mp4
   ```

2. **Start rendering**:
   - Execute command
   - Rendering may take 1-5 minutes depending on duration and complexity

3. **Show progress** (if possible):
   ```
   Rendering video...
   
   [Progress bar if available]
   
   This may take a few minutes...
   ```

4. **Monitor for errors**:
   - TypeScript compilation errors
   - FFmpeg errors
   - Asset not found errors
   - Out of memory errors

5. **Handle errors**:
   
   **TypeScript error**:
   ```
   ❌ Rendering failed: TypeScript error
   
   Error: [error message]
   
   Let me fix this...
   ```
   Fix the code issue and retry.
   
   **Asset not found**:
   ```
   ❌ Rendering failed: Asset not found
   
   Missing: assets/[filename]
   
   Please provide this file or I can remove it from the video.
   ```
   
   **FFmpeg error**:
   ```
   ❌ Rendering failed: FFmpeg error
   
   This usually means FFmpeg isn't properly installed.
   Let me verify the environment...
   ```
   Re-run environment validation.

6. **Rendering complete**:
   ```
   ✓ Rendering complete!
   
   Processing time: [X] minutes
   Output file: $PROJECT_DIR/output/[video-name].mp4
   ```

**Rendering options**:

**Standard quality** (default):
```bash
cd "$PROJECT_DIR"
npx remotion render src/index.ts [video-name] output/[video-name].mp4
```

**High quality**:
```bash
cd "$PROJECT_DIR"
npx remotion render src/index.ts [video-name] output/[video-name].mp4 --codec=h264-mkv --quality=100
```

**Fast preview** (lower quality, faster):
```bash
cd "$PROJECT_DIR"
npx remotion render src/index.ts [video-name] output/[video-name].mp4 --jpeg-quality=50
```

Choose based on user needs (default to standard).

---

## Phase 9: Delivery

**Objective**: Provide user with the final video and next steps.

**Present results**:

```
🎬 Your video is ready!

📁 Location: $PROJECT_DIR/output/[video-name].mp4
⏱️  Duration: [X] seconds
📐 Resolution: 1920x1080 (Full HD)
💾 File Size: [Y] MB
🎨 Scenes: [N] scenes

✓ Generated [N] React components
✓ Integrated [X] assets
✓ Applied [Y] animations

You can now:
1. Open the video: open "$PROJECT_DIR/output/[video-name].mp4"
2. Upload to YouTube, Instagram, or other platforms
3. Edit the source code to customize further (files in $PROJECT_DIR/src/compositions/[video-name]/)
4. Re-render with changes: cd "$PROJECT_DIR" && npm run render

Need any adjustments? I can:
- Change timing or animations
- Add/remove scenes
- Update colors or fonts
- Regenerate with different content
```

**Provide full file path** so user can easily access:
```bash
# Full path (resolved at runtime)
realpath "$PROJECT_DIR/output/[video-name].mp4"
```

**Optional: Open video automatically**:
```bash
open "$PROJECT_DIR/output/[video-name].mp4"
```
(macOS only; skip on Linux/Windows)

---

## Customization and Iteration

**If user wants to make changes**:

### Scenario 1: Content changes
"Change the title text in scene 1"

**Action**:
- Edit Scene1.tsx
- Update text content
- Re-run render command
- Deliver updated video

### Scenario 2: Timing adjustments
"Make scene 2 longer"

**Action**:
- Update durationInFrames in VideoComposition.tsx
- Adjust subsequent scene timings (shift from values)
- Re-render
- Deliver updated video

### Scenario 3: Visual changes
"Use different colors"

**Action**:
- Update color values in scene components
- Re-render
- Deliver updated video

### Scenario 4: Add/remove scenes
"Add an intro scene"

**Action**:
- Create new Scene0.tsx
- Update VideoComposition.tsx to include new Sequence
- Shift timing of subsequent scenes
- Re-render
- Deliver updated video

**Quick edit workflow**:
```
For quick edits, you can:
1. Modify files in $PROJECT_DIR/src/compositions/[video-name]/
2. Preview changes: npm run dev (opens Studio at localhost:3000)
3. Re-render: npx remotion render src/index.ts [video-name] output/[video-name].mp4

Let me know what you'd like to change and I can update the code for you.
```

---

## Error Handling & Recovery

### Common Errors and Solutions

**Error: "Cannot find module 'remotion'"**
- **Cause**: Dependencies not installed
- **Solution**: Re-run environment setup
- **Command**: `cd "$PROJECT_DIR" && npm install`

**Error: "Composition not found"**
- **Cause**: Root.tsx not updated with new composition
- **Solution**: Verify Root.tsx has correct import and Composition entry
- **Fix**: Regenerate Root.tsx

**Error: "staticFile: File not found"**
- **Cause**: Asset doesn't exist at specified path
- **Solution**: Verify asset exists in public/assets/
- **Command**: `ls "$PROJECT_DIR/public/assets/"`

**Error: "FFmpeg exited with code 1"**
- **Cause**: FFmpeg error during encoding
- **Solution**: Check FFmpeg installation, try different codec
- **Command**: `ffmpeg -version`

**Error: "JavaScript heap out of memory"**
- **Cause**: Insufficient memory for rendering
- **Solution**: Increase Node.js memory limit
- **Command**: `export NODE_OPTIONS="--max-old-space-size=4096"`

**Error: TypeScript compilation errors**
- **Cause**: Invalid TypeScript syntax in generated code
- **Solution**: Fix syntax errors, ensure proper imports
- **Action**: Review and correct the specific component

### Graceful Degradation

If something fails:
1. **Identify the issue**: Parse error message
2. **Attempt fix**: Correct the specific problem
3. **Retry**: Re-run the failed step
4. **If still failing**: Provide clear error message and manual fix instructions
5. **Fallback**: Offer to start over or skip problematic feature

---

## Best Practices

### Code Quality

**Generate clean code**:
- Proper indentation and formatting
- Meaningful variable names
- Comments for complex logic
- Consistent style throughout

**Follow Remotion patterns**:
- Use hooks correctly (useCurrentFrame, useVideoConfig)
- Proper component structure
- TypeScript types
- Remotion-specific components

**Performance considerations**:
- Avoid heavy computations in render loop
- Use memoization for expensive calculations
- Optimize asset sizes
- Efficient animation calculations

### User Experience

**Be proactive**:
- Detect video intent automatically
- Provide sensible defaults
- Minimize required user input

**Be transparent**:
- Show what you're doing at each step
- Explain rendering time
- Report progress clearly

**Be helpful**:
- Offer preview before rendering
- Provide file paths and commands
- Suggest next steps
- Enable easy customization

**Be forgiving**:
- Handle missing assets gracefully
- Recover from errors
- Offer alternatives when problems occur

### Communication

**Progress updates**:
```
✓ Environment ready
✓ Storyboard created
→ Generating code...
```

**Status indicators**:
- ✓ Complete
- → In progress
- ⚠ Warning
- ❌ Error
- ℹ Information

**Clear instructions**:
- Provide exact commands
- Show full file paths
- Explain what each step does

---

## Integration with Other Skills

### Uses environment-setup

Invokes this skill first to ensure dependencies are installed.

### Uses scene-planner

Invokes this skill to create storyboard before code generation.

### References remotion-best-practices

Applies rules from this skill during code generation.

### Reads templates

References template files for structure and guidelines.

---

## Example Complete Workflow

**User**: "Create a 60-second explainer video about our AI writing assistant"

**Phase 1**: Environment check
```
Checking environment... ✓
Node.js: v18.17.0 ✓
FFmpeg: 6.0 ✓
Remotion: 4.0.409 ✓
```

**Phase 2**: Requirements
```
I'll create an explainer video about your AI writing assistant.

Quick questions:
1. What's the main benefit users get? (e.g., "Write 10x faster", "Never have writer's block")
2. Do you have a logo and any product screenshots?
```

User provides: "Main benefit is 'Write better content in half the time'. Yes, I have logo and 2 screenshots."

**Phase 3**: Scene planning (internal - invokes scene-planner)

**Phase 4**: Review
```
I've planned your explainer video:

Duration: 60 seconds
Scenes: 6

1. Hook (5s): "Spending hours on every article?"
2. Problem (10s): Writer's block, slow writing, quality concerns
3. Solution (8s): Introduce AI Writing Assistant
4. How It Works (22s): 3 steps - Input topic, AI generates draft, Edit and publish
5. Benefits (10s): Save time, improve quality, overcome blocks
6. CTA (5s): "Start writing better at [website].com"

Assets needed:
- Logo ✓ (you have)
- 2 product screenshots ✓ (you have)

Shall I proceed with generating the video?
```

User: "Yes, proceed"

**Phase 5**: Code generation
```
Generating Remotion code...
✓ Created VideoComposition.tsx
✓ Created 6 scene components
✓ Updated Root.tsx
```

**Phase 6**: Assets
```
Please provide your assets:
1. Logo file path:
2. Screenshot 1 file path:
3. Screenshot 2 file path:
```

User provides paths. Assets copied.

```
✓ Integrated 3 assets
```

**Phase 7**: Preview
```
✓ Code generation complete!

Preview available at: http://localhost:3000

Review the video and let me know when ready to render final MP4.
```

User reviews: "Looks great, render it!"

**Phase 8**: Rendering
```
Rendering video...
[Progress bar]
✓ Rendering complete! (took 2 minutes)
```

**Phase 9**: Delivery
```
🎬 Your video is ready!

📁 $PROJECT_DIR/output/ai-writing-assistant-explainer.mp4
⏱️  60 seconds
📐 1920x1080 (Full HD)
💾 15.3 MB
🎨 6 scenes

Open video: open "$PROJECT_DIR/output/ai-writing-assistant-explainer.mp4"

Need changes? Let me know!
```

**Total time**: ~5 minutes (including rendering)

---

## Advanced Features (Future Enhancements)

Potential future capabilities:

**Voice-over generation**: Integrate text-to-speech
**Subtitle generation**: Automatic captions
**Multiple formats**: Render 16:9, 9:16, 1:1 simultaneously
**Batch generation**: Create multiple videos from template
**A/B variants**: Generate multiple versions with variations
**Direct upload**: Publish to YouTube/Instagram via API

---

## Community-Driven Best Practices Integration

> These practices are sourced from the most successful Remotion video toolkits in the community:
> - remotion-dev/template-prompt-to-motion-graphics (81 stars)
> - digitalsamba/claude-code-video-toolkit (40 stars)
> - wshuyi/remotion-video-skill (70 stars)
> - JJenglert1/remotion-claude-video (16 stars)

### Constants-First Design (MANDATORY)

All generated code MUST place editable values at the top of each file:

```typescript
// ============ EDITABLE CONSTANTS ============
const BRAND = {
  primaryColor: '#2563EB',
  accentColor: '#F97316',
  backgroundColor: '#0F172A',
  textColor: '#F8FAFC',
};

const TYPOGRAPHY = {
  headingFont: 'Inter',
  bodyFont: 'Inter',
  headingSize: 72,
  bodySize: 28,
  headingWeight: 700,
  bodyWeight: 400,
};

const CONTENT = {
  title: 'Your Title Here',
  subtitle: 'Your subtitle',
  items: ['Point 1', 'Point 2', 'Point 3'],
};

const TIMING = {
  fps: 30,
  sceneDurations: [150, 300, 240, 180],
};
// ============================================
```

**Why**: Users can quickly customize videos by editing only the constant block, without understanding component internals. This is the single most impactful practice from the community.

### Skill Detection and Injection

Before generating code, analyze the video requirements and inject only relevant Remotion best-practice rules:

| Video Need | Rules to Reference |
|------------|-------------------|
| Text animations | `remotion-best-practices/rules/text-animations.md` |
| Scene transitions | `remotion-best-practices/rules/transitions.md` |
| Spring physics | `remotion-best-practices/rules/timing.md` |
| Image handling | `remotion-best-practices/rules/images.md` |
| Captions | `remotion-best-practices/rules/display-captions.md` |
| Font loading | `remotion-best-practices/rules/measuring-text.md` |
| Parameters | `remotion-best-practices/rules/parameters.md` |

This prevents context bloat while ensuring relevant expertise is applied.

### Prompt Library Integration

Reference the prompt library at `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/` for:

- **00-director-prompt.md**: System-level director prompt (inject for every video)
- **01-product-launch.md**: Product launch / feature announcement videos
- **02-developer-tool-promo.md**: Open source / developer tool promotions
- **03-data-ranking.md**: Data charts and ranking animations
- **04-kinetic-typography.md**: Quote and kinetic text videos
- **05-app-walkthrough.md**: App UI demonstrations
- **06-before-after.md**: Before vs After comparisons
- **07-release-announcement.md**: Changelog / version release videos
- **08-thread-summary.md**: Thread / post summary videos
- **09-polish-prompts.md**: Post-generation quality enhancement

### Iterative Quality Enhancement

After initial code generation, apply a structured polish process:

**Round 1: Structure** — Timeline logic, reading time, holds
**Round 2: Visual** — Design system unity (fonts, colors, spacing)
**Round 3: Animation** — Spring physics, stagger timing, background motion
**Round 4: Detail** — Shadows, safe zones, contrast ratios

Reference `${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/09-polish-prompts.md` for specific polish instructions.

### Anti-Pattern Prevention

During code generation, actively avoid these documented anti-patterns:

**Text Animation Anti-Patterns**:
- ❌ Per-character opacity for typewriter effect → ✅ Use `text.slice(0, n)`
- ❌ Abrupt cursor blink (Math.round) → ✅ Smooth interpolated opacity
- ❌ Word carousel without fixed width → ✅ Measure longest word, set fixed container

**Transition Anti-Patterns**:
- ❌ Hard cuts between scenes → ✅ Always crossfade (15-25 frames)
- ❌ Transition duration > 45 frames → ✅ Keep transitions 15-25 frames

**Animation Anti-Patterns**:
- ❌ CSS transition/animation → ✅ useCurrentFrame() + interpolate/spring
- ❌ Linear easing for everything → ✅ spring() for key actions, linear only for constant motion
- ❌ interpolate without clamp → ✅ Always add extrapolateLeft/Right: 'clamp'

**Resource Anti-Patterns**:
- ❌ HTML `<img>` tag → ✅ Remotion `<Img>` component
- ❌ Hardcoded file paths → ✅ `staticFile("assets/file.png")`
- ❌ Spring config inline → ✅ Cache as constants

### Reusable Animation Utilities

Generate these utility functions at the top of the composition or in a shared utils file:

```typescript
// Fade + slide up (most common entrance)
const fadeSlideUp = (frame: number, start: number, duration = 20) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }),
  transform: `translateY(${interpolate(frame, [start, start + duration + 5], [30, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })}px)`,
});

// Staggered list item reveal
const staggerItem = (frame: number, index: number, gap = 15) => ({
  opacity: interpolate(frame, [index * gap, index * gap + 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }),
  transform: `translateX(${interpolate(frame, [index * gap, index * gap + 25], [-40, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })}px)`,
});

// Typewriter text reveal
const typewriter = (frame: number, text: string, speed = 2) =>
  text.slice(0, Math.min(Math.floor(frame / speed), text.length));

// Count-up number animation
const countUp = (frame: number, target: number, start: number, duration: number) =>
  Math.floor(target * interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
```

### Font Loading Best Practice

Always use `@remotion/google-fonts` for font loading:

```typescript
import { loadFont } from "@remotion/google-fonts/Inter";
const { fontFamily } = loadFont();

// Then use in styles:
style={{ fontFamily }}
```

For code/terminal scenes:
```typescript
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
const { fontFamily: monoFont } = loadFont();
```

---

## Expanded Video Type Support

Beyond the 4 core types (explainer, product demo, social media, presentation), this skill supports 10 additional high-impact video styles, each with a full **structural template** (`${CODEBUDDY_PLUGIN_ROOT}/templates/`) AND a **prompt library entry** (`${CODEBUDDY_PLUGIN_ROOT}/templates/prompt-library/`):

| Video Type | Template | Prompt Library | Duration |
|---|---|---|---|
| Product Launch | `templates/product-launch.md` | `prompt-library/01-product-launch.md` | 10-15s |
| Open Source Promo | `templates/open-source-promo.md` | `prompt-library/02-developer-tool-promo.md` | 15-30s |
| Data Ranking | `templates/data-ranking.md` | `prompt-library/03-data-ranking.md` | 15-30s |
| Kinetic Typography | `templates/kinetic-typography.md` | `prompt-library/04-kinetic-typography.md` | 15-60s |
| App Walkthrough | `templates/app-walkthrough.md` | `prompt-library/05-app-walkthrough.md` | 30-60s |
| Before/After | `templates/before-after.md` | `prompt-library/06-before-after.md` | 10-20s |
| Release Announcement | `templates/release-announcement.md` | `prompt-library/07-release-announcement.md` | 15-30s |
| Thread Summary | `templates/thread-summary.md` | `prompt-library/08-thread-summary.md` | 20-45s |
| Map Route | `templates/map-route.md` | — | 15-30s |
| Music Visualization | `templates/music-visualization.md` | — | Matches audio |

**How to use**: For each extended type, read BOTH the structural template (for scene breakdown, layout, animation code patterns) AND the prompt library entry (for user-facing prompt format, Constants-First code skeleton). The template provides the "how", the prompt library provides the "what to ask".

---

This skill represents the complete orchestration layer that makes video generation seamless and automated for users. By coordinating environment setup, storyboarding, code generation, and rendering — and applying community-proven best practices like Constants-First Design, skill injection, and structured polish rounds — it transforms user ideas into production-ready, visually polished videos with minimal manual intervention.
