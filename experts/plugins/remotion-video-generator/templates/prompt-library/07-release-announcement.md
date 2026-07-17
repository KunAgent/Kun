# 版本更新公告 / Changelog 视频提示词

> 来源：最像真正产品团队干的 release 视频
> 时长：8-12 秒 | 画幅：16:9 (1920x1080) | fps: 60

## 核心提示词

```text
做一条 {duration} 秒版本更新公告（16:9，60fps）。

输入：版本号 {version} + {count} 条更新点：
{update_items}

要求：
- 片头 1s：{version} 大字 + "Release"
- {count} 条更新点逐条出现，每条带一个小图标
- 结尾 1s：一句"{cta_text}"

动效：typewriter + 轻微 blur-in，整体节奏干净利落。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const RELEASE = {
  version: 'v2.4.0',
  date: 'February 2026',
  updates: [
    { icon: '🚀', title: 'Performance Boost', desc: '3x faster rendering engine' },
    { icon: '🎨', title: 'New Theme System', desc: 'Dark mode + custom palettes' },
    { icon: '🔧', title: 'API Improvements', desc: 'RESTful endpoints redesigned' },
    { icon: '🐛', title: 'Bug Fixes', desc: '23 issues resolved' },
  ],
  cta: 'Update now → docs.yourapp.com/changelog',
};

const BRAND = {
  bg: '#09090B',
  card: '#18181B',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  accent: '#A78BFA',
  accentGlow: 'rgba(167, 139, 250, 0.2)',
  versionBadge: '#7C3AED',
};

const TIMING = {
  fps: 60,
  versionFrames: 60,       // 1s
  perUpdateFrames: 90,     // 1.5s
  updateStagger: 15,       // 0.25s between items
  ctaFrames: 90,           // 1.5s
  typewriterSpeed: 2,      // frames per character
};
// ============================================
```

---

## 关键动效

### 版本号登场
```typescript
// 大版本号 + blur-in 效果
const versionScale = spring({
  frame,
  fps: TIMING.fps,
  config: { damping: 80, stiffness: 200 },
});

const versionBlur = interpolate(frame, [0, 20], [10, 0], {
  extrapolateRight: 'clamp',
});

// style
{
  fontSize: 120,
  fontWeight: 900,
  transform: `scale(${versionScale})`,
  filter: `blur(${versionBlur}px)`,
  color: BRAND.text,
}
```

### 更新项逐条弹入
```typescript
RELEASE.updates.map((update, i) => {
  const start = TIMING.versionFrames + i * TIMING.updateStagger;
  
  // 左侧图标弹入
  const iconScale = spring({
    frame: frame - start,
    fps: TIMING.fps,
    config: { damping: 100, stiffness: 300 },
  });
  
  // 标题 typewriter
  const titleChars = Math.min(
    Math.floor((frame - start - 5) / TIMING.typewriterSpeed),
    update.title.length
  );
  const visibleTitle = frame > start + 5 ? update.title.slice(0, titleChars) : '';
  
  // 描述淡入
  const descOpacity = interpolate(frame, [start + 20, start + 35], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
});
```

---

## 变体模式

### 模式 A：紧凑列表（标准）
- 4-6 条更新项，垂直列表
- 最常见，适合 Twitter/X

### 模式 B：分类卡片
- 按类型分组（Features / Fixes / Improvements）
- 每组一张卡片
- 适合内容较多的大版本

### 模式 C：单项 Spotlight
- 每条更新占满全屏，逐页切换
- 适合有重大单项更新时

---

## 质量检查清单

- [ ] 版本号醒目清晰
- [ ] 更新条目排列整齐
- [ ] 图标与文字对齐
- [ ] typewriter 速度自然
- [ ] blur-in 不过度（不影响可读性）
- [ ] CTA 有足够阅读时间
