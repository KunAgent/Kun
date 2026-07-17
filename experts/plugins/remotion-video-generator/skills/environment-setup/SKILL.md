---
name: Environment Setup
description: Automatically detects and configures the Remotion video generation environment. Use when user requests video creation and dependencies (Node.js, FFmpeg, Remotion packages) need verification or installation. Checks system requirements, installs missing tools, initializes Remotion project structure, and validates the setup is ready for video generation.
---

# Remotion Environment Setup

You are responsible for ensuring the user's system has all required dependencies to generate videos with Remotion. This skill automatically detects, installs, and validates the complete environment.

## When This Skill Activates

This skill should activate automatically when:
- The video-generator skill detects a video creation request
- The user explicitly mentions environment setup or dependencies
- Any Remotion command fails due to missing dependencies

## System Requirements

### Required Software

1. **Node.js** (v16 or higher)
   - Check: `node --version`
   - Required for running Remotion and React

2. **FFmpeg** (any recent version)
   - Check: `ffmpeg -version`
   - Required for video encoding and frame stitching

3. **npm** or **yarn** or **pnpm**
   - Comes with Node.js installation
   - Package manager for installing dependencies

4. **Chromium/Chrome**
   - Remotion downloads its own bundled Chromium
   - No manual installation needed
   - Used for rendering React components to frames

### Recommended (Optional)

- **Git**: For version control of video projects
- **Visual Studio Code**: For editing Remotion code
- **2-4GB free RAM**: For rendering process
- **500MB free disk space**: For project and output files

## Environment Detection Process

### Step 1: Check Node.js

Run this command:
```bash
node --version
```

**Expected output**: v16.x.x or higher (e.g., `v18.17.0`, `v20.5.1`)

**If missing**:
- Detect platform (macOS, Linux, Windows)
- Provide platform-specific installation instructions
- Do NOT attempt auto-install (Node.js requires user consent)

**Installation Instructions by Platform**:

**macOS**:
```bash
# Using Homebrew (recommended)
brew install node

# Or download from nodejs.org
```

**Linux (Ubuntu/Debian)**:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows**:
Download installer from https://nodejs.org/ and run it.

---

### Step 2: Check FFmpeg

Run this command:
```bash
ffmpeg -version
```

**Expected output**: FFmpeg version information (any recent version is fine)

**If missing**:

**macOS**:
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian)**:
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Windows**:
1. Download from https://ffmpeg.org/download.html
2. Extract to C:\ffmpeg
3. Add to PATH environment variable

**Automatic Installation Decision**:
- On macOS/Linux: Ask user permission, then run install command
- On Windows: Provide manual instructions (auto-install not reliable)

---

### Step 3: Verify Package Manager

Run this command:
```bash
npm --version
```

**Expected output**: Version number (e.g., `9.8.1`)

**If npm is missing**: This indicates Node.js wasn't installed correctly. Return to Step 1.

**Alternative package managers**:
- yarn: `yarn --version`
- pnpm: `pnpm --version`

Use whichever is available (prefer npm as default).

---

## Project Initialization

### Step 4: Determine Project Directory

The Remotion project directory (referred to as `PROJECT_DIR` below) is selected using the following priority:

1. **User-specified path**: If the user explicitly provides a path, use that
2. **Environment variable**: If `REMOTION_PROJECT_DIR` is set, use its value
3. **Current working directory** (recommended): `./remotion-videos/` — keeps the project co-located with the user's workspace
4. **Home directory fallback**: `~/remotion-videos/` — only if the current directory is not writable or not suitable

**Determine and create the directory**:
```bash
# Use environment variable if set, otherwise default to ./remotion-videos
PROJECT_DIR="${REMOTION_PROJECT_DIR:-./remotion-videos}"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
```

**Why this strategy**:
- Works in sandboxed environments where `~` may not be predictable
- Keeps video projects close to the user's working context
- Can be overridden externally via environment variable
- Falls back gracefully to home directory if needed

