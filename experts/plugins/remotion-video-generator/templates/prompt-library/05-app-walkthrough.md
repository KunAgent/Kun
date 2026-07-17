# App Walkthrough / UI 演示提示词

> 来源：X/Twitter 上产品团队常发的高质感操作演示
> 时长：15-25 秒 | 画幅：9:16 (1080x1920) 竖屏 或 16:9 | fps: 60

## 核心提示词

```text
做一条 {duration} 秒 App 操作演示（{aspect_ratio}，60fps）。

输入：{steps_count} 个步骤文案：
1. {step_1}
2. {step_2}
3. {step_3}

画面：
- 中间是一台手机框（矢量模拟即可，圆角矩形 + 刘海/灵动岛）
- 每步出现一个"高亮矩形框"圈住操作区域，同时右侧弹出说明气泡
- 步骤之间用 crossfade 转场

动效：
- 高亮框用描边动画（从 0% 到 100% stroke-dashoffset）
- 气泡从右侧滑入并带轻微弹性
- 手机屏幕内容模拟 UI 卡片（不需要真实截图）

收尾：一句 CTA "{cta_text}" + 二维码占位框
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const APP = {
  name: 'YourApp',
  steps: [
    {
      title: 'Step 1: Create Project',
      description: 'Tap the + button to start a new project',
      highlightArea: { x: 160, y: 400, width: 200, height: 50 }, // 手机内坐标
    },
    {
      title: 'Step 2: Add Content',
      description: 'Drag and drop elements to build your layout',
      highlightArea: { x: 40, y: 200, width: 340, height: 300 },
    },
    {
      title: 'Step 3: Share',
      description: 'One tap to publish and share with anyone',
      highlightArea: { x: 280, y: 50, width: 100, height: 40 },
    },
  ],
  cta: 'Download Free on App Store',
};

const PHONE = {
  width: 380,
  height: 760,
  borderRadius: 40,
  notchWidth: 160,
  notchHeight: 30,
  bezel: 8,
  bgColor: '#F8FAFC',
  frameColor: '#1E293B',
};

const BRAND = {
  bg: '#0F172A',
  accent: '#3B82F6',
  text: '#F1F5F9',
  bubble: '#1E293B',
  highlight: '#3B82F6',
  highlightGlow: 'rgba(59, 130, 246, 0.3)',
};

const TIMING = {
  fps: 60,
  perStepFrames: 300,     // 5s per step
  highlightDrawFrames: 40, // 描边动画时长
  bubbleDelay: 20,         // 气泡在高亮后延迟出现
  bubbleSlideFrames: 25,   // 气泡滑入时长
  ctaFrames: 180,          // 3s
  transitionFrames: 30,    // 步骤间转场
};
// ============================================
```

---

## 关键组件

### 手机框
```typescript
const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    width: PHONE.width + PHONE.bezel * 2,
    height: PHONE.height + PHONE.bezel * 2,
    backgroundColor: PHONE.frameColor,
    borderRadius: PHONE.borderRadius + PHONE.bezel,
    padding: PHONE.bezel,
    boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
    position: 'relative',
  }}>
    {/* 灵动岛 */}
    <div style={{
      position: 'absolute',
      top: PHONE.bezel + 12,
      left: '50%',
      transform: 'translateX(-50%)',
      width: PHONE.notchWidth,
      height: PHONE.notchHeight,
      backgroundColor: PHONE.frameColor,
      borderRadius: 20,
      zIndex: 10,
    }} />
    {/* 屏幕内容 */}
    <div style={{
      width: PHONE.width,
      height: PHONE.height,
      borderRadius: PHONE.borderRadius,
      backgroundColor: PHONE.bgColor,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {children}
    </div>
  </div>
);
```

### 高亮描边动画
```typescript
const HighlightBox: React.FC<{
  area: { x: number; y: number; width: number; height: number };
  startFrame: number;
}> = ({ area, startFrame }) => {
  const frame = useCurrentFrame();
  
  // 描边进度
  const drawProgress = interpolate(
    frame,
    [startFrame, startFrame + TIMING.highlightDrawFrames],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  const perimeter = 2 * (area.width + area.height);
  const dashOffset = perimeter * (1 - drawProgress);
  
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <rect
        x={area.x}
        y={area.y}
        width={area.width}
        height={area.height}
        rx={8}
        fill="none"
        stroke={BRAND.highlight}
        strokeWidth={3}
        strokeDasharray={perimeter}
        strokeDashoffset={dashOffset}
      />
      {/* 发光效果 */}
      <rect
        x={area.x - 4}
        y={area.y - 4}
        width={area.width + 8}
        height={area.height + 8}
        rx={12}
        fill="none"
        stroke={BRAND.highlightGlow}
        strokeWidth={8}
        opacity={drawProgress * 0.5}
      />
    </svg>
  );
};
```

### 说明气泡
```typescript
const InfoBubble: React.FC<{
  title: string;
  description: string;
  startFrame: number;
}> = ({ title, description, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const bubbleStart = startFrame + TIMING.bubbleDelay;
  
  const slideX = spring({
    frame: frame - bubbleStart,
    fps,
    config: { damping: 100, stiffness: 250 },
  });
  
  const opacity = interpolate(frame, [bubbleStart, bubbleStart + 15], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  
  const translateX = interpolate(slideX, [0, 1], [60, 0]);
  
  return (
    <div style={{
      opacity,
      transform: `translateX(${translateX}px)`,
      backgroundColor: BRAND.bubble,
      borderRadius: 16,
      padding: '16px 20px',
      maxWidth: 260,
      borderLeft: `3px solid ${BRAND.accent}`,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: BRAND.text, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.4 }}>
        {description}
      </div>
    </div>
  );
};
```

---

## 质量检查清单

- [ ] 手机框比例正确（约 19.5:9）
- [ ] 描边动画流畅（无断点）
- [ ] 气泡不遮挡高亮区域
- [ ] 步骤间转场平滑
- [ ] UI 卡片看起来真实（不是纯色块）
- [ ] CTA 区域清晰
- [ ] 60fps 渲染流畅
