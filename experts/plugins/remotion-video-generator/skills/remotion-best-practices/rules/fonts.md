---
name: fonts
description: Loading Google Fonts and local fonts in Remotion, with recommended Chinese font stack
metadata:
  tags: fonts, google-fonts, typography, text, chinese-fonts
---

# Using fonts in Remotion

## Recommended Font Stack (Default)

When generating videos, **always use the following font stack by default** unless the user specifies otherwise:

### Primary Fonts (Free for Commercial Use)

| Font | Usage | License | Download |
|------|-------|---------|----------|
| **阿里妈妈数黑体 (Alimama ShuHeiTi Bold)** | Chinese titles, headings, emphasis text | Free commercial use (Alibaba) | [iconfont.cn 官方下载](https://www.iconfont.cn/fonts/detail?cnid=a9fXc2HD9n7s) |
| **抖音美好体 (Douyin Sans Bold)** | Chinese body text, subtitles, captions | OFL (SIL Open Font License) | [GitHub bytedance/fonts](https://github.com/bytedance/fonts/tree/main/DouyinSans) / [ZIP 下载](https://github.com/bytedance/fonts/archive/refs/heads/main.zip) |

### Font Stack Priority

```
Chinese Titles/Headings:  Alimama ShuHeiTi Bold → Noto Sans SC Bold → system sans-serif
Chinese Body/Subtitles:   Douyin Sans Bold → Noto Sans SC → system sans-serif
English/Numbers:          Montserrat (Google Fonts) → Inter → system sans-serif
```

### Auto-Setup: Loading Recommended Fonts

When starting a video project, automatically set up fonts using this pattern:

```tsx
// src/fonts.ts - Font loading configuration
import { loadFont } from "@remotion/fonts";
import { loadFont as loadGoogleFont } from "@remotion/google-fonts/Montserrat";
import { staticFile } from "remotion";

// 1. Load Chinese fonts from public/ directory
//    User should place font files in public/fonts/ before rendering
export const loadChineseFonts = async () => {
  await Promise.all([
    loadFont({
      family: "Alimama ShuHeiTi",
      url: staticFile("fonts/AlimamaShuHeiTi-Bold.otf"),
      weight: "700",
      display: "block",
    }),
    loadFont({
      family: "Douyin Sans",
      url: staticFile("fonts/DouyinSansBold.ttf"),
      weight: "700",
      display: "block",
    }),
  ]);
};

// 2. Load English font from Google Fonts
export const { fontFamily: englishFont } = loadGoogleFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

// 3. Composed font families for use in components
export const FONTS = {
  heading: '"Alimama ShuHeiTi", "Noto Sans SC", sans-serif',
  body: '"Douyin Sans", "Noto Sans SC", sans-serif',
  english: `${englishFont}, "Inter", sans-serif`,
  // Combined: Chinese + English fallback
  mixed: '"Alimama ShuHeiTi", "Montserrat", "Noto Sans SC", sans-serif',
};
```

### Font File Placement

Before rendering, ensure font files are placed in the project's `public/fonts/` directory:

```
my-video-project/
├── public/
│   └── fonts/
│       ├── AlimamaShuHeiTi-Bold.otf    ← From iconfont.cn (阿里妈妈官方)
│       └── DouyinSansBold.ttf           ← From github.com/bytedance/fonts (OFL)
├── src/
│   ├── fonts.ts                         ← Font loading config (generated above)
│   └── ...
```

### Auto-Download Script

During environment setup, **automatically download fonts** using the following commands:

```bash
# Create fonts directory in the Remotion project
mkdir -p public/fonts

# Download 抖音美好体 (Douyin Sans Bold) from ByteDance official GitHub
curl -sL -o /tmp/bytedance-fonts.zip "https://github.com/bytedance/fonts/archive/refs/heads/main.zip" \
  && unzip -o /tmp/bytedance-fonts.zip "fonts-main/DouyinSans/DouyinSansBold.ttf" -d /tmp/ \
  && cp /tmp/fonts-main/DouyinSans/DouyinSansBold.ttf public/fonts/ \
  && rm -rf /tmp/bytedance-fonts.zip /tmp/fonts-main

# 阿里妈妈数黑体 needs manual download from iconfont.cn (no direct CLI download available)
# Download page: https://www.iconfont.cn/fonts/detail?cnid=a9fXc2HD9n7s
# After download, place AlimamaShuHeiTi-Bold.otf in public/fonts/
```

**Workflow**:
1. 抖音美好体: **自动下载** (GitHub ZIP → 解压 → 复制到 public/fonts/)
2. 阿里妈妈数黑体: **检查是否已存在**，不存在则提示用户从 iconfont.cn 下载
3. 两个字体都缺失时，仍可渲染（使用 fallback 字体）

**If fonts are not available**, the video should still work with fallback fonts. Always check if font files exist before loading:

```tsx
// Graceful fallback if font files are missing
export const loadChineseFonts = async () => {
  try {
    await loadFont({
      family: "Alimama ShuHeiTi",
      url: staticFile("fonts/AlimamaShuHeiTi-Bold.otf"),
      weight: "700",
    });
  } catch {
    console.warn("Alimama ShuHeiTi not found, using system fallback");
  }

  try {
    await loadFont({
      family: "Douyin Sans",
      url: staticFile("fonts/DouyinSansBold.ttf"),
      weight: "700",
    });
  } catch {
    console.warn("Douyin Sans not found, using system fallback");
  }
};
```

---

## Google Fonts with @remotion/google-fonts

The recommended way to use Google Fonts. It's type-safe and automatically blocks rendering until the font is ready.

### Prerequisites

First, the @remotion/google-fonts package needs to be installed.
If it is not installed, use the following command:

```bash
npx remotion add @remotion/google-fonts # If project uses npm
bunx remotion add @remotion/google-fonts # If project uses bun
yarn remotion add @remotion/google-fonts # If project uses yarn
pnpm exec remotion add @remotion/google-fonts # If project uses pnpm
```

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily } = loadFont();

export const MyComposition = () => {
  return <div style={{ fontFamily }}>Hello World</div>;
};
```

Preferrably, specify only needed weights and subsets to reduce file size:

```tsx
import { loadFont } from "@remotion/google-fonts/Roboto";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
```

### Waiting for font to load

Use `waitUntilDone()` if you need to know when the font is ready:

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily, waitUntilDone } = loadFont();

await waitUntilDone();
```

## Local fonts with @remotion/fonts

For local font files, use the `@remotion/fonts` package.

### Prerequisites

First, install @remotion/fonts:

```bash
npx remotion add @remotion/fonts # If project uses npm
bunx remotion add @remotion/fonts # If project uses bun
yarn remotion add @remotion/fonts # If project uses yarn
pnpm exec remotion add @remotion/fonts # If project uses pnpm
```

### Loading a local font

Place your font file in the `public/` folder and use `loadFont()`:

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await loadFont({
  family: "MyFont",
  url: staticFile("MyFont-Regular.woff2"),
});

export const MyComposition = () => {
  return <div style={{ fontFamily: "MyFont" }}>Hello World</div>;
};
```

### Loading multiple weights

Load each weight separately with the same family name:

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await Promise.all([
  loadFont({
    family: "Inter",
    url: staticFile("Inter-Regular.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "Inter",
    url: staticFile("Inter-Bold.woff2"),
    weight: "700",
  }),
]);
```

### Available options

```tsx
loadFont({
  family: "MyFont", // Required: name to use in CSS
  url: staticFile("font.woff2"), // Required: font file URL
  format: "woff2", // Optional: auto-detected from extension
  weight: "400", // Optional: font weight
  style: "normal", // Optional: normal or italic
  display: "block", // Optional: font-display behavior
});
```

## Using in components

Call `loadFont()` at the top level of your component or in a separate file that's imported early:

```tsx
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export const Title: React.FC<{ text: string }> = ({ text }) => {
  return (
    <h1
      style={{
        fontFamily,
        fontSize: 80,
        fontWeight: "bold",
      }}
    >
      {text}
    </h1>
  );
};
```
