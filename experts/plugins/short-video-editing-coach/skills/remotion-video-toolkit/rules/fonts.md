---
name: fonts
description: Loading Google Fonts and local fonts in Remotion
metadata:
  tags: fonts, google-fonts, typography, text, chinese-fonts
---

# Using fonts in Remotion

## 字体选择规则（必须遵守）

### 默认字体选择

根据视频内容语言自动选择字体：

| 内容语言 | 默认字体 | 备选字体 |
|---------|---------|---------|
| 中文内容 | `Noto Sans SC`（思源黑体） | `Noto Serif SC`（宋体风格） |
| 英文内容 | `Montserrat` 或 `Roboto` | `Inter`、`Poppins` |
| 中英混排 | `Noto Sans SC`（自动覆盖英文） | — |

**规则**：如果视频中包含任何中文字符（标题、字幕、文案），**必须使用中文字体**，不得使用纯英文字体渲染中文内容。

## 中文字体（Google Fonts）

`@remotion/google-fonts` 包含以下可用中文字体：

| 字体 | 风格 | 适用场景 |
|------|------|---------|
| `Noto Sans SC` | 黑体/无衬线 | **首选**，通用字幕、标题、正文 |
| `Noto Serif SC` | 宋体/衬线 | 正式、文化类内容 |
| `ZCOOL XiaoWei` | 艺术体 | 标题、封面文字 |
| `ZCOOL QingKe HuangYou` | 可爱圆体 | 轻松、趣味类内容 |
| `ZCOOL KuaiLe` | 活泼手写 | 儿童、娱乐类内容 |
| `Ma Shan Zheng` | 行书 | 国风、书法类内容 |
| `Liu Jian Mao Cao` | 草书 | 艺术性强的标题 |
| `Long Ceng` | 手写体 | 个性化内容 |

### 加载中文字体（⚠️ 必须指定 subset）

> **性能警告**：中文字体（如 Noto Sans SC）包含数万字符，不指定 subset 加载时会发起 **900+ 个网络请求**，导致首次渲染极慢甚至超时。**必须指定 `subsets: ["chinese-simplified"]`**。

```tsx
// ✅ 正确：指定 subset 和 weights，仅加载所需字符集
import { loadFont } from "@remotion/google-fonts/NotoSansSC";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["chinese-simplified"],
});

export const ChineseTitle: React.FC<{ text: string }> = ({ text }) => {
  return (
    <h1 style={{ fontFamily, fontSize: 72, fontWeight: "bold" }}>
      {text}
    </h1>
  );
};
```

```tsx
// ❌ 错误：不指定 subset，会加载全部字符集（900+ 请求）
import { loadFont } from "@remotion/google-fonts/NotoSansSC";
const { fontFamily } = loadFont(); // 极慢！禁止这样用
```

### 中文字幕完整示例

```tsx
import { loadFont } from "@remotion/google-fonts/NotoSansSC";
import { AbsoluteFill } from "remotion";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["chinese-simplified"],
});

export const Subtitle: React.FC<{ text: string }> = ({ text }) => {
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center" }}>
      <div
        style={{
          fontFamily,
          fontSize: 48,
          fontWeight: 700,
          color: "#FFFFFF",
          textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          padding: "12px 24px",
          marginBottom: 80,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
```

### 使用宋体字体

```tsx
import { loadFont } from "@remotion/google-fonts/NotoSerifSC";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["chinese-simplified"],
});
```

### 使用艺术字体

```tsx
import { loadFont } from "@remotion/google-fonts/ZCOOLXiaoWei";

const { fontFamily } = loadFont("normal", {
  weights: ["400"],
  subsets: ["chinese-simplified"],
});
```

## Google Fonts with @remotion/google-fonts（英文字体）

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
