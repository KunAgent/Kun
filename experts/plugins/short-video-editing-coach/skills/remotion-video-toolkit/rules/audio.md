---
name: audio
description: Using audio and sound in Remotion - importing, trimming, volume, speed, pitch
metadata:
  tags: audio, media, trim, volume, speed, loop, pitch, mute, sound, sfx
---

# Using audio in Remotion

## BGM 使用规则（必须遵守）

> ⚠️ **严禁使用程序生成的音频作为 BGM**。Remotion 的 `<Audio>` 组件是音频**播放器**，不是音频合成器。使用 Web Audio API / Oscillator / 噪声生成器产生的音频会输出为白噪音或杂音，**绝对不能用于 BGM**。

### BGM 来源规则

BGM **必须使用真实音频文件**（`.mp3`、`.wav`、`.aac`、`.m4a`）：

1. **用户提供的音频文件** → 使用 `staticFile()` 引用（最优先）
2. **项目内预置音频** → 放置在 `public/` 目录，用 `staticFile("bgm.mp3")` 引用
3. **远程 URL** → 使用可直接访问的音频 URL（确保可商用）

### 无 BGM 时的处理

如果用户未提供 BGM 文件，**不要尝试生成或合成音频**，应：

```tsx
// ✅ 正确：留空并标注 TODO
// TODO: 请将实际 BGM 文件放入 public/ 目录，并替换下方路径
// <Audio src={staticFile("bgm.mp3")} volume={0.3} loop />
```

```tsx
// ❌ 错误：尝试用代码生成音频
const audioContext = new AudioContext();
const oscillator = audioContext.createOscillator(); // 这会输出白噪音！
```

### BGM 音量建议

- 纯 BGM（无人声）：`volume={0.6}` ~ `volume={0.8}`
- 有人声旁白时：`volume={0.15}` ~ `volume={0.25}`（BGM 要压低）
- 建议使用淡入淡出：开头 1 秒淡入，结尾 1 秒淡出

---

## Prerequisites

First, the @remotion/media package needs to be installed.
If it is not installed, use the following command:

```bash
npx remotion add @remotion/media # If project uses npm
bunx remotion add @remotion/media # If project uses bun
yarn remotion add @remotion/media # If project uses yarn
pnpm exec remotion add @remotion/media # If project uses pnpm
```

## Importing Audio

Use `<Audio>` from `@remotion/media` to add audio to your composition.

```tsx
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Audio src={staticFile("audio.mp3")} />;
};
```

Remote URLs are also supported:

```tsx
<Audio src="https://remotion.media/audio.mp3" />
```

By default, audio plays from the start, at full volume and full length.
Multiple audio tracks can be layered by adding multiple `<Audio>` components.

## Trimming

Use `trimBefore` and `trimAfter` to remove portions of the audio. Values are in frames.

```tsx
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    trimBefore={2 * fps} // Skip the first 2 seconds
    trimAfter={10 * fps} // End at the 10 second mark
  />
);
```

The audio still starts playing at the beginning of the composition - only the specified portion is played.

## Delaying

Wrap the audio in a `<Sequence>` to delay when it starts:

```tsx
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";

const { fps } = useVideoConfig();

return (
  <Sequence from={1 * fps}>
    <Audio src={staticFile("audio.mp3")} />
  </Sequence>
);
```

The audio will start playing after 1 second.

## Volume

Set a static volume (0 to 1):

```tsx
<Audio src={staticFile("audio.mp3")} volume={0.5} />
```

Or use a callback for dynamic volume based on the current frame:

```tsx
import { interpolate } from "remotion";

const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    volume={(f) =>
      interpolate(f, [0, 1 * fps], [0, 1], { extrapolateRight: "clamp" })
    }
  />
);
```

The value of `f` starts at 0 when the audio begins to play, not the composition frame.

## Muting

Use `muted` to silence the audio. It can be set dynamically:

```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    muted={frame >= 2 * fps && frame <= 4 * fps} // Mute between 2s and 4s
  />
);
```

## Speed

Use `playbackRate` to change the playback speed:

```tsx
<Audio src={staticFile("audio.mp3")} playbackRate={2} /> {/* 2x speed */}
<Audio src={staticFile("audio.mp3")} playbackRate={0.5} /> {/* Half speed */}
```

Reverse playback is not supported.

## Looping

Use `loop` to loop the audio indefinitely:

```tsx
<Audio src={staticFile("audio.mp3")} loop />
```

Use `loopVolumeCurveBehavior` to control how the frame count behaves when looping:

- `"repeat"`: Frame count resets to 0 each loop (default)
- `"extend"`: Frame count continues incrementing

```tsx
<Audio
  src={staticFile("audio.mp3")}
  loop
  loopVolumeCurveBehavior="extend"
  volume={(f) => interpolate(f, [0, 300], [1, 0])} // Fade out over multiple loops
/>
```

## Pitch

Use `toneFrequency` to adjust the pitch without affecting speed. Values range from 0.01 to 2:

```tsx
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={1.5} // Higher pitch
/>
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={0.8} // Lower pitch
/>
```

Pitch shifting only works during server-side rendering, not in the Remotion Studio preview or in the `<Player />`.
