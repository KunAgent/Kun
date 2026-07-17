# Remotion Video Generator Plugin

Automatically generate beautiful, production-quality videos using Remotion with minimal user intervention. This CodeBuddy Code plugin detects when you want to create a video, handles environment setup, creates storyboards, generates React code, and renders to MP4 — all automatically.

## Features

- **Automatic Detection**: Activates when you mention video, animation, or visual content creation
- **Environment Setup**: Automatically installs and configures Node.js, FFmpeg, and Remotion dependencies
- **Intelligent Planning**: Creates detailed storyboards with scene breakdowns, timing, and visual specifications
- **Multiple Video Types**:
  - **Explainer Videos**: Educational content explaining concepts or products (60-180s)
  - **Product Demos**: Showcase features and UI with annotations (30-90s)
  - **Social Media**: Short-form vertical content for Instagram/TikTok (15-60s)
  - **Presentations**: Slide-based professional presentations (120-300s)
- **Best Practices Built-In**: Follows official Remotion guidelines for animations, performance, and code quality
- **Asset Integration**: Seamlessly incorporates your logos, images, and brand elements
- **Customizable Output**: Edit generated React code to fine-tune any aspect

## Installation

### Install Plugin

```bash
# Using CodeBuddy Code plugin manager
cc --plugin install remotion-video-generator

# Or copy to your plugins directory
cp -r remotion-video-generator ~/.codebuddy-plugins/
```

### System Requirements

The plugin will automatically check and help you install:

- **Node.js** v16 or higher
- **FFmpeg** (any recent version)
- **npm** (comes with Node.js)

**Supported Platforms:**
- macOS (primary)
- Linux (Ubuntu, Debian, Fedora)
- Windows (via WSL recommended)

## Quick Start

Just tell CodeBuddy Code what video you want:

```
You: "Create a 60-second explainer video about our task management app"

CodeBuddy: [Checks environment, creates storyboard, generates code, renders MP4]

🎬 Your video is ready!
📁 ./remotion-videos/output/task-app-explainer.mp4
```

## Usage Examples

### Explainer Video

```
Create an explainer video about our AI chatbot that helps customer support teams.
Show the problem (slow responses), our solution (instant AI answers), and benefits.
Use our brand color #2563EB.
```

### Product Demo

```
Make a product demo showcasing our dashboard's key features:
- Real-time analytics
- Team collaboration
- Export reports
I have 3 screenshots to include.
```

### Social Media

```
Create a vertical Instagram Reel (30 seconds) promoting our new feature.
Make it bold and attention-grabbing with our logo.
```

### Presentation

```
Convert my quarterly report into a video presentation:
- Title slide
- 5 data slides with charts
- Summary
Professional, corporate style.
```

## How It Works

### 1. Automatic Activation

The plugin detects when you want to create a video from keywords like:
- "create a video"
- "explainer video"
- "product demo"
- "make a video showing..."

### 2. Environment Setup

On first use, the plugin:
- Checks for Node.js and FFmpeg
- Installs missing dependencies (with your permission)
- Sets up Remotion project structure in `./remotion-videos` (current working directory)
- Override with `REMOTION_PROJECT_DIR` environment variable if needed

### 3. Scene Planning

The plugin:
- Analyzes your requirements
- Determines video type
- Creates detailed storyboard with scenes, timing, and animations
- Defines visual design system (colors, fonts, spacing)

### 4. Code Generation

The plugin generates:
- Remotion Root component
- Main video composition
- Individual scene components (React + TypeScript)
- Animation code using Remotion hooks
- Asset integration with staticFile()

### 5. Rendering

The plugin:
- Copies your assets to the project
- Renders video to MP4 using FFmpeg
- Delivers final file with full path

## Project Structure

After video generation, your project looks like:

