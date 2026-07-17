# Skyline 组件支持情况

## 通用特性支持

| 特性 | 支持情况 |
|------|----------|
| 无障碍访问 | 支持 aria-role / label / hidden / disabled |
| DarkMode | 支持 |
| 原生组件同层渲染 | 均支持 |
| WeUI v2 | 支持 |

## 组件支持总表

### 完全支持的组件

| 组件 | 备注 |
|------|------|
| view / cover-view | 涉及文本需用 text 组件 |
| button | - |
| scroll-view | 需显式指定 `type="list"`，支持大量新特性 |
| swiper / swiper-item | 增强大量特性 |
| input / textarea | 光标选区、菜单略有不同 |
| navigator | 只能嵌套 text 组件或文本节点 |
| map | 开发者工具暂不支持，使用真机预览 |
| canvas | 开发者工具暂不支持，使用真机预览 |
| radio / radio-group | - |
| label | - |
| checkbox / checkbox-group | - |
| picker | - |
| camera | 开发者工具暂不支持，使用真机预览 |
| root-portal | - |
| form | - |
| ad | - |
| official-account | - |
| live-player / live-pusher | - |
| voip-room | - |
| icon | - |
| slider | - |
| switch | - |
| share-element | 与 WebView 使用方式有异，特性有所增强 |
| page-container | - |

### 基本支持的组件

| 组件 | 支持情况 | 差异说明 |
|------|----------|----------|
| text | 基本支持 | 内联文本只能用 text 组件；可通过 span 组件与 text/image 内联 |
| image / cover-image | 基本支持 | SVG 支持已完善；部分低频 mode 未支持 |
| video | 基本支持 | 全屏已支持，投屏暂未支持 |
| picker-view | 基本支持 | indicator-class/mask-style 属性暂未支持 |
| rich-text | 完全支持 | 渲染结果可能略有不同；mode=web 时完全对齐 webview |
| page-meta | 基本支持 | 与全局滚动相关的属性不支持 |

### 暂不支持的组件

| 组件 | 状态 | 替代方案 |
|------|------|----------|
| web-view | 暂不考虑 | 该页面配置 `"renderer": "webview"` |
| movable-area / movable-view | 暂不考虑 | 手势 + worklet 动画方案 |
| editor | 暂不考虑 | - |
| progress | 暂不考虑 | - |
| match-media | 待考虑 | - |
| keyboard-accessary | 待考虑 | input 的 worklet:onkeyboardheightchange 回调 |
| navigation-bar | 不考虑 | Skyline 只能用自定义导航 |
| xr-frame | 暂未支持 | - |

## Skyline 新增组件

### 布局组件

| 组件 | 说明 |
|------|------|
| span | 支持内联文本和 image/navigator 的混排 |
| sticky-header | 吸顶布局容器 |
| sticky-section | 吸顶布局区域 |
| list-view | 列表布局容器，作为 scroll-view type="list" 的直接子节点 |
| grid-view | 网格布局 / 瀑布流布局容器 |
| nested-scroll-header | 嵌套滚动头部 |
| nested-scroll-body | 嵌套滚动主体 |
| draggable-sheet | 半屏可拖拽组件 |

### 截图组件

| 组件 | 说明 |
|------|------|
| snapshot | 截图组件，可将 WXML 内容导出为图片 |

### 手势组件

| 组件 | 触发条件 |
|------|----------|
| tap-gesture-handler | 点击 |
| double-tap-gesture-handler | 双击 |
| long-press-gesture-handler | 长按 |
| pan-gesture-handler | 拖动（横向/纵向） |
| scale-gesture-handler | 多指缩放 |
| horizontal-drag-gesture-handler | 横向滑动 |
| vertical-drag-gesture-handler | 纵向滑动 |
| force-press-gesture-handler | iPhone 重按 |

## 组件使用注意事项

### text 组件

```html
<!-- ✅ 正确：纯文本用 text 包裹 -->
<view>
  <text>这是文本内容</text>
</view>

<!-- ❌ 错误：直接放文本 -->
<view>这是文本内容</view>

<!-- ✅ 文本省略：必须用 text 组件 -->
<text style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
  很长的文本...
</text>

<!-- ✅ 多行省略：使用 max-lines -->
<text max-lines="2" style="overflow: hidden;">
  很长的多行文本...
</text>
```

### scroll-view 组件

```html
<!-- ✅ 正确：指定 type="list" -->
<scroll-view type="list" scroll-y style="height: 100%;">
  <view wx:for="{{list}}" wx:key="id">{{item}}</view>
</scroll-view>

<!-- 横向滚动需配合 flex 布局 -->
<scroll-view type="list" scroll-x enable-flex style="display: flex;">
  <view wx:for="{{list}}" wx:key="id" style="flex-shrink: 0;">{{item}}</view>
</scroll-view>
```

### span 组件（内联混排）

```html
<!-- 文本与图片内联 -->
<span>
  <text>前置文本</text>
  <image src="/images/icon.png" style="width: 20px; height: 20px;" />
  <text>后置文本</text>
</span>
```

### navigator 组件

```html
<!-- ✅ 正确：只嵌套 text -->
<navigator url="/pages/detail/detail">
  <text>点击跳转</text>
</navigator>

<!-- ❌ 错误：嵌套其他组件 -->
<navigator url="/pages/detail/detail">
  <view>不能这样用</view>
</navigator>
```

## 原生组件调试

以下组件在开发者工具暂不支持调试，请使用真机预览：

- map
- canvas
- video
- camera

```javascript
// 判断是否开发者工具环境
const systemInfo = wx.getSystemInfoSync()
if (systemInfo.platform === 'devtools') {
  console.log('原生组件请使用真机预览')
}
```
