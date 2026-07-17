# Loading 加载

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/Bx1fqOm9805P)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 纯icon

**WXML** (`html`):
```html
<view class="loading-container-flex">
<t-loading wx:if="{{!skylineRender}}" theme="circular" size="40rpx" class="wrapper" />
<t-loading theme="spinner" size="40rpx" class="wrapper" />
<t-loading theme="dots" size="80rpx" class="wrapper" />
<t-loading theme="custom" class="wrapper">
<t-image
slot="indicator"
style="width: 100%; height: 100%"
src="https://tdesign.gtimg.com/mobile/demos/logo2.png"
/>
</t-loading>
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
});

```

**CSS** (`css`):
```css
.loading-container-flex {
display: flex;
align-items: center;
}

.wrapper {
margin-right: 40px;
}

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading",
"t-image": "tdesign-miniprogram/image/image"
}
}

```

### icon加文字横向

**WXML** (`html`):
```html
<view class="loading-container-flex">
<t-loading wx:if="{{!skylineRender}}" theme="circular" size="40rpx" text="加载中..." class="wrapper" />
<t-loading theme="spinner" size="40rpx" text="加载中..." inheritColor class="wrapper" />
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
});

```

**CSS** (`css`):
```css
.loading-container-flex {
display: flex;
align-items: center;
color: #000;
}

.wrapper {
display: flex;
margin-right: 64px;
}

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

### icon加文字竖向

**WXML** (`html`):
```html
<div class="box">
<t-loading
theme="{{ skylineRender ? 'spinner' : 'circular'}}"
size="40rpx"
text="加载中"
layout="vertical"
class="wrapper"
/>
<t-loading theme="spinner" size="40rpx" text="加载中" layout="vertical" class="wrapper" />
</div>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
});

```

**CSS** (`css`):
```css
.box {
display: flex;
}

.wrapper {
margin-right: 64px;
}

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

### 纯文字

**WXML** (`html`):
```html
<t-loading indicator="{{false}}" text="加载中..."></t-loading>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

### 加载失败

### DEMO(🚧建设中）...

### 状态

### DEMO(🚧建设中）...

### 加载速度

**WXML** (`html`):
```html
<t-loading
theme="{{ skylineRender ? 'spinner' : 'circular'}}"
size="52rpx"
text="加载中..."
t-class-text="text-l"
duration="{{2000 - duration}}"
></t-loading>
<view class="slider-container">
<t-slider
class="slider-class"
value="{{duration}}"
min="{{100}}"
max="{{1500}}"
label
bind:change="durationChange"
></t-slider>
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],

data: {
duration: 800,
},
methods: {
durationChange(e) {
this.setData({ duration: e.detail.value });
},
},
});

```

**CSS** (`css`):
```css
.slider-container {
display: flex;
align-items: center;
width: 718rpx;
}

.slider-class {
flex-grow: 1;
}

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading",
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

### 规格

**WXML** (`html`):
```html
<view class="loading-size-demo">
<t-loading theme="{{ skylineRender ? 'spinner' : 'circular'}}" size="64rpx" text="加载中..." class="large" />

<view class="demo-desc">中尺寸</view>

<t-loading theme="{{ skylineRender ? 'spinner' : 'circular'}}" size="56rpx" text="加载中..." class="medium" />

<view class="demo-desc">小尺寸</view>

<t-loading theme="{{ skylineRender ? 'spinner' : 'circular'}}" size="48rpx" text="加载中..." />
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
});

```

**CSS** (`css`):
```css
.large {
--td-loading-text-font: var(--td-font-body-large);
}

.medium {
--td-loading-text-font: var(--td-font-body-medium);
}

.loading-size-demo .demo-desc {
margin: 48rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"components": true,
"usingComponents": {
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

## API

### LoadingProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| delay | Number | 0 | 延迟显示加载效果的时间，用于防止请求速度过快引起的加载闪烁，单位：毫秒 | N |
| duration | Number | 800 | 加载动画执行完成一次的时间，单位：毫秒 | N |
| fullscreen | Boolean | false | `1.8.5`。是否显示为全屏加载 | N |
| indicator | Boolean | true | 加载指示符，值为 true 显示默认指示符，值为 false 则不显示，也可以自定义指示符 | N |
| inherit-color | Boolean | false | 是否继承父元素颜色 | N |
| layout | String | horizontal | 对齐方式。可选项：horizontal/vertical | N |
| loading | Boolean | true | 是否处于加载状态 | N |
| pause | Boolean | false | 是否暂停动画 | N |
| progress | Number | - | 加载进度 | N |
| reverse | Boolean | - | 加载动画是否反向 | N |
| size | String | '20px' | 尺寸，示例：20px | N |
| text | String | - | 加载提示文案 | N |
| theme | String | circular | 加载组件类型。可选项：circular/spinner/dots | N |

### LoadingSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`text`插槽 |
| indicator | 自定义`indicator`显示内容 |
| text | 自定义`text`显示内容 |

### LoadingExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-indicator | 指示符样式类 |
| t-class-text | 文本样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-loading-color | @brand-color | - |
| --td-loading-full-bg-color | rgba(255, 255, 255, 0.6) | - |
| --td-loading-text-color | @text-color-primary | - |
| --td-loading-text-font | @font-body-small | - |
| --td-loading-z-index | 3500 | - |