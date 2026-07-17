---
name: skyline-components
description: Skyline 组件开发技能。涵盖 scroll-view 及其增强模式（列表/嵌套滚动）、swiper 高级特性、表单组件、图片/文本组件、半屏可拖拽组件、共享元素动画等。适用于需要开发滚动列表、轮播、表单输入、页面过渡动画等场景。
---

# Skyline 组件开发指南

## 适用场景

- 开发滚动列表/瀑布流/网格布局
- 实现下拉刷新、下拉二级功能
- 使用嵌套滚动模式
- 开发轮播图、卡片切换效果
- 处理表单输入（input/textarea）
- 实现共享元素/页面转场动画
- 开发半屏可拖拽面板

## 组件支持概览

### 完全支持的高频组件

| 组件 | Skyline 特性增强 |
|------|-----------------|
| scroll-view | type 模式、worklet 回调、嵌套滚动、下拉二级 |
| swiper | layout-type 堆叠/卡片、indicator 动画类型 |
| text | overflow 文本溢出处理、max-lines |
| image | fade-in 渐显、默认懒加载 |
| input/textarea | worklet 键盘回调、输入法事件 |
| view/button | 完全支持 |

### Skyline 新增组件

| 组件 | 说明 |
|------|------|
| list-view | 列表布局容器 |
| grid-view | 网格/瀑布流容器 |
| sticky-section/sticky-header | 吸顶布局 |
| nested-scroll-header/body | 嵌套滚动 |
| draggable-sheet | 半屏可拖拽 |
| share-element | 共享元素动画 |
| snapshot | 截图组件 |
| span | 内联混排 |

## 文档索引

根据需求快速定位（路径相对于 `references/`）：

| 我想要... | 查阅文档 |
|-----------|----------|
| 实现长列表/虚拟列表 | `scroll/scroll-view.md` |
| 下拉刷新/下拉二级 | `scroll/scroll-view.md#下拉刷新` |
| 嵌套滚动 | `scroll/nested-scroll.md` |
| 列表/网格布局 | `scroll/list-grid-view.md` |
| 吸顶效果 | `scroll/sticky.md` |
| 半屏拖拽面板 | `scroll/draggable-sheet.md` |
| 轮播图/卡片效果 | `layout/swiper.md` |
| 文本处理 | `media/text.md` |
| 图片显示 | `media/image.md` |
| 输入框开发 | `form/input.md` |
| 共享元素动画 | `special/share-element.md` |
| 截图功能 | `special/snapshot.md` |

## 强制规则

### MUST（必须遵守）

1. **scroll-view 必须指定 type**：Skyline 下使用 scroll-view 必须设置 `type` 属性
   ```html
   <!-- ✅ 正确 -->
   <scroll-view type="list" scroll-y>...</scroll-view>
   
   <!-- ❌ 错误：缺少 type -->
   <scroll-view scroll-y>...</scroll-view>
   ```

2. **横向滚动需 enable-flex**：横向滚动需同时开启 `enable-flex` 以兼容 WebView
   ```html
   <scroll-view scroll-x enable-flex style="flex-direction: row;">
   ```

3. **文本必须用 text 组件**：内联文本只能用 `<text>` 组件
   ```html
   <!-- ✅ 正确 -->
   <text>Hello <text>World</text></text>
   
   <!-- ❌ 错误：内联文本不能用 view -->
   <view>Hello <view>World</view></view>
   ```

4. **list-view/grid-view 必须在 custom 模式**：
   ```html
   <scroll-view type="custom" scroll-y>
     <list-view>...</list-view>
   </scroll-view>
   ```

5. **嵌套滚动必须使用 nested 模式**：
   ```html
   <scroll-view type="nested" scroll-y>
     <nested-scroll-header>...</nested-scroll-header>
     <nested-scroll-body>...</nested-scroll-body>
   </scroll-view>
   ```

### NEVER（禁止行为）

