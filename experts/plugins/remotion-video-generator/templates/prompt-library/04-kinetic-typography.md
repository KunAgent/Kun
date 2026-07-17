# Kinetic Typography（动态文字排版）提示词

> 来源：社媒传播力极强的金句/口播字幕风格
> 时长：8-15 秒 | 画幅：9:16 (1080x1920) 竖屏 | fps: 30

## 适用场景
- 名人金句动画
- 口播字幕风格视频
- 励志/教育短视频
- Podcast 精彩片段可视化
- 品牌口号动画

---

## 核心提示词

```text
做一条 {duration} 秒金句动效视频（9:16，30fps）。

输入：
- 金句："{quote_text}"
- 作者：{author}

要求：
- 字体大、断行讲究（每行 2–4 个词），关键字用强调色
- 逐词/逐行节奏跟随"拟口播"节拍（你自己设节奏）
- 背景用柔和渐变 + 很轻的噪点
- 片尾 1s：作者署名淡入

动效风格：每个词有微妙的弹性入场，关键词放大或变色强调。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const QUOTE = {
  // 每行一个数组元素，关键词用 {强调} 标记
  lines: [
    'The best way',
    'to {predict}',
    'the future',
    'is to {create} it.',
  ],
  author: '— Peter Drucker',
  highlightWords: ['predict', 'create'], // 这些词用强调色
};

const STYLE = {
  bg: 'linear-gradient(135deg, #0F0C29 0%, #302B63 50%, #24243E 100%)',
  text: '#FFFFFF',
  highlight: '#FBBF24', // 强调词颜色
  authorColor: '#94A3B8',
  font: 'Montserrat',
  fontSize: 80,
  authorSize: 32,
  fontWeight: 800,
  lineHeight: 1.2,
};

const RHYTHM = {
  fps: 30,
  framesPerLine: 25,     // 每行持续帧数
  lineStagger: 20,       // 行与行之间间隔
  wordStagger: 5,        // 词与词之间间隔（同一行内）
  holdAtEnd: 45,          // 全部显示后保持的帧数
  authorDelay: 30,        // 作者署名在全文后延迟帧数
  authorFadeDuration: 20, // 作者署名淡入时长
};
// ============================================
```

---

## 动效要点

### 逐词弹性入场
```typescript
// 解析行文本，提取普通词和强调词
const parseLine = (line: string) => {
  const words = line.split(' ');
  return words.map(word => {
    const isHighlight = word.startsWith('{') && word.endsWith('}');
    return {
      text: isHighlight ? word.slice(1, -1) : word,
      isHighlight,
    };
  });
};

// 单词入场动画
const WordReveal: React.FC<{
  word: string;
  isHighlight: boolean;
  startFrame: number;
}> = ({ word, isHighlight, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // 弹性缩放
  const scale = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 80, stiffness: 300 },
  });
  
  // 淡入
  const opacity = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  
  // 轻微上移
  const y = interpolate(frame, [startFrame, startFrame + 15], [15, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  
  return (
    <span style={{
      display: 'inline-block',
      opacity,
      transform: `scale(${scale}) translateY(${y}px)`,
      color: isHighlight ? STYLE.highlight : STYLE.text,
      fontSize: isHighlight ? STYLE.fontSize * 1.1 : STYLE.fontSize,
      fontWeight: isHighlight ? 900 : STYLE.fontWeight,
      marginRight: 16,
    }}>
      {word}
    </span>
  );
};
```

### 背景渐变漂移
```typescript
// 柔和的背景渐变动画
const bgAngle = 135 + frame * 0.1; // 极慢旋转
const bgStyle = {
  background: `linear-gradient(${bgAngle}deg, #0F0C29 0%, #302B63 50%, #24243E 100%)`,
};

// 叠加极弱噪点（用 CSS filter）
const noiseOverlay = {
  position: 'absolute' as const,
  inset: 0,
  opacity: 0.04,
  backgroundImage: 'url("data:image/svg+xml,...")', // 噪点 SVG
  mixBlendMode: 'overlay' as const,
};
```

### 作者署名
```typescript
// 全文显示完毕后，作者从底部淡入
const allLinesEnd = QUOTE.lines.length * RHYTHM.lineStagger + RHYTHM.framesPerLine;
const authorStart = allLinesEnd + RHYTHM.authorDelay;
const authorOpacity = interpolate(
  frame,
  [authorStart, authorStart + RHYTHM.authorFadeDuration],
  [0, 1],
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
);
const authorY = interpolate(
  frame,
  [authorStart, authorStart + RHYTHM.authorFadeDuration + 10],
  [20, 0],
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
);
```

---

## 高级技巧

### 关键词高亮下划线动画
```typescript
// 关键词下方画一条下划线，从左到右展开
const underlineWidth = interpolate(
  frame,
  [startFrame + 10, startFrame + 25],
  [0, 100],
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
);
// style: borderBottom + width animation
```

### 文字阴影脉冲
```typescript
// 关键词有微弱的发光效果
const glowIntensity = interpolate(
  frame,
  [startFrame, startFrame + 30],
  [0, 1],
  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
);
const textShadow = `0 0 ${20 * glowIntensity}px ${STYLE.highlight}40`;
```

### 节奏感控制
```typescript
// 模拟口播节奏：重要的词前面有微停顿
const rhythmPause = (lineIndex: number) => {
  // 第一行快速，后续行略慢
  if (lineIndex === 0) return 0;
  return 5; // 额外 5 帧停顿
};
```

---

## 变体模式

### 模式 A：逐词出现（标准）
- 每个词依次弹入
- 最经典的 kinetic typography 风格

### 模式 B：逐行出现
- 整行同时出现（淡入 + 上移）
- 更稳重，适合长句

### 模式 C：关键词放大
- 普通词小号，关键词突然放大占满屏
- 冲击力强，适合短金句

### 模式 D：打字机风格
- 逐字符出现 + 光标闪烁
- 复古感，适合代码/技术领域

### 模式 E：分裂/聚合
- 文字从屏幕四周飞入聚合成完整句子
- 高能量，适合 hype/发布

---

## 质量检查清单

- [ ] 竖屏格式文字在安全区内（距边缘 60px+）
- [ ] 每行不超过 4 个词（保证可读性）
- [ ] 关键词颜色与背景对比度 > 4.5:1
- [ ] 动画节奏自然（不机械）
- [ ] 作者署名不抢主文视觉
- [ ] 背景渐变不干扰文字阅读
- [ ] 在手机上预览测试字号大小
