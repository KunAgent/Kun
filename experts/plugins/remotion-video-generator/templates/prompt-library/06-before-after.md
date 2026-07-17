# Before vs After 对比视频提示词

> 来源：X/Twitter 上最显得"专业"的对比格式
> 时长：10-15 秒 | 画幅：16:9 (1920x1080) | fps: 30

## 核心提示词

```text
做一条 {duration} 秒 Before/After 对比（16:9，30fps）。

输入：
Before: {before_items}
After: {after_items}

结构：
- 0-2s：标题 "{title}"
- 2-10s：左右分屏，对比项逐条出现（每条 1.3s）
- 10-12s：结论一句 "{conclusion}"

动效：分割线轻微呼吸、对比项出现用淡入+位移，关键字高亮。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const COMPARE = {
  title: 'Manual Process vs Automated Pipeline',
  before: {
    label: 'Before',
    color: '#EF4444',
    items: [
      { icon: '❌', text: '3 hours of manual work' },
      { icon: '❌', text: 'Error-prone process' },
      { icon: '❌', text: 'No version control' },
    ],
  },
  after: {
    label: 'After',
    color: '#22C55E',
    items: [
      { icon: '✓', text: '5 minutes, fully automated' },
      { icon: '✓', text: 'Zero errors, validated' },
      { icon: '✓', text: 'Git-backed, auditable' },
    ],
  },
  conclusion: 'Save 95% of your deployment time',
};

const BRAND = {
  bg: '#0F172A',
  cardBg: '#1E293B',
  divider: '#334155',
  text: '#F1F5F9',
  muted: '#94A3B8',
};

const TIMING = {
  fps: 30,
  titleFrames: 60,
  perItemFrames: 40,
  itemStagger: 12,
  conclusionFrames: 60,
  dividerBreatheCycle: 120, // 分割线呼吸周期（帧）
};
// ============================================
```

---

## 关键动效

### 分割线呼吸效果
```typescript
const dividerGlow = 0.3 + 0.2 * Math.sin(frame * (2 * Math.PI / TIMING.dividerBreatheCycle));
const dividerStyle = {
  width: 2,
  height: '80%',
  background: `linear-gradient(to bottom, transparent, rgba(100,116,139,${dividerGlow}), transparent)`,
};
```

### 对比项逐条出现
```typescript
const CompareItem: React.FC<{
  icon: string; text: string; side: 'left' | 'right';
  index: number; sectionStart: number;
}> = ({ icon, text, side, index, sectionStart }) => {
  const frame = useCurrentFrame();
  const start = sectionStart + index * TIMING.itemStagger;
  
  const opacity = interpolate(frame, [start, start + 15], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  
  const xDirection = side === 'left' ? -1 : 1;
  const translateX = interpolate(frame, [start, start + 20], [30 * xDirection, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  
  return (
    <div style={{
      opacity,
      transform: `translateX(${translateX}px)`,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0',
    }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <span style={{ fontSize: 24, color: BRAND.text }}>{text}</span>
    </div>
  );
};
```

---

## 质量检查清单

- [ ] 左右两列对齐整齐
- [ ] Before 条目用偏冷/灰色调，After 用暖/亮色调
- [ ] 分割线居中且有呼吸感
- [ ] 同一行的 Before/After 同时出现（形成对比）
- [ ] 结论文字足够大且醒目
