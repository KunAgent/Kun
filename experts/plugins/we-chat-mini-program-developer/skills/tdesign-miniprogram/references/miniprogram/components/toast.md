# Toast 轻提示

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/RA0opOm78g53)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础提示

**WXML** (`html`):
```html
<t-toast id="t-toast" />
<view class="box">
<t-button size="large" variant="outline" theme="primary" bind:tap="showText" block>纯文本</t-button>
<t-button size="large" variant="outline" theme="primary" bind:tap="showMultiText" block>多行文字</t-button>
<t-button size="large" variant="outline" theme="primary" bind:tap="showHorizontalText" block>带横向图标</t-button>
<t-button size="large" variant="outline" theme="primary" bind:tap="showVerticalText" block>带竖向图标</t-button>
<t-button wx:if="{{!skylineRender}}" size="large" variant="outline" theme="primary" bind:tap="showLoading" block
>加载状态</t-button
>
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

import Toast from 'tdesign-miniprogram/toast';

Component({
behaviors: [SkylineBehavior],

methods: {
showText() {
Toast({
context: this,
selector: '#t-toast',
message: '轻提示文字内容',
});
},

showMultiText() {
Toast({
context: this,
selector: '#t-toast',
message: '最多一行展示十个汉字宽度限制最多不超过三行文字',
});
},

showHorizontalText() {
Toast({
context: this,
selector: '#t-toast',
message: '带横向图标',
icon: 'check-circle',
});
},

showVerticalText() {
Toast({
context: this,
selector: '#t-toast',
message: '带竖向图标',
icon: 'check-circle',
direction: 'column',
});
},

showLoading() {
Toast({
context: this,
selector: '#t-toast',
message: '加载中...',
theme: 'loading',
direction: 'column',
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 组件状态

**WXML** (`html`):
```html
<t-toast id="t-toast" />

<view class="box">
<t-button theme="primary" size="large" variant="outline" bind:tap="showSuccessToast" block>成功提示</t-button>
<t-button theme="primary" size="large" variant="outline" bind:tap="showWarningToast" block>警告提示</t-button>
<t-button theme="primary" size="large" variant="outline" bind:tap="showErrorToast" block>错误提示</t-button>
</view>

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';

Component({
methods: {
showSuccessToast() {
Toast({
context: this,
selector: '#t-toast',
message: '成功文案',
theme: 'success',
direction: 'column',
});
},

showWarningToast() {
Toast({
context: this,
selector: '#t-toast',
message: '警告文案',
theme: 'warning',
direction: 'column',
});
},

showErrorToast() {
Toast({
context: this,
selector: '#t-toast',
message: '错误文案',
theme: 'error',
direction: 'column',
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 显示遮罩

**WXML** (`html`):
```html
<t-toast id="t-toast" />

<view class="box">
<t-button theme="primary" size="large" variant="outline" bind:tap="handleToast" block>禁止滑动和点击</t-button>
</view>

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';

Component({
methods: {
handleToast() {
Toast({
context: this,
selector: '#t-toast',
message: '禁止滑动和点击',
direction: 'column',
duration: 3000,
preventScrollThrough: true,
icon: 'poweroff',
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

### 手动关闭

**WXML** (`html`):
```html
<t-toast id="t-toast" />

<view class="box">
<view class="toast-example">
<t-button theme="primary" size="large" variant="outline" bind:tap="handleShow">显示提示</t-button>
<t-button theme="primary" size="large" variant="outline" bind:tap="handleHide">关闭提示</t-button>
</view>
</view>

```

**JS** (`javascript`):
```javascript
import Toast, { hideToast } from 'tdesign-miniprogram/toast';

Component({
methods: {
handleShow() {
Toast({
context: this,
selector: '#t-toast',
duration: -1,
message: '轻提示文字内容',
});
},
handleHide() {
hideToast({
context: this,
selector: '#t-toast',
});
},
},
});

```

**CSS** (`css`):
```css
.toast-example {
text-align: center;
display: flex;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

## API

### ToastProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| direction | String | row | 图标排列方式。可选项：row/column | N |
| duration | Number | 2000 | 弹窗显示毫秒数 | N |
| icon | String / Object / Slot | - | 自定义图标。传入对象则透传至 Icon 组件。通用类型定义 | N |
| message | String / Slot | - | 弹窗显示文字。通用类型定义 | N |
| overlay-props | Object | - | 遮罩层属性，透传至 Overlay。TS 类型：`OverlayProps `，Overlay API Documents。详细类型定义 | N |
| placement | String | middle | 弹窗展示位置。可选项： top/middle/bottom | N |
| prevent-scroll-through | Boolean | false | 防止滚动穿透，即不允许点击和滚动 | N |
| show-overlay | Boolean | false | 是否显示遮罩层 | N |
| theme | String | - | 提示类型。可选项：loading/success/warning/error | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |

### ToastEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| close | - | 轻提示隐藏的时候触发 |
| destroy | - | 轻提示销毁的时候触发 |

### ToastExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-toast-bg-color | @mask-active | - |
| --td-toast-color | @text-color-anti | - |
| --td-toast-column-icon-size | 64rpx | - |
| --td-toast-max-width | 370rpx | - |
| --td-toast-radius | @radius-default | - |
| --td-toast-row-icon-size | 48rpx | - |