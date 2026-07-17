---
name: bgm-library
description: Search, filter, and download royalty-free background music from ccMixter for Remotion videos. Supports keyword search, tag presets, license filtering (CC BY / CC BY-SA only), and auto-generates attribution. Downloads MP3 directly to project directory.
allowed-tools: Bash(bgm-library:*)
---

# BGM Library Skill

Search, filter, and download royalty-free background music from ccMixter for Remotion video projects.

## Features

- Search ccMixter by keywords or predefined tag presets
- License filtering: only CC BY and CC BY-SA (commercially safe)
- Direct MP3 download with automatic referer handling
- Auto-generates `music_manifest.json` and `ATTRIBUTION.txt`
- BPM, duration, and tag metadata for intelligent selection
- 5 built-in presets: travel, tech, lofi, food, workout

## Quick Start

```bash
# Search for chill background music
bgm search chill lofi

# Use a preset for travel vlog music
bgm search --preset travel

# Auto-pick and download the best match for your video theme
bgm pick "corporate product demo" --output ./public/

# Download a specific track by ID
bgm download 70473 --output ./public/

# List available presets
bgm presets

# Get detailed track info
bgm info 70473
```

## Installation

Before first use, install dependencies in the skill's scripts directory:

```bash
cd scripts && npm install
```

## Commands

### search `[keywords...]`
Search ccMixter for background music tracks.

Options:
- `-l, --limit <n>` — Max results (default: 10)
- `-p, --preset <name>` — Use a predefined tag preset
- `--commercial-only` / `--no-commercial-only` — License filter (default: on)
- `--sort <field>` — Sort by: date, name, score (default: score)

```bash
bgm search upbeat corporate --limit 5
bgm search --preset lofi
```

### download `<uploadId>`
Download a track by ccMixter upload ID.

Options:
- `-o, --output <dir>` — Output directory (default: `./public`)
- `--force` — Overwrite existing files

```bash
bgm download 70473 --output ./public/
```

### pick `<theme>`
Auto-pick and download the best match for a video theme.

Options:
- `-o, --output <dir>` — Output directory (default: `./public`)
- `-l, --limit <n>` — Candidates to evaluate (default: 5)
- `--force` — Overwrite existing files

```bash
bgm pick "chill lofi study" --output ./public/
bgm pick "energetic workout motivation" --output ./public/
```

### presets
List predefined tag presets for common video scenarios.

```bash
bgm presets
```

### info `<uploadId>`
Show detailed info about a track including license, BPM, duration, and files.

```bash
bgm info 70473
```

## Presets

| Preset   | Name              | Tags                                          |
|----------|-------------------|-----------------------------------------------|
| travel   | 旅行/Vlog         | upbeat, travel, vlog, vacation, summer         |
| tech     | 科技/产品         | corporate, technology, digital, modern         |
| lofi     | 咖啡馆/学习       | lofi, chill, study, cafe, downtempo            |
| food     | 美食/生活         | acoustic, cooking, lifestyle, warm, light      |
| workout  | 运动/健身         | workout, gym, sport, energy, edm               |

## Output Files

### Downloaded MP3
Saved to the specified output directory with the original filename.

### music_manifest.json
Tracks metadata for programmatic access:
```json
{
  "tracks": [
    {
      "upload_id": 70473,
      "title": "The Fade Out",
      "artist": "coruscate",
      "source_url": "https://ccmixter.org/files/Coruscate/70473",
      "license_name": "Attribution (3.0)",
      "license_url": "http://creativecommons.org/licenses/by/3.0/",
      "file_name": "Coruscate_-_The_Fade_Out.mp3",
      "bpm": 92,
      "duration": "3:05",
      "downloaded_at": "2026-02-09T12:00:00.000Z"
    }
  ]
}
```

### ATTRIBUTION.txt
Auto-generated attribution in TASL format (Title/Author/Source/License):
```
=== Music Attribution ===
"The Fade Out" by coruscate
  Source: https://ccmixter.org/files/Coruscate/70473
  License: Attribution (3.0) (http://creativecommons.org/licenses/by/3.0/)
```

## Remotion Usage

After downloading a track:

```tsx
import { Audio } from '@remotion/media';
import { staticFile } from 'remotion';

// Use the downloaded BGM in your composition
<Audio src={staticFile('Coruscate_-_The_Fade_Out.mp3')} volume={0.3} loop />
```

## License Filtering

By default, only commercially safe licenses are shown:
- **Allowed**: CC BY (Attribution), CC BY-SA (Attribution-ShareAlike)
- **Blocked**: Any license with NonCommercial (NC) or NoDerivs (ND)

This ensures all downloaded music can be freely used in commercial video projects.

## Data Source

All music is sourced from [ccMixter](https://ccmixter.org), a community remix site operated by ArtisTech Media, created by Creative Commons.

## Troubleshooting

### "Cannot find module" errors
Install dependencies first:
```bash
cd scripts && npm install
```

### 403 Forbidden on download
The skill automatically handles referer headers. If you still get 403, the track may have been removed from ccMixter.

### No results for search
Try broader keywords, fewer tags, or use a preset. ccMixter's library is smaller than Pixabay but all tracks are properly licensed.
