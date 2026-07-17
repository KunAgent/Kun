# Thread / 帖子总结视频提示词

> 来源：X/Twitter 上高转发的信息流卡片风格
> 时长：15-25 秒 | 画幅：9:16 (1080x1920) 竖屏 | fps: 30

## 核心提示词

```text
把一段 thread/帖子总结做成 {duration} 秒视频（9:16，30fps）。

输入：{count} 条要点：
{points_list}

结构：
- 0-2s：标题（像新闻快讯样式，"{title}"）
- 2-{main}s：每条要点 2–3s，配一个简单 icon（用 lucide 风格线性图标即可）
- {main}-{duration}s：关注/收藏提示

要求：排版像高质量信息流卡片，留白充足，字号层级清晰。
每条要点用卡片形式，带数字序号和细分类标签。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const THREAD = {
  title: '🔥 5 Things You Should Know About AI in 2026',
  source: '@techinsider · 2h ago',
  points: [
    { num: 1, tag: 'AI', text: 'Claude 4 can now write and debug entire codebases autonomously' },
    { num: 2, tag: 'Hardware', text: 'New AI chips are 100x more efficient than 2024 GPUs' },
    { num: 3, tag: 'Business', text: '60% of Fortune 500 now have dedicated AI departments' },
    { num: 4, tag: 'Science', text: 'AI discovered 3 new materials for room-temp superconductors' },
    { num: 5, tag: 'Ethics', text: 'EU passed comprehensive AI regulation framework' },
  ],
  cta: 'Save this · Follow for more',
};

const CARD_STYLE = {
  bg: '#FFFFFF',
  cardBg: '#F8FAFC',
  cardBorder: '#E2E8F0',
  text: '#0F172A',
  textSecondary: '#64748B',
  tagBg: '#EEF2FF',
  tagText: '#4F46E5',
  accent: '#3B82F6',
  numBg: '#3B82F6',
  numText: '#FFFFFF',
};

const TIMING = {
  fps: 30,
  titleFrames: 60,
  perPointFrames: 75,
  pointStagger: 10,
  ctaFrames: 60,
};
// ============================================
```

---

## 关键组件

### 信息卡片
```typescript
const PointCard: React.FC<{
  point: typeof THREAD.points[0];
  index: number;
  startFrame: number;
}> = ({ point, index, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // 卡片从下方滑入
  const slideY = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 100, stiffness: 200 },
  });
  const translateY = interpolate(slideY, [0, 1], [80, 0]);
  
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  
  return (
    <div style={{
      opacity,
      transform: `translateY(${translateY}px)`,
      backgroundColor: CARD_STYLE.cardBg,
      borderRadius: 16,
      padding: '20px 24px',
      border: `1px solid ${CARD_STYLE.cardBorder}`,
      display: 'flex',
      gap: 16,
      alignItems: 'flex-start',
      marginBottom: 12,
    }}>
      {/* 序号圆圈 */}
      <div style={{
        minWidth: 36, height: 36, borderRadius: '50%',
        backgroundColor: CARD_STYLE.numBg, color: CARD_STYLE.numText,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700,
      }}>
        {point.num}
      </div>
      
      <div>
        {/* 标签 */}
        <span style={{
          display: 'inline-block',
          backgroundColor: CARD_STYLE.tagBg, color: CARD_STYLE.tagText,
          fontSize: 13, fontWeight: 600, padding: '2px 10px',
          borderRadius: 6, marginBottom: 8,
        }}>
          {point.tag}
        </span>
        
        {/* 内容 */}
        <p style={{
          fontSize: 20, color: CARD_STYLE.text,
          lineHeight: 1.5, margin: 0,
        }}>
          {point.text}
        </p>
      </div>
    </div>
  );
};
```

### 新闻快讯标题栏
```typescript
const TitleBar = () => {
  const frame = useCurrentFrame();
  
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const lineWidth = interpolate(frame, [10, 30], [0, 100], { extrapolateRight: 'clamp' });
  
  return (
    <div style={{ opacity, padding: '40px 40px 20px' }}>
      {/* 红色快讯线 */}
      <div style={{
        width: `${lineWidth}%`, height: 3,
        backgroundColor: '#EF4444', marginBottom: 16,
        borderRadius: 2,
      }} />
      
      <h1 style={{ fontSize: 36, fontWeight: 800, color: CARD_STYLE.text, margin: 0 }}>
        {THREAD.title}
      </h1>
      
      <p style={{ fontSize: 16, color: CARD_STYLE.textSecondary, marginTop: 8 }}>
        {THREAD.source}
      </p>
    </div>
  );
};
```

---

## 变体模式

### 模式 A：卡片列表（标准）
- 每条要点一张卡片，从下方滑入
- 信息流风格

### 模式 B：全屏逐页
- 每条要点占满全屏
- 翻页转场，适合内容较长的要点

### 模式 C：时间线风格
- 左侧竖线 + 节点
- 要点沿时间线排列

---

## 质量检查清单

- [ ] 卡片在安全区内（竖屏上下各留 80px+）
- [ ] 文字大小在手机上清晰可读（最小 18px）
- [ ] 标签颜色统一
- [ ] 序号清晰可辨
- [ ] 卡片间距一致
- [ ] 标题有新闻感/紧迫感
- [ ] CTA 不与平台 UI 重叠