1. **NEVER** 在 scroll-view 外直接放置 list-view/grid-view
2. **NEVER** 在 list-view 中使用非直接子节点列表项
3. **NEVER** 在 Skyline 使用 web-view/editor/movable-view 组件
4. **NEVER** 依赖 image 的 WebView-only 裁剪模式（top/bottom/center/left/right）

## scroll-view 核心用法

### type 属性详解

| type 值 | 说明 | 使用场景 |
|---------|------|----------|
| list | 列表模式，按需渲染直接子节点 | 普通长列表 |
| custom | 自定义模式，支持 list-view/grid-view/sticky | 复杂布局 |
| nested | 嵌套模式，处理父子 scroll-view 联动 | Tab + 列表 |

### 基础列表模式

```html
<!-- 列表模式：直接子节点按需渲染 -->
<scroll-view 
  type="list" 
  scroll-y
  style="height: 100vh;"
  bindscrolltolower="loadMore"
>
  <view wx:for="{{list}}" wx:key="id">
    {{item.name}}
  </view>
</scroll-view>
```

### 下拉刷新

```html
<scroll-view
  type="list"
  scroll-y
  refresher-enabled="{{true}}"
  refresher-triggered="{{refreshing}}"
  bindrefresherrefresh="onRefresh"
>
  <view slot="refresher" class="custom-refresher">
    自定义刷新区域
  </view>
  <!-- 列表内容 -->
</scroll-view>
```

```javascript
Page({
  data: { refreshing: false },
  onRefresh() {
    this.setData({ refreshing: true })
    // 加载数据...
    setTimeout(() => {
      this.setData({ refreshing: false })
    }, 1000)
  }
})
```

### 嵌套滚动模式

```html
<scroll-view type="nested" scroll-y>
  <nested-scroll-header>
    <view>顶部固定区域</view>
  </nested-scroll-header>
  <nested-scroll-body>
    <swiper>
      <swiper-item wx:for="{{tabs}}" wx:key="id">
        <scroll-view 
          type="list" 
          scroll-y
          associative-container="nested-scroll-view"
        >
          <!-- 列表内容 -->
        </scroll-view>
      </swiper-item>
    </swiper>
  </nested-scroll-body>
</scroll-view>
```

### Worklet 滚动回调

```html
<scroll-view
  type="list"
  scroll-y
  worklet:onscrollupdate="onScrollUpdate"
>
```

```javascript
Page({
  onScrollUpdate(e) {
    'worklet'
    // 在 UI 线程执行，无延迟
    console.log(e.detail.scrollTop)
  }
})
```

## swiper 增强特性

### 布局类型

```html
<!-- 堆叠效果 -->
<swiper layout-type="stackLeft">
  <swiper-item>...</swiper-item>
</swiper>

<!-- 卡片滑动 -->
<swiper layout-type="tinder">
  <swiper-item>...</swiper-item>
</swiper>

<!-- 过渡动画 -->
<swiper layout-type="transformer" transformer-type="threeD">
  <swiper-item>...</swiper-item>
</swiper>
```

### 指示器样式

```html
<swiper
  indicator-dots
  indicator-type="worm"
  indicator-color="rgba(0,0,0,0.3)"
  indicator-active-color="#000"
  indicator-margin="10"
  indicator-spacing="4"
>
```

| indicator-type | 效果 |
|----------------|------|
| normal | 默认圆点 |
| worm | 蠕虫动画 |
| expand | 展开动画 |
| jump | 跳跃动画 |
| slide | 滑动动画 |
| scale | 缩放动画 |

## text 组件

### 文本溢出处理

```html
<!-- 单行省略 -->
<text overflow="ellipsis" max-lines="1">
  这是一段很长的文本内容...
</text>

<!-- 多行省略 -->
<text overflow="ellipsis" max-lines="3">
  这是一段很长的文本内容...
</text>

<!-- 渐隐效果 -->
<text overflow="fade" max-lines="1">
  这是一段很长的文本内容...
</text>
```

### 内联混排

```html
<!-- 使用 span 实现图文混排 -->
<span>
  <image src="icon.png" style="width:20px;height:20px;" />
  <text>图文混排内容</text>
</span>
```

