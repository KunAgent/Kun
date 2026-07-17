# Guide 引导

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/P7xJCMmR8H5k)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 基础按钮

**WXML** (`html`):
```html
<view>
<view class="main-title">
<view class="title-major">用户引导标题</view>
<view class="title-sub"> 按钮用于开启一个闭环的操作任务，如“删除”对象、“购买”商品等。 </view>
</view>
<view class="field label-field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="action">
<t-button block theme="light" size="large">重置</t-button>
<t-button block theme="primary" size="large">确定</t-button>
</view>
</view>

<t-guide current="{{current}}" steps="{{steps}}" bind:skip="close" bind:finish="close">
<view slot="body-2" class="slot-body">slot展示 用户引导的说明文案</view>
</t-guide>

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: -1,
steps: [],
},
lifetimes: {
attached() {
this.setData({
current: 0,
steps: [
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.main-title')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'center',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.label-field')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'bottom',
highlightPadding: 0,
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.action')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
// body: '用户引导的说明文案',
placement: 'bottom-right',
},
],
});
},
},
methods: {
close() {
this.triggerEvent('close');
},
},
});

```

**CSS** (`css`):
```css
.main-title {
margin: 32rpx;
display: inline-block;
}

.title-major {
font-size: 48rpx;
font-weight: 600;
line-height: 72rpx;
}

.title-sub {
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
margin-top: 8rpx;
}

.action {
margin: 64rpx;
display: grid;
grid-template-columns: repeat(2, 1fr);
gap: 64rpx;
}

.slot-body {
margin-top: 8rpx;
text-align: left;
color: var(--td-text-color-secondary);
font-size: 28rpx;
font-weight: 400;
line-height: 44rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide",
"t-input": "tdesign-miniprogram/input/input",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 不带遮罩的引导

**WXML** (`html`):
```html
<view>
<view class="main-title">
<view class="title-major">用户引导标题</view>
<view class="title-sub"> 按钮用于开启一个闭环的操作任务，如“删除”对象、“购买”商品等。 </view>
</view>
<view class="field label-field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="action">
<t-button block theme="light" size="large">重置</t-button>
<t-button block theme="primary" size="large">确定</t-button>
</view>
</view>

<t-guide current="{{current}}" steps="{{steps}}" show-overlay="{{false}}" bind:skip="close" bind:finish="close" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: -1,
steps: [],
},
lifetimes: {
attached() {
this.setData({
current: 0,
steps: [
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.main-title')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'center',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.label-field')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'bottom',
highlightPadding: 0,
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.action')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'top-right',
},
],
});
},
},
methods: {
close() {
this.triggerEvent('close');
},
},
});

```

**CSS** (`css`):
```css
.main-title {
margin: 32rpx;
display: inline-block;
}

.title-major {
font-size: 48rpx;
font-weight: 600;
line-height: 72rpx;
}

.title-sub {
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
margin-top: 8rpx;
}

