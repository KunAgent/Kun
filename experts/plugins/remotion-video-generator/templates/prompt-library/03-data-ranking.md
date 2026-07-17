# 数据榜单 / Top N 排名动画提示词

> 来源：Reddit/X 高转发的动态排行榜视频
> 时长：15-30 秒 | 画幅：16:9 (1920x1080) | fps: 30

## 适用场景
- Top 10 排名动画
- 数据对比图表
- 行业报告可视化
- 年度回顾榜单

---

## 核心提示词

```text
做一条 {duration} 秒的 Top {N} 榜单视频（16:9，30fps）。

输入数据：
{data_array}
// 例: [{name: "React", value: 220000}, {name: "Vue", value: 210000}, ...]

要求：
- 每个条目 1.5–2s，条形进度条从 0 动画到 value 对应比例
- 排名变化要平滑（不要跳动），数字要计数动画
- 背景干净、字体统一、配色克制（最多 2 个主色）
- 片头 2s：标题 "{chart_title}" + 数据来源（小字 "{data_source}"）
- 片尾 2s：总结一句洞察 "{insight}"

先输出分镜和数据映射，再生成代码。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const CHART_DATA = [
  { rank: 1, name: 'React', value: 220000, color: '#61DAFB' },
  { rank: 2, name: 'Vue', value: 210000, color: '#42B883' },
  { rank: 3, name: 'Angular', value: 95000, color: '#DD0031' },
  { rank: 4, name: 'Svelte', value: 78000, color: '#FF3E00' },
  { rank: 5, name: 'Next.js', value: 120000, color: '#000000' },
];

const CHART_CONFIG = {
  title: 'Most Popular Frontend Frameworks 2026',
  subtitle: 'By GitHub Stars',
  dataSource: 'Source: GitHub, January 2026',
  insight: 'React continues to lead, but the gap is narrowing',
  maxBarWidth: 1200, // px
  barHeight: 60,
  barGap: 20,
  barRadius: 8,
};

const BRAND = {
  bg: '#0F172A',
  cardBg: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  accent: '#3B82F6',
  grid: 'rgba(148, 163, 184, 0.1)',
};

const TIMING = {
  fps: 30,
  titleFrames: 60,        // 2s
  perItemFrames: 50,       // ~1.7s
  itemStaggerGap: 20,      // frames between items
  insightFrames: 60,       // 2s
  barGrowDuration: 30,     // frames for bar to grow
  countUpDuration: 25,     // frames for number counting
};
// ============================================
```

---

## 动效要点

### 条形图增长动画
```typescript
// 条形从 0 增长到目标宽度
const BarItem: React.FC<{ item: typeof CHART_DATA[0]; index: number; maxValue: number }> = 
  ({ item, index, maxValue }) => {
  const frame = useCurrentFrame();
  
  // 交错出现
  const startFrame = TIMING.titleFrames + index * TIMING.itemStaggerGap;
  
  // 标签淡入
  const labelOpacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  
  // 条形增长
  const barProgress = interpolate(
    frame,
    [startFrame + 5, startFrame + 5 + TIMING.barGrowDuration],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const barWidth = (item.value / maxValue) * CHART_CONFIG.maxBarWidth * barProgress;
  
  // 数字计数
  const countProgress = interpolate(
    frame,
    [startFrame + 10, startFrame + 10 + TIMING.countUpDuration],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const displayValue = Math.floor(item.value * countProgress);
  
  return (
    <div style={{ opacity: labelOpacity, display: 'flex', alignItems: 'center', gap: 16, marginBottom: CHART_CONFIG.barGap }}>
      {/* 排名 */}
      <span style={{ fontSize: 24, fontWeight: 700, width: 40, color: BRAND.textSecondary }}>
        #{item.rank}
      </span>
      
      {/* 名称 */}
      <span style={{ fontSize: 24, fontWeight: 600, width: 120, color: BRAND.text }}>
        {item.name}
      </span>
      
      {/* 条形 */}
      <div style={{
        width: barWidth,
        height: CHART_CONFIG.barHeight,
        backgroundColor: item.color,
        borderRadius: CHART_CONFIG.barRadius,
        transition: 'none', // 禁止 CSS transition！
      }} />
      
      {/* 数值 */}
      <span style={{ fontSize: 20, fontWeight: 500, color: BRAND.textSecondary, minWidth: 80 }}>
        {displayValue.toLocaleString()}
      </span>
    </div>
  );
};
```

### 标题入场
```typescript
// 标题 + 副标题交错淡入
const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
const subtitleOpacity = interpolate(frame, [15, 35], [0, 1], { extrapolateRight: 'clamp' });
const titleY = interpolate(frame, [0, 25], [20, 0], { extrapolateRight: 'clamp' });
```

### 洞察总结
```typescript
// 片尾洞察：从底部滑入 + 淡入
const insightStart = TIMING.titleFrames + CHART_DATA.length * TIMING.itemStaggerGap + 30;
const insightOpacity = interpolate(frame, [insightStart, insightStart + 20], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
});
```

---

## 变体模式

### 模式 A：静态排名（标准榜单）
- 数据固定，条形逐个出现
- 适合年度排名、市场份额

### 模式 B：动态排名变化（Racing Bar Chart）
- 条形位置随时间变化（排名升降）
- 需要时间序列数据
- 适合历年变化、竞争对比

### 模式 C：数值对比（双列对比）
- 左右两列对比（如：2024 vs 2025）
- 适合同比增长、A/B 对比

### 模式 D：饼图/环形图
- 扇形逐个展开动画
- 适合市场份额、组成分析

---

## 配色建议

### 科技主题
```typescript
const TECH_COLORS = ['#3B82F6', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];
```

### 商务主题
```typescript
const BIZ_COLORS = ['#1E40AF', '#3730A3', '#0F766E', '#15803D', '#A16207', '#B91C1C'];
```

### 活力主题
```typescript
const VIBRANT_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
```

---

## 质量检查清单

- [ ] 条形增长动画平滑（无跳帧）
- [ ] 数字计数动画与条形同步
- [ ] 排名标号清晰可见
- [ ] 配色不超过 6 种（含背景）
- [ ] 数据来源标注在画面中
- [ ] 最大值条形不超出安全区
- [ ] 片尾洞察有足够阅读时间