**If directory already exists**: Use existing directory (don't overwrite).

---

### Step 5: Initialize npm Project

**If package.json doesn't exist**:
```bash
npm init -y
```

This creates a basic `package.json` file.

**If package.json exists**: Check if Remotion dependencies are installed (next step).

---

### Step 6: Install Remotion Dependencies

Install the core Remotion packages:

```bash
cd "$PROJECT_DIR"
npm install remotion@^4.0.0 @remotion/cli@^4.0.0 react@^19.0.0 react-dom@^19.0.0
```

**Additional useful packages** (install if time permits):
```bash
npm install @remotion/tailwind@^4.0.0 @remotion/transitions@^4.0.0 @remotion/google-fonts@^4.0.0
```

**Why these packages**:
- `remotion`: Core framework
- `@remotion/cli`: Command-line tools for rendering
- `react` + `react-dom`: Required peer dependencies
- `@remotion/tailwind`: For Tailwind CSS styling (optional)
- `@remotion/transitions`: Pre-built transition effects (optional)
- `@remotion/google-fonts`: Easy font loading (optional)

**Installation timing**:
- This may take 1-2 minutes
- Show progress indicator to user
- If installation fails, check error messages and retry

**Common installation errors**:
- Network timeout: Retry with longer timeout
- Permission errors: User may need sudo (Linux/macOS)
- Disk space: Check available space

---

### Step 7: Create Project Structure

Create the standard Remotion project structure:

```bash
cd "$PROJECT_DIR"
mkdir -p src/compositions public/assets output
```

**Directory purposes**:
- `src/`: React components and video compositions
- `src/compositions/`: Individual video project folders
- `public/`: Static assets (images, fonts, audio)
- `public/assets/`: User-provided assets
- `output/`: Rendered MP4 files

---

### Step 8: Create Configuration Files

**Create `remotion.config.ts`**:
```typescript
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
```

**Why these settings**:
- `jpeg`: Faster rendering than png
- `overwriteOutput`: Automatically replace existing output files

**Create `src/index.ts` (entry point)**:
```typescript
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

**Create basic `src/Root.tsx`**:
```typescript
import React from "react";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Video compositions will be added here */}
    </>
  );
};
```

**Create `package.json` scripts** (if not present):
```json
{
  "scripts": {
    "dev": "remotion studio",
    "build": "remotion bundle",
    "render": "remotion render"
  }
}
```

---

### Step 9: Validate Installation

Run validation checks:

**Check 1: Remotion CLI**
```bash
npx remotion --version
```
Expected: Version number (e.g., `4.0.409`)

**Check 2: Project structure**
```bash
ls -la "$PROJECT_DIR"
```
Expected: `src/`, `public/`, `node_modules/`, `package.json` directories exist

**Check 3: TypeScript**
```bash
npx tsc --version
```
Expected: Version number (TypeScript is a Remotion dependency)

**If all checks pass**: Environment is ready! ✓

---

## Error Handling

### Common Issues and Solutions

**Issue: "command not found: node"**
- **Cause**: Node.js not installed or not in PATH
- **Solution**: Install Node.js or add to PATH

**Issue: "command not found: ffmpeg"**
- **Cause**: FFmpeg not installed or not in PATH
- **Solution**: Install FFmpeg or add to PATH

**Issue: "npm ERR! EACCES: permission denied"**
- **Cause**: Insufficient permissions
- **Solution**: Use `sudo npm install` (Linux/macOS) or run as administrator (Windows)

**Issue: "npm ERR! network timeout"**
- **Cause**: Network issues or slow connection
- **Solution**: Retry with `npm install --timeout=60000`

**Issue: "npm ERR! ENOSPC: no space left on device"**
- **Cause**: Insufficient disk space
- **Solution**: Free up disk space (need at least 500MB)

**Issue: Module not found errors**
- **Cause**: Dependencies not fully installed
- **Solution**: Delete `node_modules/` and re-run `npm install`

---

## Output to User

### Success Message

When environment is ready, inform user:

```
✓ Environment setup complete!

✓ Node.js: v18.17.0
✓ FFmpeg: version 6.0
✓ Remotion: 4.0.409
✓ Project directory: $PROJECT_DIR

You're ready to create videos! The video-generator skill will now proceed.
```

### Partial Success Message

If some optional components are missing:

```
✓ Core environment ready!

✓ Node.js: v18.17.0
✓ FFmpeg: version 6.0
✓ Remotion: 4.0.409

⚠ Optional: Consider installing Git for version control

Project directory: $PROJECT_DIR
```

### Failure Message

If critical components are missing and cannot be auto-installed:

```
❌ Environment setup incomplete

Missing requirements:
❌ Node.js: Not installed
   Install from: https://nodejs.org/

Current status:
✓ FFmpeg: version 6.0

