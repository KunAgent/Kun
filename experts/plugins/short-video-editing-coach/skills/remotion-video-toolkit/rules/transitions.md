---
name: transitions
description: Fullscreen scene transitions for Remotion.
metadata:
  tags: transitions, fade, slide, wipe, scenes
---

## Fullscreen transitions

Using `<TransitionSeries>` to animate between multiple scenes or clips.  
This will absolutely position the children.

## Prerequisites

First, the @remotion/transitions package needs to be installed.  
If it is not, use the following command:

```bash
npx remotion add @remotion/transitions # If project uses npm
bunx remotion add @remotion/transitions # If project uses bun
yarn remotion add @remotion/transitions # If project uses yarn
pnpm exec remotion add @remotion/transitions # If project uses pnpm
```

## Example usage

```tsx
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';

<TransitionSeries style={{backgroundColor: '#000'}}>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 15})} />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

## Available Transition Types

Import transitions from their respective modules:

```tsx
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {flip} from '@remotion/transitions/flip';
```

> ⚠️ **禁止使用 `clockWipe`**：`clockWipe` 在竖屏分辨率（如 1080×1920）下存在已知 bug，会因 SVG path 数据格式异常导致渲染崩溃（`Malformed path data: M was expected to have numbers afterwards`）。在任何竖屏项目中**严禁使用**，横屏项目也应避免使用以保证稳定性。

### 推荐转场选择

| 转场类型 | 稳定性 | 适用场景 |
|---------|--------|---------|
| `fade` | ✅ 完全稳定 | 开场/结尾、自然过渡 |
| `slide` | ✅ 完全稳定 | 同主题不同镜头、列表式内容 |
| `wipe` | ✅ 完全稳定 | 话题切换、章节分隔 |
| `flip` | ✅ 完全稳定 | 强调、反转、对比 |

## 转场编排规则（必须遵守）

### 频率控制

- **30 秒以内短视频**：转场总数不超过 3-5 个
- **30-60 秒视频**：转场总数不超过 6-8 个
- **不是每个场景切换都需要转场**：相邻场景如果内容连贯，直接硬切（不加 Transition）效果更好

### 一致性原则

- 单个视频中**主转场类型不超过 2 种**
- 选定主转场后，80% 的转场使用同一类型，仅在特殊节点使用第二种
- **禁止**连续使用不同类型转场（如 fade → slide → wipe → flip 交替出现）

### 场景匹配建议

| 场景类型 | 推荐转场 | 原因 |
|---------|---------|------|
| 开场第一个镜头 | `fade`（淡入） | 从黑场自然过渡 |
| 结尾最后一个镜头 | `fade`（淡出） | 自然收束 |
| 同一主题不同角度/镜头 | `slide`（方向统一） | 保持节奏连贯 |
| 话题切换/章节转换 | `wipe` | 明确的分隔感 |
| 强调/反转/对比 | `flip` | 视觉冲击力 |
| 快节奏内容（如口播+画面交替） | 硬切（无转场） | 保持紧凑感 |

### 默认方案

如果不确定用什么转场，使用以下默认方案：
- **主转场**：`fade`（最安全、最通用）
- **时长**：`linearTiming({durationInFrames: 10})` （约 0.33 秒 @30fps）
- **仅在章节切换处**添加转场，其余场景切换用硬切

## 背景色规则（重要）

**禁止使用白色背景**：转场过程中如果底层背景是白色（`#FFFFFF`），会产生刺眼的白屏闪烁，严重影响观感。

### 必须设置背景色

在 `<TransitionSeries>` 外层容器或组件上**必须显式设置深色背景**：

```tsx
// ✅ 正确：显式设置黑色背景
<TransitionSeries style={{backgroundColor: '#000'}}>
  {/* scenes */}
</TransitionSeries>

// ✅ 正确：在外层 AbsoluteFill 设置背景
<AbsoluteFill style={{backgroundColor: '#1a1a1a'}}>
  <TransitionSeries>
    {/* scenes */}
  </TransitionSeries>
</AbsoluteFill>

// ❌ 错误：不设置背景色（默认透明/白色，导致白屏闪烁）
<TransitionSeries>
  {/* scenes */}
</TransitionSeries>
```

### 背景色选择

- 默认使用 `#000000`（纯黑）
- 如果视频整体色调较亮，可用 `#1a1a1a`（深灰）
- **绝不使用** `#FFFFFF` 或任何浅色作为转场背景

## Slide Transition with Direction

Specify slide direction for enter/exit animations.

```tsx
import {slide} from '@remotion/transitions/slide';

<TransitionSeries.Transition presentation={slide({direction: 'from-left'})} timing={linearTiming({durationInFrames: 20})} />;
```

Directions: `"from-left"`, `"from-right"`, `"from-top"`, `"from-bottom"`

## Timing Options

```tsx
import {linearTiming, springTiming} from '@remotion/transitions';

// Linear timing - constant speed
linearTiming({durationInFrames: 20});

// Spring timing - organic motion
springTiming({config: {damping: 200}, durationInFrames: 25});
```

## Duration calculation

Transitions overlap adjacent scenes, so the total composition length is **shorter** than the sum of all sequence durations.

For example, with two 60-frame sequences and a 15-frame transition:

- Without transitions: `60 + 60 = 120` frames
- With transition: `60 + 60 - 15 = 105` frames

The transition duration is subtracted because both scenes play simultaneously during the transition.

### Getting the duration of a transition

Use the `getDurationInFrames()` method on the timing object:

```tsx
import {linearTiming, springTiming} from '@remotion/transitions';

const linearDuration = linearTiming({durationInFrames: 20}).getDurationInFrames({fps: 30});
// Returns 20

const springDuration = springTiming({config: {damping: 200}}).getDurationInFrames({fps: 30});
// Returns calculated duration based on spring physics
```

For `springTiming` without an explicit `durationInFrames`, the duration depends on `fps` because it calculates when the spring animation settles.

### Calculating total composition duration

```tsx
import {linearTiming} from '@remotion/transitions';

const scene1Duration = 60;
const scene2Duration = 60;
const scene3Duration = 60;

const timing1 = linearTiming({durationInFrames: 15});
const timing2 = linearTiming({durationInFrames: 20});

const transition1Duration = timing1.getDurationInFrames({fps: 30});
const transition2Duration = timing2.getDurationInFrames({fps: 30});

const totalDuration = scene1Duration + scene2Duration + scene3Duration - transition1Duration - transition2Duration;
// 60 + 60 + 60 - 15 - 20 = 145 frames
```