.action {
margin: 64rpx;
display: grid;
grid-template-columns: repeat(2, 1fr);
gap: 64rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide",
"t-input": "tdesign-miniprogram/input/input",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 弹窗形式的引导

**WXML** (`html`):
```html
<view>
<view class="main-title">
<view class="title-major">用户引导标题</view>
<view class="title-sub"> 按钮用于开启一个闭环的操作任务，如“删除”对象、“购买”商品等。 </view>
</view>
<view class="field label-field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="action">
<t-button block theme="light" size="large">重置</t-button>
<t-button block theme="primary" size="large">确定</t-button>
</view>
</view>

<t-guide current="{{current}}" steps="{{steps}}" mode="dialog" bind:skip="close" bind:finish="close">
<view slot="body-0" class="slot-body">
<p>用户引导的说明文案 0</p>
<t-image
class="guide-demo-image"
src="https://tdesign.gtimg.com/demo/demo-image-1.png"
mode="scaleToFill"
width="100%"
></t-image>
</view>
<view slot="body-1" class="slot-body">
<p>用户引导的说明文案 1</p>
<t-image
class="guide-demo-image"
src="https://tdesign.gtimg.com/demo/demo-image-1.png"
mode="scaleToFill"
width="100%"
></t-image>
</view>
<view slot="body-2" class="slot-body">
<p>用户引导的说明文案 2</p>
<t-image
class="guide-demo-image"
src="https://tdesign.gtimg.com/demo/demo-image-1.png"
mode="scaleToFill"
width="100%"
></t-image>
</view>
</t-guide>

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: -1,
steps: [],
},
lifetimes: {
attached() {
this.setData({
current: 0,
steps: [
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.main-title')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
placement: 'center',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.label-field')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
placement: 'bottom',
highlightPadding: 0,
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.action')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
placement: 'bottom-right',
},
],
});
},
},
methods: {
close() {
this.triggerEvent('close');
},
},
});

```

**CSS** (`css`):
```css
.main-title {
margin: 32rpx;
display: inline-block;
}

.title-major {
font-size: 48rpx;
font-weight: 600;
line-height: 72rpx;
}

.title-sub {
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
margin-top: 8rpx;
}

.action {
margin: 64r px;
display: grid;
grid-template-columns: repeat(2, 1fr);
gap: 64rpx;
}

.slot-body {
margin-top: 8rpx;
text-align: center;
color: var(--td-text-color-secondary);
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
}

.slot-body .guide-demo-image {
margin-top: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide",
"t-input": "tdesign-miniprogram/input/input",
"t-button": "tdesign-miniprogram/button/button",
"t-image": "tdesign-miniprogram/image/image"
}
}

```

#### 气泡与弹窗混合的引导

**WXML** (`html`):
```html
<view>
<view class="main-title">
<view class="title-major">用户引导标题</view>
<view class="title-sub"> 按钮用于开启一个闭环的操作任务，如“删除”对象、“购买”商品等。 </view>
</view>
<view class="field label-field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="action">
<t-button block theme="light" size="large">重置</t-button>
<t-button block theme="primary" size="large">确定</t-button>
</view>
</view>

<t-guide current="{{current}}" steps="{{steps}}" bind:skip="close" bind:finish="close">
<view slot="body-1" class="slot-body">
<p>用户引导的说明文案 1</p>
<t-image
class="guide-demo-image"
src="https://tdesign.gtimg.com/demo/demo-image-1.png"
mode="scaleToFill"
width="100%"
></t-image>
</view>
</t-guide>

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: -1,
steps: [],
},
lifetimes: {
attached() {
this.setData({
current: 0,
steps: [
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.main-title')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'center',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.label-field')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
placement: 'bottom',
mode: 'dialog',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.action')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
title: '用户引导标题',
body: '用户引导的说明文案',
placement: 'bottom-right',
},
],
});
},
},
methods: {
close() {
this.triggerEvent('close');
},
},
});

```

**CSS** (`css`):
```css
.main-title {
margin: 32rpx;
display: inline-block;
}

.title-major {
font-size: 48rpx;
font-weight: 600;
line-height: 72rpx;
}

.title-sub {
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
margin-top: 8rpx;
}

.action {
margin: 63rpx;
display: grid;
grid-template-columns: repeat(2, 1fr);
gap: 63rpx;
}

.slot-body {
margin-top: 8rpx;
text-align: center;
color: var(--td-text-color-secondary);
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
}

.slot-body .guide-demo-image {
margin-top: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide",
"t-input": "tdesign-miniprogram/input/input",
"t-button": "tdesign-miniprogram/button/button",
"t-image": "tdesign-miniprogram/image/image"
}
}

```

#### 自定义气泡

**WXML** (`html`):
```html
<view>
<view class="main-title">
<view class="title-major">用户引导标题</view>
<view class="title-sub"> 按钮用于开启一个闭环的操作任务，如“删除”对象、“购买”商品等。 </view>
</view>
<view class="field label-field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="field">
<t-input label="标签文字" layout="vertical" placeholder="请输入文字"></t-input>
</view>
<view class="action">
<t-button block theme="light" size="large">重置</t-button>
<t-button block theme="primary" size="large">确定</t-button>
</view>
</view>

<t-guide current="{{current}}" steps="{{steps}}" bind:skip="close" bind:finish="close">
<view slot="content-0" class="content">
<t-icon name="arrow-up" size="64rpx" color="#fff" class="icon" />
<p class="text">1、自定义的图形或说明文案，用来解释或指导该功能使用。</p>
<view class="footer">
<t-button
wx:if="{{current < steps.length - 1}}"
theme="light"
content="跳过"
size="extra-small"
bindtap="skip"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="light"
content="返回"
size="extra-small"
bindtap="back"
></t-button>
<t-button
wx:if="{{current < steps.length - 1}}"
theme="primary"
content="下一步"
size="extra-small"
bindtap="next"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="primary"
content="完成"
size="extra-small"
bindtap="finish"
></t-button>
</view>
</view>
<view slot="content-1" class="content">
<t-icon name="arrow-up" size="64rpx" color="#fff" class="icon" />
<p class="text">2、自定义的图形或说明文案，用来解释或指导该功能使用。</p>
<view class="footer">
<t-button
wx:if="{{current < steps.length - 1}}"
theme="light"
content="跳过"
size="extra-small"
bindtap="skip"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="light"
content="返回"
size="extra-small"
bindtap="back"
></t-button>
<t-button
wx:if="{{current < steps.length - 1}}"
theme="primary"
content="下一步"
size="extra-small"
bindtap="next"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="primary"
content="完成"
size="extra-small"
bindtap="finish"
></t-button>
</view>
</view>
<view slot="content-2" class="content">
<t-icon name="arrow-up" size="64rpx" color="#fff" class="icon" />
<p class="text">3、自定义的图形或说明文案，用来解释或指导该功能使用。</p>
<view class="footer">
<t-button
wx:if="{{current < steps.length - 1}}"
theme="light"
content="跳过"
size="extra-small"
bindtap="skip"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="light"
content="返回"
size="extra-small"
bindtap="back"
></t-button>
<t-button
wx:if="{{current < steps.length - 1}}"
theme="primary"
content="下一步"
size="extra-small"
bindtap="next"
class="guide-demo-button"
></t-button>
<t-button
wx:else
class="guide-demo-button"
theme="primary"
content="完成"
size="extra-small"
bindtap="finish"
></t-button>
</view>
</view>
</t-guide>

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: -1,
steps: [],
},
lifetimes: {
attached() {
this.setData({
current: 0,
steps: [
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.main-title')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
placement: 'center',
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.label-field')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
placement: 'bottom',
highlightPadding: 0,
},
{
element: () =>
new Promise((resolve) =>
this.createSelectorQuery()
.select('.action')
.boundingClientRect((rect) => resolve(rect))
.exec(),
),
placement: 'bottom-right',
},
],
});
},
},
methods: {
close() {
this.triggerEvent('close');
},
skip() {
this.setData({ current: -1 });
this.close();
},
back() {
this.setData({ current: 0 });
},
next() {
this.setData({ current: this.data.current + 1 });
},
finish() {
this.setData({ current: -1 });
this.close();
},
},
});

```

**CSS** (`css`):
```css
.main-title {
margin: 32rpx;
display: inline-block;
}

.title-major {
font-size: 48rpx;
font-weight: 600;
line-height: 72rpx;
}

.title-sub {
font-size: 32rpx;
font-weight: 400;
line-height: 48rpx;
margin-top: 8rpx;
}

.action {
margin: 64rpx;
display: grid;
grid-template-columns: repeat(2, 1fr);
gap: 64rpx;
}

.content {
width: 480rpx;
}

.content .icon {
font-weight: 700;
width: 64rpx;
}

.content .text {
margin-top: 32rpx;
color: #fff;
font-size: 32rpx;
font-weight: 600;
text-align: left;
line-height: 48rpx;
}

.content .footer {
text-align: right;
margin-top: 32rpx;
}

.content .footer .guide-demo-button + .guide-demo-button {
margin-left: 24rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-guide": "tdesign-miniprogram/guide/guide",
"t-input": "tdesign-miniprogram/input/input",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

## API

### GuideProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| back-button-props | Object | - | 透传 返回按钮 的全部属性，示例：`{ content: '返回', theme: 'default' }`。TS 类型：`ButtonProps` | N |
| counter | String / Function | - | 用于自定义渲染计数部分。TS 类型：`string \| ((params: { total: number; current: number }) => string)` | N |
| current | Number | - | 当前步骤，即整个引导的进度。-1 则不展示，用于需要中断展示的场景 | N |
| default-current | Number | undefined | 当前步骤，即整个引导的进度。-1 则不展示，用于需要中断展示的场景。非受控属性 | N |
| finish-button-props | Object | - | 透传 完成按钮 的全部属性，示例：`{ content: '完成', theme: 'primary' }`。TS 类型：`ButtonProps` | N |
| hide-back | Boolean | false | 是否隐藏返回按钮 | N |
| hide-counter | Boolean | false | 是否隐藏计数 | N |
| hide-skip | Boolean | false | 是否隐藏跳过按钮 | N |
| highlight-padding | Number | 16 | 高亮框的内边距，单位rpx | N |
| mode | String | popover | 引导框的类型。可选项：popover/dialog | N |
| next-button-props | Object | - | 透传 下一步按钮 的全部属性，示例：{ content: '下一步', theme: 'primary' }。TS 类型：`ButtonProps`，Button API Documents。详细类型定义 | N |
| show-overlay | Boolean | true | 是否出现遮罩层 | N |
| skip-button-props | Object | - | 透传 跳过按钮 的全部属性，{ content: '跳过', theme: 'default' }。TS 类型：`ButtonProps` | N |
| steps | Array | - | 用于定义每个步骤的内容，包括高亮的节点、相对位置和具体的文案内容等。TS 类型：`Array<GuideStep>` | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| z-index | Number | 999999 | 提示框的层级 | N |

### GuideEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| back | `(detail: { current: number, total: number  })` | 点击返回按钮时触发 |
| change | `(current: number, context?: {  total: number })` | 当前步骤发生变化时触发 |
| finish | `(detail: { current: number, total: number  })` | 点击完成按钮时触发 |
| next-step-click | `(detail: { next: number, current: number, total: number  })` | 点击下一步时触发 |
| skip | `(detail: { current: number, total: number  })` | 点击跳过按钮时触发 |

### GuideExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-back | 返回按钮样式类 |
| t-class-body | 高亮框提示内容主体样式类 |
| t-class-finish | 结束按钮样式类 |
| t-class-footer | 高亮框底部操作区域样式类 |
| t-class-next | 下一步按钮样式类 |
| t-class-popover | 引导框样式类 |
| t-class-reference | 高亮框样式类 |
| t-class-skip | 跳过按钮样式类 |
| t-class-title | 高亮框提示内容标题样式类 |
| t-class-tooltip | 高亮框提示内容区域样式类 |

### GuideStep

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| back-button-props | Object | - | 用于自定义当前引导框的返回按钮的内容。TS 类型：`ButtonProps` | N |
| body | String | - | 当前步骤提示框的内容，支持插槽：slot="body-{{index}}" (1、当要显示body-{{index}}插槽时，请将body设置为空；2、当要显示content-{{index}}插槽完全自定义内容时，请将body和title都设置为空) | N |
| element | Function | - | 必需。高亮的节点。示例：`() => new Promise((resolve) => this.createSelectorQuery().select('#tdesign').boundingClientRect((rect) => resolve(rect)).exec())`。TS 类型：`StepElement``type StepElement = () => Promise<WechatMiniprogram.BoundingClientRectCallbackResult>`。详细类型定义 | Y |
| finish-button-props | Object | - | 透传 完成 的全部属性，示例：`{ content: '完成', theme: 'primary' }`。TS 类型：`ButtonProps` | N |
| highlight-padding | Number | - | 高亮框的内边距，单位rpx | N |
| mode | String | - | 引导框的类型。可选项：popover/dialog | N |
| next-button-props | Object | - | 用于自定义当前引导框的下一步按钮的内容。TS 类型：`ButtonProps` | N |
| offset | Array | - | 相对于 placement 的偏移量[left, top]，默认单位rpx，示例：[-10, 20] 或 ['10px', '8px'] 或 ['20rpx', '16rpx'] (仅当`mode`为`popover`时生效)。TS 类型：`Array<string \| number>` | N |
| placement | String | 'top' | 引导框相对于高亮元素出现的位置，(仅当`mode`为`popover`时生效)。TS 类型：`StepPopoverPlacement ``type StepPopoverPlacement = 'top'\|'left'\|'right'\|'bottom'\|'top-left'\|'top-right'\|'bottom-left'\|'bottom-right'\|'left-top'\|'left-bottom'\|'right-top'\|'right-bottom'\|'center'`。详细类型定义 | N |
| show-overlay | Boolean | true | 是否出现遮罩层 | N |
| skip-button-props | Object | - | 用于自定义当前步骤引导框的跳过按钮的内容。TS 类型：`ButtonProps` | N |
| title | String | - | 当前步骤的标题内容，支持插槽：slot="title-{{index}}" (1、当要显示body-{{index}}插槽时，请将title设置为空；2、当要显示content-{{index}}插槽完全自定义内容时，请将body和title都设置为空) | N |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-guide-body-color | @text-color-secondary | - |
| --td-guide-dialog-body-font | @font-body-large | - |
| --td-guide-dialog-body-margin-top | 16rpx | - |
| --td-guide-dialog-body-text-align | center | - |
| --td-guide-dialog-border-radius | @radius-extraLarge | - |
| --td-guide-dialog-footer-button-padding | 0 @spacer-3 | - |
| --td-guide-dialog-padding | @spacer-3 0 | - |
| --td-guide-dialog-title-font | @font-title-large | - |
| --td-guide-dialog-title-text-align | center | - |
| --td-guide-dialog-width | 622rpx | - |
| --td-guide-footer-button-space | @spacer-1 | - |
| --td-guide-footer-margin-top | @spacer-3 | - |
| --td-guide-footer-text-align | right | - |
| --td-guide-popover-bg-color | @bg-color-container | - |
| --td-guide-popover-body-font | @font-body-medium | - |
| --td-guide-popover-body-margin-top | 8rpx | - |
| --td-guide-popover-body-text-align | left | - |
| --td-guide-popover-border | 2rpx solid @component-border | - |
| --td-guide-popover-border-radius | @radius-large | - |
| --td-guide-popover-max-width | 540rpx | - |
| --td-guide-popover-min-width | 480rpx | - |
| --td-guide-popover-padding | @spacer-2 | - |
| --td-guide-popover-shadow | @shadow-3 | - |
| --td-guide-popover-title-font | @font-title-medium | - |
| --td-guide-popover-title-text-align | left | - |
| --td-guide-reference-border | 4rpx solid @brand-color | - |
| --td-guide-reference-border-radius | @radius-default | - |
| --td-guide-reference-mask-color | @font-gray-2 | - |
| --td-guide-title-color | @text-color-primary | - |