Please install the missing requirements and try again.
```

---

## Platform-Specific Considerations

### macOS

**Homebrew availability**: Check if Homebrew is installed
```bash
which brew
```

If Homebrew exists, use it for FFmpeg installation:
```bash
brew install ffmpeg
```

If Homebrew doesn't exist:
- Suggest installing Homebrew first: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Or provide direct FFmpeg download link

### Linux

**Distribution detection**:
- Ubuntu/Debian: Use `apt-get`
- Fedora/RedHat: Use `yum` or `dnf`
- Arch: Use `pacman`

**Sudo requirement**: Most installations require `sudo`
- Ask user permission before running sudo commands
- Explain what the command does

### Windows

**Installation challenges**:
- FFmpeg requires manual PATH setup
- npm may require administrator rights

**Provide clear instructions**:
1. Download FFmpeg from official site
2. Extract to C:\ffmpeg
3. Add C:\ffmpeg\bin to PATH
4. Restart terminal

**Alternative**: Suggest using WSL2 (Windows Subsystem for Linux) for easier setup

---

## Verification Checklist

Before proceeding to video generation, confirm:

- [ ] Node.js v16+ is installed and accessible
- [ ] FFmpeg is installed and in PATH
- [ ] npm/yarn/pnpm is available
- [ ] Remotion packages are installed in `$PROJECT_DIR`
- [ ] Project structure exists (`src/`, `public/`, `output/`)
- [ ] Configuration files are created
- [ ] `remotion studio` command works (optional: test by running it)

---

## Integration with Other Skills

### Called by video-generator

The video-generator skill invokes this skill first to ensure environment is ready before generating videos.

### Output to video-generator

Return status:
- **Ready**: All requirements met, proceed with video generation
- **Pending**: User needs to install something manually, wait for confirmation
- **Failed**: Critical requirements missing, cannot proceed

---

## Best Practices

### User Communication

**Be transparent**: Explain what you're installing and why
**Ask permission**: Don't run installation commands without user consent
**Provide alternatives**: If auto-install fails, give manual instructions
**Show progress**: Indicate when installations are running (may take time)

### Error Recovery

**Graceful degradation**: If optional packages fail, continue with core setup
**Clear diagnostics**: Explain error causes in simple terms
**Actionable solutions**: Provide exact commands to fix issues
**Support links**: Include official documentation URLs

### Performance

**Parallel checks**: Run Node.js and FFmpeg checks simultaneously
**Cached validation**: If environment was validated recently, skip re-check
**Minimal installs**: Only install what's needed, offer optional packages separately

---

## Example Workflow

**User request**: "Create a video showing our product features"

**Environment setup flow**:

1. Detect video creation request
2. Check if environment exists
   - If yes: Quick validation, then proceed
   - If no: Full setup process
3. Check Node.js → ✓ Found v18.17.0
4. Check FFmpeg → ✗ Not found
5. Ask user: "FFmpeg is required for video rendering. Install it now? (will run: brew install ffmpeg)"
6. User confirms → Run installation
7. FFmpeg installed → ✓
8. Check Remotion project → Not found
9. Create project directory at `$PROJECT_DIR`
10. Run `npm install remotion @remotion/cli react react-dom`
11. Create project structure
12. Validate installation → ✓ All checks pass
13. Report success → Hand off to video-generator skill

**Total time**: 2-3 minutes (mostly npm installation)

---

## Security Considerations

**Don't run arbitrary code**: Only execute well-known package installations
**Verify package sources**: Install from official npm registry
**User consent**: Always ask before running sudo or admin commands
**No credential storage**: Don't save API keys or passwords
**Safe defaults**: Create project in current working directory or user's home directory (not system folders)

---

## Troubleshooting Guide

Provide this if user encounters issues:

**Problem**: Remotion Studio won't start
**Diagnosis**: Run `npm run dev` and check error message
**Common causes**:
- Port 3000 already in use → Use different port: `remotion studio --port=3001`
- TypeScript errors → Run `npm install typescript`

**Problem**: Rendering fails
**Diagnosis**: Run `npx remotion render` with verbose flag
**Common causes**:
- FFmpeg not found → Verify with `which ffmpeg`
- Out of memory → Close other applications
- Missing composition → Check src/Root.tsx

**Problem**: Slow installation
**Diagnosis**: Check network speed
**Solutions**:
- Use npm mirror: `npm install --registry=https://registry.npmmirror.com`
- Clear npm cache: `npm cache clean --force`
- Update npm: `npm install -g npm@latest`

---

This skill ensures a smooth, automated environment setup experience while maintaining user control and providing clear feedback at every step.