```
./remotion-videos/
├── src/
│   ├── Root.tsx                          # Root component
│   ├── compositions/
│   │   └── [video-name]/
│   │       ├── VideoComposition.tsx      # Main composition
│   │       ├── Scene1.tsx                # Individual scenes
│   │       ├── Scene2.tsx
│   │       └── Scene3.tsx
├── public/
│   └── assets/                           # Your images, logos, etc.
│       ├── logo.png
│       └── screenshot-1.png
├── output/
│   └── [video-name].mp4                  # Rendered videos
├── package.json
├── remotion.config.ts
└── node_modules/
```

## Customization

### Edit Generated Code

All videos are generated as React components. You can edit them:

```bash
# Open project in your editor
code ./remotion-videos

# Edit any scene
open ./remotion-videos/src/compositions/[video-name]/Scene1.tsx
```

### Preview Changes

```bash
cd ./remotion-videos
npm run dev
```

Opens Remotion Studio at `http://localhost:3000` to preview your changes.

### Re-render

```bash
cd ./remotion-videos
npx remotion render src/index.ts [video-name] output/[video-name].mp4
```

## Video Templates

The plugin includes 4 professional templates:

### Explainer Video Template
- **Structure**: Hook → Problem → Solution → How It Works → Benefits → CTA
- **Duration**: 60-180 seconds
- **Style**: Clean, educational, icon-driven
- **Best For**: Product explanations, concept introductions, tutorials

### Product Demo Template
- **Structure**: Intro → Overview → Feature Highlights → Value Prop → CTA
- **Duration**: 30-90 seconds
- **Style**: Professional, annotation-heavy, UI-focused
- **Best For**: Software products, app showcases, feature tours

### Social Media Template
- **Structure**: Hook → Message → Visual → CTA
- **Duration**: 15-60 seconds
- **Format**: Vertical (1080x1920) or Square (1080x1080)
- **Style**: Bold, high-contrast, fast-paced
- **Best For**: Instagram Reels, TikTok, YouTube Shorts

### Presentation Template
- **Structure**: Title → Content Slides → Summary → Closing
- **Duration**: 120-300 seconds
- **Style**: Professional, slide-based, data-friendly
- **Best For**: Business presentations, reports, webinars

## Asset Requirements

### Essential Assets

For best results, provide:
- **Logo**: PNG with transparency, 512x512px or higher
- **Images**: PNG or JPG, 1920x1080 or higher resolution
- **Product Screenshots**: High-resolution captures of your product UI

### Optional Assets

- **Background Music**: MP3 or WAV, matching video duration
- **Icons**: SVG or PNG, 64x64px, consistent style
- **Custom Fonts**: TTF or OTF files

### Asset Specifications

- **Format**: PNG (with transparency), JPG, or SVG
- **Resolution**: 1920x1080 minimum for full-screen images
- **Color Mode**: RGB
- **Naming**: Use kebab-case (logo-main.png, screenshot-1.jpg)

## Configuration

### Video Settings

Edit `./remotion-videos/remotion.config.ts`:

```typescript
import { Config } from "@remotion/cli/config";

// Image format (jpeg is faster)
Config.setVideoImageFormat("jpeg");

// Overwrite existing output
Config.setOverwriteOutput(true);

// Adjust quality (0-100)
Config.setQuality(85);
```

### Project Settings

Edit `./remotion-videos/package.json` scripts:

```json
{
  "scripts": {
    "dev": "remotion studio",
    "build": "remotion bundle",
    "render": "remotion render",
    "upgrade": "remotion upgrade"
  }
}
```

## Troubleshooting

### "Command not found: node"

**Solution**: Install Node.js
```bash
# macOS
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### "Command not found: ffmpeg"

**Solution**: Install FFmpeg
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg
```

### "Module not found: remotion"

**Solution**: Reinstall dependencies
```bash
cd ./remotion-videos
rm -rf node_modules
npm install
```

### Slow Rendering

**Solution**: Reduce quality or resolution temporarily
```bash
npx remotion render src/index.ts [video-name] output/[video-name].mp4 --jpeg-quality=50
```