## input 组件

### Skyline 特有事件

```html
<input
  value="{{value}}"
  bindinput="onInput"
  bind:selectionchange="onSelectionChange"
  bind:keyboardcompositionend="onCompositionEnd"
  worklet:onkeyboardheightchange="onKeyboardHeight"
/>
```

```javascript
Page({
  onKeyboardHeight(e) {
    'worklet'
    // UI 线程回调，可用于同步调整布局
    const { height, pageBottomPadding } = e.detail
  }
})
```

## draggable-sheet 半屏组件

```html
<draggable-sheet
  class="sheet"
  initial-child-size="0.5"
  min-child-size="0.2"
  max-child-size="0.8"
  snap="{{true}}"
  snap-sizes="{{[0.4, 0.6]}}"
  worklet:onsizeupdate="onSizeUpdate"
>
  <scroll-view
    scroll-y
    type="list"
    associative-container="draggable-sheet"
  >
    <!-- 内容 -->
  </scroll-view>
</draggable-sheet>
```

```javascript
Page({
  onReady() {
    this.createSelectorQuery()
      .select('.sheet')
      .node()
      .exec(res => {
        const sheetContext = res[0].node
        sheetContext.scrollTo({
          size: 0.7,
          animated: true,
          duration: 300
        })
      })
  }
})
```

## share-element 共享元素

### 页面间共享元素动画

源页面：
```html
<share-element key="hero-image" transform>
  <image src="{{item.cover}}" />
</share-element>
```

目标页面：
```html
<share-element key="hero-image" transform transition-on-gesture>
  <image src="{{detail.cover}}" />
</share-element>
```

### 属性说明

| 属性 | 说明 |
|------|------|
| key | 页面内唯一标识，源和目标必须匹配 |
| transform | 是否启用动画 |
| transition-on-gesture | 手势返回时是否动画 |
| rect-tween-type | 动画轨迹（materialRectArc/linear） |

## 性能优化

### 列表性能

1. **使用 list 模式**：确保只渲染可见区域
   ```html
   <scroll-view type="list" scroll-y cache-extent="500">
   ```

2. **指定 cache-extent**：预渲染视口外区域，优化滚动体验

3. **使用 list-item 属性**：启用样式共享
   ```html
   <view wx:for="{{list}}" wx:key="id" list-item>
   ```

### swiper 性能

```html
<!-- 使用 cache-extent 预渲染相邻页 -->
<swiper cache-extent="1">
```

## 组件差异速查

| 组件 | WebView | Skyline | 备注 |
|------|---------|---------|------|
| scroll-view | 无 type | 必须 type | Skyline 增强 |
| text | space 属性 | overflow/max-lines | 不同特性 |
| image | 9种裁剪模式 | 5种缩放模式 | 裁剪模式仅 WebView |
| swiper | snap-to-edge | layout-type/indicator-type | 不同特性 |
| input | placeholder-class | worklet 回调 | 不同特性 |

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| 滚动 API | `skyline-scroll-api` | ScrollViewContext 接口 |
| 动画开发 | `skyline-worklet` | Worklet 动画系统 |
| 样式开发 | `skyline-wxss` | WXSS 支持情况 |
| 路由转场 | `skyline-route` | 页面转场动画 |


## References 目录结构

```
references/
├── scroll/                    # 滚动相关组件
│   ├── scroll-view.md         # scroll-view 完整文档
│   ├── nested-scroll.md       # 嵌套滚动模式
│   ├── list-grid-view.md      # list-view/grid-view
│   ├── sticky.md              # 吸顶布局
│   └── draggable-sheet.md     # 半屏可拖拽
├── layout/                    # 布局组件
│   └── swiper.md              # swiper 增强特性
├── form/                      # 表单组件
│   └── input.md               # input/textarea
├── media/                     # 媒体组件
│   ├── text.md                # text/span
│   └── image.md               # image
└── special/                   # 特殊组件
    ├── share-element.md       # 共享元素
    └── snapshot.md            # 截图组件
```
