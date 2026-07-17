# 产品发布 / 功能公告视频提示词

> 来源：X/Twitter 上最常见的"像真产品发布片"风格
> 时长：10-15 秒 | 画幅：16:9 (1920x1080) | fps: 60

## 适用场景
- 新产品发布公告
- 重大功能更新
- 产品里程碑
- Waitlist 推广

---

## 核心提示词

```text
做一条 {duration} 秒产品发布短片（16:9，60fps）。

品牌风格：极简科技感，深色背景 + 高对比大字，留白充足。

结构：
1) 0-2s：hook（黑底白字，一句话钩子："{hook_text}"）
2) 2-7s：三条卖点（每条 1.5s，数字/关键词强调）
   - {selling_point_1}
   - {selling_point_2}
   - {selling_point_3}
3) 7-10s：一个"前后对比"画面（Before: {before} / After: {after}）
4) 10-12s：收尾 CTA（{cta_text}）

动效：
- 文字入场：typewriter + 轻微弹性
- 转场：crossfade + subtle blur
- 背景：极弱粒子/噪点漂浮（不要抢字）

把所有文案与颜色作为可编辑常量放在顶部。
先给分镜与文案建议，再生成代码。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const CONTENT = {
  hook: 'Your hook text here',
  sellingPoints: [
    { icon: '⚡', text: '10x Faster Processing' },
    { icon: '🔒', text: 'Enterprise-Grade Security' },
    { icon: '🌍', text: 'Global CDN Built-in' },
  ],
  before: 'Manual, error-prone process',
  after: 'Automated, reliable pipeline',
  cta: 'Join the waitlist → product.com',
};

const BRAND = {
  bg: '#0A0A0A',
  text: '#FAFAFA',
  accent: '#3B82F6',
  accentGlow: 'rgba(59, 130, 246, 0.3)',
  muted: '#71717A',
};

const TYPOGRAPHY = {
  hookSize: 80,
  pointSize: 48,
  ctaSize: 40,
  font: 'Inter',
};

const TIMING = {
  fps: 60,
  hookFrames: 120,        // 2s
  pointsFrames: 300,      // 5s
  compareFrames: 180,     // 3s
  ctaFrames: 120,         // 2s
  fadeFrames: 15,
  staggerGap: 30,
};
// ============================================
```

---

## 动效要点

### Hook 入场
```typescript
// Typewriter + 弹性
const hookText = CONTENT.hook;
const charsToShow = Math.min(Math.floor(frame / 2), hookText.length);
const visibleText = hookText.slice(0, charsToShow);

// 光标闪烁
const cursorOpacity = Math.sin(frame * 0.15) > 0 ? 1 : 0;
```

### 卖点逐条出现
```typescript
// 每条卖点交错出现
CONTENT.sellingPoints.map((point, i) => {
  const delay = i * TIMING.staggerGap;
  const opacity = interpolate(frame, [delay, delay + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const x = interpolate(frame, [delay, delay + 25], [-60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // ...
});
```

### Before/After 对比
```typescript
// 分割线从左向右划过
const splitPosition = interpolate(frame, [0, 40], [0, 50], {
  extrapolateRight: 'clamp',
});
// 左侧 Before（灰暗色调），右侧 After（明亮色调）
```

### 背景微粒
```typescript
// 极弱的噪点漂浮（不干扰阅读）
const noiseOpacity = 0.03;
const noiseOffset = frame * 0.5;
// 使用 CSS background-image 或 canvas 绘制
```

---

## 变体模式

### 模式 A：极简公告（8秒）
1. Hook (2s) → 核心卖点 (4s) → CTA (2s)
2. 适合 Twitter/X 嵌入

### 模式 B：功能详解（20秒）
1. Hook (3s) → 痛点 (4s) → 解决方案 (3s) → 3个功能 (7s) → CTA (3s)
2. 适合 YouTube 前贴片

### 模式 C：里程碑庆祝（12秒）
1. 大数字动画 (3s) → 意义解读 (5s) → 感谢 + CTA (4s)
2. 适合用户量/ARR 里程碑

---

## 质量检查清单

- [ ] Hook 能在 1 秒内抓住注意力
- [ ] 文字足够大（最小 40px）
- [ ] 深色背景下文字对比度 > 7:1
- [ ] 动效不超过 30 帧（0.5s@60fps）
- [ ] 噪点/粒子不干扰阅读
- [ ] CTA 清晰可见且有 pulse 动效
- [ ] 常量全部在顶部可编辑