### Out of Memory

**Solution**: Increase Node.js memory
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
```

## Skills Included

### video-generator
Main orchestrator skill that coordinates the entire workflow.

**Triggers on:**
- "create a video"
- "make a video"
- "explainer video"
- "product demo"
- Video-related keywords

### scene-planner
Creates detailed storyboards with scene breakdowns, timing, and visual specifications.

**Features:**
- Analyzes user requirements
- Selects appropriate template
- Defines color palette and typography
- Specifies animations and transitions

### environment-setup
Automatically detects and installs required dependencies.

**Checks for:**
- Node.js v16+
- FFmpeg
- npm/yarn/pnpm
- Remotion packages

### remotion-best-practices
Ensures generated code follows official Remotion guidelines.

**Includes:**
- 30+ rule files
- Animation patterns
- Performance optimization
- Media handling guidelines

## Technical Details

### Generated Code

All videos are generated as TypeScript React components using:
- **Remotion 4.0+**: Video creation framework
- **React 19**: UI framework
- **TypeScript 5.9+**: Type safety
- **Tailwind CSS v4**: Styling (optional)

### Animation System

Uses Remotion's frame-based animation:
- `useCurrentFrame()`: Get current frame number
- `interpolate()`: Linear animations
- `spring()`: Physics-based animations
- No CSS transitions (not supported by Remotion)

### Rendering Pipeline

1. React components render to images (one per frame)
2. FFmpeg stitches images into video
3. Audio is muxed (if provided)
4. Final MP4 encoded with H.264

## Best Practices

### Content

- **One idea per scene**: Don't overload information
- **Clear messaging**: Focus on key benefits
- **Visual hierarchy**: Most important content is most prominent
- **Reading time**: Allow 2-3 seconds per line of text

### Design

- **High contrast**: Ensure text is readable
- **Brand consistency**: Use corporate colors and fonts
- **White space**: Don't fill every pixel
- **Professional imagery**: Avoid cheesy stock photos

### Performance

- **Optimize assets**: Compress images before adding
- **Efficient animations**: Use interpolate for simple animations
- **Asset size**: Keep images under 5MB
- **Resolution**: Use 1920x1080 unless 4K is required

## Examples

### Example 1: Quick Explainer

```
User: "Create a 45-second explainer video about our email automation tool"

Plugin generates:
- 5 scenes (hook, problem, solution, demo, CTA)
- Blue/white color scheme
- Clean, modern animations
- Output: email-automation-explainer.mp4
```

### Example 2: Product Feature Demo

```
User: "Demo our new dashboard analytics feature. I have 2 screenshots."

Plugin generates:
- 4 scenes (intro, overview, feature highlights, CTA)
- Professional style with annotations
- Screenshot integration with spotlights
- Output: dashboard-analytics-demo.mp4
```

### Example 3: Social Media Promo

```
User: "Vertical Instagram video (30s) for our sale"

Plugin generates:
- 1080x1920 vertical format
- 4 scenes (hook, offer, visual, CTA)
- Bold, high-contrast design
- Output: sale-promo-instagram.mp4
```

## Updating

```bash
# Update plugin
cc --plugin update remotion-video-generator

# Update Remotion packages
cd ./remotion-videos
npm run upgrade
```

## Contributing

Found a bug or have a feature request? Open an issue or submit a pull request.

## License

MIT License - see LICENSE file for details

## Resources

- [Remotion Documentation](https://remotion.dev/docs/)
- [Remotion Examples](https://remotion.dev/showcase)
- [CodeBuddy Code Plugin Development](https://docs.codebuddy.dev/plugins)

## Support

Need help? Contact:
- Plugin issues: Open a GitHub issue
- Remotion questions: [Remotion Discord](https://discord.gg/remotion)
- CodeBuddy questions: [CodeBuddy Discord](https://discord.gg/codebuddy)

---

**Made with ❤️ for CodeBuddy Code**
