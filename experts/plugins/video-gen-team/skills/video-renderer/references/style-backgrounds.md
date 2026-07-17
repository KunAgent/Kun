# 视频风格背景模板

根据灵枢 JSON 制作包中的 `style` 字段选择对应背景。

## 风格对应表

| style 值 | 中文名 | 背景颜色 | 装饰元素 |
|---------|--------|---------|---------|
| `tech` | 科技风 | 深蓝 `#0a0f1e` → 深紫 `#1a0533` | 霓虹蓝线条流动，粒子光点 |
| `education` | 教育风 | 白 `#f5f7fa` → 浅蓝 `#e8f4fd` | 手写字体装饰，图解动画 |
| `review` | 评测风 | 深灰 `#1a1a2e` → 中灰 `#16213e` | 产品特写框，对比表格 |
| `business` | 商务风 | 纯黑 `#0d0d0d` | 金色 `#d4af37` 装饰线 |
| `geek` | 极客风 | 暗色界面 `#0d1117` | 代码高亮，终端动画 |

## tech 风格 CSS 示例

```css
#background {
  background: linear-gradient(135deg, #0a0f1e 0%, #1a0533 100%);
  position: absolute;
  width: 1920px;
  height: 1080px;
}
.neon-line {
  position: absolute;
  height: 1px;
  background: rgba(0, 200, 255, 0.4);
  animation: flow 3s linear infinite;
}
.particle {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(100, 180, 255, 0.6);
  animation: float 4s ease-in-out infinite;
}
```

## education 风格 CSS 示例

```css
#background {
  background: linear-gradient(180deg, #f5f7fa 0%, #e8f4fd 100%);
  position: absolute;
  width: 1920px;
  height: 1080px;
}
```

## 字幕样式（通用）

```css
.subtitle {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  color: #ffffff;
  font-family: "Source Han Sans CN", "思源黑体", sans-serif;
  font-size: 48px;
  font-weight: 500;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  text-align: center;
  max-width: 1600px;
  line-height: 1.4;
}
```

## BGM 文件命名约定

存放路径：`/tmp/ling-factory/bgm/`

| style | 文件名 | 风格描述 |
|-------|--------|---------|
| tech | `tech-ambient.mp3` | 轻快科技感，无歌词 |
| education | `education-light.mp3` | 清新轻松，钢琴为主 |
| review | `review-neutral.mp3` | 中性背景，稳重 |
| business | `business-formal.mp3` | 商务感，低调 |
| geek | `geek-electronic.mp3` | 电子感，节拍感强 |
