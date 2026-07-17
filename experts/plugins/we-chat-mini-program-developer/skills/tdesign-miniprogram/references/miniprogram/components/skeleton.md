# Skeleton 骨架屏

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/ZeDxjNmz8z5T)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 骨架屏类型

基础骨架屏

**WXML** (`html`):
```html
<view wx:for="{{themeList}}" wx:for-item="themeItem" wx:key="index">
<view class="demo-section__desc">{{themeItem.title}}</view>
<view class="demo-section__content">
<t-skeleton theme="{{themeItem.value}}"></t-skeleton>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
themeList: [
{
title: '头像骨架屏',
value: 'avatar',
},
{
title: '图片骨架屏',
value: 'image',
},
{
title: '文本骨架屏',
value: 'text',
},
{
title: '段落骨架屏',
value: 'paragraph',
},
],
},
});

```

**CSS** (`css`):
```css
.demo-section__desc {
font-size: 28rpx;
color: var(--td-text-color-placeholder);
margin-top: 16rpx;
line-height: 44rpx;
}

.demo-section__content {
margin-top: 32rpx;
margin-bottom: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
}

```

单元格骨架屏

**WXML** (`html`):
```html
<view class="group">
<t-skeleton class="group-avatar" rowCol="{{rowColsAvater}}" loading></t-skeleton>
<t-skeleton class="group-content" rowCol="{{rowColsContent}}" loading></t-skeleton>
</view>

<view class="group">
<t-skeleton class="group-avatar" rowCol="{{rowColsImage}}" loading></t-skeleton>
<t-skeleton class="group-content" rowCol="{{rowColsContent}}" loading></t-skeleton>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
rowColsAvater: [{ size: '96rpx', type: 'circle' }],
rowColsImage: [{ size: '96rpx', type: 'rect' }],
rowColsContent: [{ width: '50%' }, { width: '100%' }],
},
});

```

**CSS** (`css`):
```css
.group {
display: flex;
align-items: center;
margin-top: 32rpx;
}

.group-avatar {
margin-right: 24rpx;
}

.group-content {
width: 566rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
}

```

宫格骨架屏

**WXML** (`html`):
```html
<view class="wrapper">
<t-skeleton rowCol="{{grid}}" loading></t-skeleton>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
grid: [
[
{ width: '96rpx', height: '96rpx', borderRadius: '12rpx' },
{ width: '96rpx', height: '96rpx', borderRadius: '12rpx' },
{ width: '96rpx', height: '96rpx', borderRadius: '12rpx' },
{ width: '96rpx', height: '96rpx', borderRadius: '12rpx' },
{ width: '96rpx', height: '96rpx', borderRadius: '12rpx' },
],
[
{ width: '96rpx', height: '32rpx', borderRadius: '6rpx' },
{ width: '96rpx', height: '32rpx', borderRadius: '6rpx' },
{ width: '96rpx', height: '32rpx', borderRadius: '6rpx' },
{ width: '96rpx', height: '32rpx', borderRadius: '6rpx' },
{ width: '96rpx', height: '32rpx', borderRadius: '6rpx' },
],
],
},
});

```

**CSS** (`css`):
```css
.wrapper {
--td-skeleton-row-spacing: 20rpx;
margin-top: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
}

```

图文组合骨架屏

**WXML** (`html`):
```html
<view class="group">
<t-skeleton rowCol="{{rowCol}}" loading></t-skeleton>
<t-skeleton rowCol="{{rowCol}}" loading></t-skeleton>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
rowCol: [{ size: '327rpx', borderRadius: '24rpx' }, 1, { width: '61%' }],
},
});

```

**CSS** (`css`):
```css
.group {
display: flex;
justify-content: space-between;
margin-top: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
}

```

### 组件动效

**WXML** (`html`):
```html
<view wx:for="{{animationList}}" wx:for-item="animationItem" wx:key="index">
<view class="demo-section__desc">{{animationItem.title}}</view>
<view class="demo-section__content">
<t-skeleton theme="paragraph" animation="{{animationItem.value}}" loading="{{animationItem.loading}}"></t-skeleton>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
animationList: [
{
title: '渐变加载效果',
value: 'gradient',
loading: true,
},
{
title: '闪烁加载效果',
value: 'flashed',
loading: true,
},
],
},
});

```

**CSS** (`css`):
```css
.demo-section__desc {
font-size: 28rpx;
color: var(--td-text-color-placeholder);
margin-top: 16rpx;
line-height: 44rpx;
}

.demo-section__content {
margin-top: 32rpx;
margin-bottom: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton"
}
}

```

## API

### SkeletonProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | String | none | 动画效果，有「渐变加载动画」和「闪烁加载动画」两种。值为 'none' 则表示没有动画。可选项：gradient/flashed/none | N |
| delay | Number | 0 | 延迟显示加载效果的时间，用于防止请求速度过快引起的加载闪烁，单位：毫秒 | N |
| loading | Boolean | true | 是否为加载状态，如果是则显示骨架图，如果不是则显示加载完成的内容 | N |
| row-col | Array | - | 高级设置，用于自定义行列数量、宽度高度、间距等。【示例一】，`[1, 1, 2]`表示输出三行骨架图，第一行一列，第二行一列，第三行两列。【示例二】，`[1, 1, { width: '100px' }]`表示自定义第三行的宽度为`100px`。【示例三】，`[1, 2, [{ width, height }, { width, height, marginLeft }]]`表示第三行有两列，且自定义宽度、高度、尺寸（圆形或方形使用）、间距、内容等。TS 类型：`SkeletonRowCol``type SkeletonRowCol = Array<Number \| SkeletonRowColObj \| Array<SkeletonRowColObj>>``interface SkeletonRowColObj { width?: string; size?: string;height?: string; marginRight?: string; marginLeft?: string; margin?: string; type?: 'rect' \| 'circle' \| 'text';}`。详细类型定义 | N |
| theme | String | text | 骨架图风格，有基础、头像组合等两大类。可选项：avatar/image/text/paragraph | N |

### SkeletonSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### SkeletonExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-col | 行样式类 |
| t-class-row | 列样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-skeleton-circle-border-radius | @skeleton-circle-border-radius | - |
| --td-skeleton-animation-flashed | rgba(90%, 90%, 90%, 0.3) | - |
| --td-skeleton-animation-gradient | rgba(0, 0, 0, 4%) | - |
| --td-skeleton-bg-color | @bg-color-secondarycontainer | - |
| --td-skeleton-circle-height | 96rpx | - |
| --td-skeleton-rect-border-radius | @radius-default | - |
| --td-skeleton-rect-height | 32rpx | - |
| --td-skeleton-row-spacing | @spacer-2 | - |
| --td-skeleton-text-border-radius | @radius-small | - |
| --td-skeleton-text-height | 32rpx | - |