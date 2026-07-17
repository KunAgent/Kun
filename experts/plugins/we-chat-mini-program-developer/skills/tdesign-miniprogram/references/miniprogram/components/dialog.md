# Dialog 对话框

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/WKslWMmK8g5L)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

按钮的样式，默认使用 `variant = text`，如果任意按钮改变了 `variant`，那么全部按钮都改变成这个。

#### 反馈类对话框

**WXML** (`html`):
```html
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showTextAndTitle"
bind:tap="showDialog"
block
>
反馈类-带标题
</t-button>
<t-dialog
visible="{{showTextAndTitle}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ confirmBtn }}"
bind:confirm="closeDialog"
/>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showContentOnly"
bind:tap="showDialog"
block
>
反馈类-无标题
</t-button>
<t-dialog
visible="{{showContentOnly}}"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ confirmBtn }}"
bind:confirm="closeDialog"
/>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showTitleOnly"
bind:tap="showDialog"
block
>
反馈类-纯标题
</t-button>
<t-dialog visible="{{showTitleOnly}}" title="对话框标题" confirm-btn="{{ confirmBtn }}" bind:confirm="closeDialog" />

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showMultiTextAndTitle"
bind:tap="showDialog"
block
>
反馈类-内容超长
</t-button>
<t-dialog
visible="{{showMultiTextAndTitle}}"
title="对话框标题"
confirm-btn="{{ confirmBtn }}"
bind:confirm="closeDialog"
>
<!-- 适配skyline，增加type="list" -->
<scroll-view slot="content" type="list" scroll-y class="long-content">
<view class="content-container"
>这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案，这里是辅助内容文案
</view>
</scroll-view>
</t-dialog>

```

**JS** (`javascript`):
```javascript
Component({
data: {
confirmBtn: { content: '知道了', variant: 'base' },
dialogKey: '',
showText: false,
showMultiText: false,
showTextAndTitle: false,
showTitleOnly: false,
showMultiTextAndTitle: false,
},
methods: {
showDialog(e) {
const { key } = e.currentTarget.dataset;
this.setData({ [key]: true, dialogKey: key });
},

closeDialog() {
const { dialogKey } = this.data;
this.setData({ [dialogKey]: false });
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
margin-bottom: 32rpx;
}

.long-content {
height: 576rpx;
margin-top: 16rpx;
font-size: 32rpx;
color: #888;
}

.long-content .content-container {
white-space: pre-line;
}

.long-content ::-webkit-scrollbar {
display: none;
width: 0;
height: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

> 使用这种方式，对话框的 `visible` 是受控的，需要手动设置额 `visible` 为 `false` 才会关闭对话框。

#### 确认类对话框

**WXML** (`html`):
```html
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showConfirm"
bind:tap="showDialog"
block
>
确认类-带标题
</t-button>
<t-dialog
visible="{{showConfirm}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ confirmBtn }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showWarnConfirm"
bind:tap="showDialog"
block
>
确认类-无标题
</t-button>
<t-dialog
visible="{{showWarnConfirm}}"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ { content: '警示操作', variant: 'base', theme: 'danger' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showLightConfirm"
bind:tap="showDialog"
block
>
确认类-纯标题
</t-button>
<t-dialog
visible="{{showLightConfirm}}"
title="对话框标题"
confirm-btn="{{ { content: '确定', variant: 'base', theme: 'light' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
confirmBtn: { content: '确定', variant: 'base' },
dialogKey: '',
showConfirm: false,
showWarnConfirm: false,
showLightConfirm: false,
},
methods: {
showDialog(e) {
const { key } = e.currentTarget.dataset;
this.setData({ [key]: true, dialogKey: key });
},

closeDialog() {
const { dialogKey } = this.data;
this.setData({ [dialogKey]: false });
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

#### 输入类对话框

**WXML** (`html`):
```html
<t-button
t-class="wrapper"
size="large"
theme="primary"
variant="outline"
data-key="showWithInput"
bind:tap="showDialog"
block
>
输入类-无描述
</t-button>
<t-dialog
visible="{{showWithInput}}"
title="带输入框对话框"
confirm-btn="确定"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-input
borderless
class="dialog-input"
clearable
slot="content"
placeholder="输入12文案"
placeholder-class="placeholder"
/>
</t-dialog>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showTextAndTitleWithInput"
bind:tap="showDialog"
block
>输入类-带描述</t-button
>
<t-dialog
visible="{{showTextAndTitleWithInput}}"
title="带输入框对话框"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="确定"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-input
borderless
class="dialog-input"
clearable
slot="content"
placeholder="输入12文案"
placeholder-class="placeholder"
/>
</t-dialog>

```

**JS** (`javascript`):
```javascript
Component({
data: {
dialogKey: '',
showWithInput: false,
showTextAndTitleWithInput: false,
},
methods: {
showDialog(e) {
const { key } = e.currentTarget.dataset;
this.setData({ [key]: true, dialogKey: key });
},

closeDialog() {
const { dialogKey } = this.data;
this.setData({ [dialogKey]: false });
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
margin-bottom: 32rpx;
}

.placeholder {
color: var(--td-text-color-placeholder);
line-height: 96rpx;
height: 96rpx !important;
display: flex;
align-items: center;
}

.dialog-input {
padding-top: 12px;
padding-bottom: 12px;
text-align: left;
margin-top: 32rpx;
border-radius: 8rpx;
background-color: var(--td-bg-color-page);
box-sizing: border-box;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-input": "tdesign-miniprogram/input/input",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

#### 带图片对话框

**WXML** (`html`):
```html
<t-button
t-class="wrapper"
size="large"
theme="primary"
variant="outline"
data-key="imageOnTop"
bind:tap="showDialog"
block
>
图片置顶-带标题描述
</t-button>
<t-dialog
visible="{{imageOnTop}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="top" t-class="dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

<t-button
t-class="wrapper"
size="large"
theme="primary"
variant="outline"
data-key="imageOnTopWithContent"
bind:tap="showDialog"
block
>
图片置顶-无标题
</t-button>
<t-dialog
visible="{{imageOnTopWithContent}}"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="top" t-class="dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

<t-button
t-class="wrapper"
size="large"
theme="primary"
variant="outline"
data-key="imageOnTopWithTitle"
bind:tap="showDialog"
block
>
图片置顶-纯标题
</t-button>
<t-dialog
visible="{{imageOnTopWithTitle}}"
title="对话框标题"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="top" t-class="dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="imageOnMiddleWithImage"
bind:tap="showDialog"
block
>
图片置顶-纯图片
</t-button>
<t-dialog
visible="{{imageOnMiddleWithImage}}"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="top" t-class="dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="imageOnMiddle"
bind:tap="showDialog"
block
>
图片居中-带标题描述
</t-button>
<t-dialog
visible="{{imageOnMiddle}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="middle" t-class="image-host dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="imageOnMiddleWithTitle"
bind:tap="showDialog"
block
>
图片居中-纯标题
</t-button>
<t-dialog
visible="{{imageOnMiddleWithTitle}}"
title="对话框标题"
confirm-btn="{{ {content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
>
<t-image slot="middle" t-class="image-host dialog-image" src="https://tdesign.gtimg.com/mobile/demos/dialog1.png" />
</t-dialog>

```

**JS** (`javascript`):
```javascript
Component({
data: {
dialogKey: '',
imageOnTop: false,
imageOnTopWithContent: false,
imageOnTopWithTitle: false,
imageOnMiddle: false,
imageOnMiddleWithTitle: false,
imageOnMiddleWithImage: false,
},
methods: {
showDialog(e) {
const { key } = e.currentTarget.dataset;
this.setData({ [key]: true, dialogKey: key });
},

closeDialog() {
const { dialogKey } = this.data;
this.setData({ [dialogKey]: false });
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
margin-bottom: 32rpx;
}

.dialog-image {
width: 100%;
height: 160px;
}

.image-host {
display: block;
margin-top: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-image": "tdesign-miniprogram/image/image",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

### 组件状态

**WXML** (`html`):
```html
<view class="demo-desc">文字按钮</view>
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showConfirm"
bind:tap="showDialog"
block
>
文字按钮
</t-button>
<t-dialog
visible="{{showConfirm}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="确定"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

<view class="demo-desc">水平基础按钮</view>
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showWarnConfirm"
bind:tap="showDialog"
block
>
水平基础按钮
</t-button>
<t-dialog
visible="{{showWarnConfirm}}"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ { content: '确定', variant: 'base' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

<view class="demo-desc">垂直基础按钮</view>
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showTooLongBtnContent"
bind:tap="showDialog"
block
>
垂直基础按钮
</t-button>
<t-dialog
visible="{{showTooLongBtnContent}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
confirm-btn="{{ confirmBtn }}"
cancel-btn="取消"
button-layout="vertical"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

<view class="demo-desc">多按钮</view>
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showMultiBtn"
bind:tap="showDialog"
block
>
多按钮
</t-button>
<t-dialog
visible="{{showMultiBtn}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
button-layout="vertical"
actions="{{ multiBtnList }}"
bind:action="closeDialog"
/>

<view class="demo-desc">带关闭按钮的对话框</view>
<t-button
t-class="wrapper"
theme="primary"
size="large"
variant="outline"
data-key="showCloseBtn"
bind:tap="showDialog"
block
>
带关闭按钮的对话框
</t-button>
<t-dialog
visible="{{showCloseBtn}}"
title="对话框标题"
content="告知当前状态、信息和解决方法，等内容。描述文案尽可能控制在三行内"
close-btn
confirm-btn="{{ { content: '警示操作', variant: 'base', theme: 'danger' } }}"
cancel-btn="取消"
bind:confirm="closeDialog"
bind:cancel="closeDialog"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
confirmBtn: { content: '确定', variant: 'base' },
dialogKey: '',
showConfirm: false,
showWarnConfirm: false,
showTooLongBtnContent: false,
showMultiBtn: false,
multiBtnList: [
{ content: '次要按钮', theme: 'light' },
{ content: '次要按钮', theme: 'light' },
{ content: '主要按钮', theme: 'primary' },
],
},
methods: {
showDialog(e) {
const { key } = e.currentTarget.dataset;
this.setData({ [key]: true, dialogKey: key });
},

closeDialog() {
const { dialogKey } = this.data;
this.setData({ [dialogKey]: false });
},
},
});

```

**CSS** (`css`):
```css
.demo-desc {
margin: 0 0 32rpx;
}

.wrapper {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

### 组件用法

#### 命令调用

**WXML** (`html`):
```html
<t-button size="large" variant="outline" theme="primary" bind:tap="showDialog" block> 命令行操作 </t-button>
<t-dialog id="t-dialog" />

```

**JS** (`javascript`):
```javascript
import Dialog from 'tdesign-miniprogram/dialog';

Component({
methods: {
showDialog() {
const dialogConfig = {
context: this,
title: '弹窗标题',
closeOnOverlayClick: true,
content: '告知当前状态、信息和解决方法等内容。',
confirmBtn: '确定',
cancelBtn: '取消',
};

Dialog.confirm(dialogConfig)
.then((data) => console.log('点击了确定', data))
.catch((data) => console.log('点击了取消', data));
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
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

#### 开放能力按钮

当传入的按钮类型为对象时，整个对象都将透传至 `t-button`，因此按钮可以直接使用开放能力

**WXML** (`html`):
```html
<t-button size="large" theme="primary" variant="outline" data-type="hasCancelBtn" bind:tap="showDialog" block>
开放能力按钮
</t-button>
<t-dialog id="t-dialog" />

```

**JS** (`javascript`):
```javascript
import Dialog from 'tdesign-miniprogram/dialog';

Component({
methods: {
showDialog() {
const dialogConfig = {
context: this,
title: '弹窗标题',
content: '告知当前状态、信息和解决方法等内容。',
cancelBtn: '取消',
confirmBtn: {
openType: 'share',
content: '分享给朋友',
bindgetphonenumber({ detail }) {
console.log(detail);
if (detail.errMsg.includes('fail')) {
console.log('获取失败');
return false; // 不关闭弹窗
}
return true; // 关闭弹窗
},
},
};

Dialog.confirm(dialogConfig)
.then(() => {
console.log('点击确定');
})
.catch(() => {
console.log('点击取消');
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
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-dialog": "tdesign-miniprogram/dialog/dialog"
}
}

```

## API

### DialogProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| actions | Array | - | 操作栏。TS 类型：`Array<ButtonProps>`，Button API Documents。详细类型定义 | N |
| button-layout | String | horizontal | 多按钮排列方式。可选项：horizontal/vertical | N |
| cancel-btn | String / Object | - | 取消按钮，可自定义。值为 null 则不显示取消按钮。值类型为字符串，则表示自定义按钮文本，值类型为 Object 则表示透传 Button 组件属性。使用 Slot 自定义按钮时，需自行控制取消事件。详细类型定义 | N |
| close-btn | Boolean / Object | false | `0.31.0`。是否展示关闭按钮，值为`true`显示默认关闭按钮；值为`false`则不显示关闭按钮；使用 Object 时透传至图标组件。TS 类型：`boolean \| ButtonProps \| null`，Button API Documents。详细类型定义 | N |
| close-on-overlay-click | Boolean | false | 点击蒙层时是否触发关闭事件 | N |
| confirm-btn | String / Object | - | 确认按钮。值为 null 则不显示确认按钮。值类型为字符串，则表示自定义按钮文本，值类型为 Object 则表示透传 Button 组件属性。使用 Slot 自定义按钮时，需自行控制确认事件 | N |
| content | String | - | 内容 | N |
| overlay-props | Object | {} | 透传至 Overlay 组件。TS 类型：`OverlayProps`，Overlay API Documents。详细类型定义 | N |
| prevent-scroll-through | Boolean | true | 防止滚动穿透 | N |
| show-overlay | Boolean | true | 是否显示遮罩层 | N |
| title | String | - | 标题 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| visible | Boolean | - | 控制对话框是否显示 | N |
| z-index | Number | 11500 | 对话框层级，Web 侧样式默认为 2500，移动端样式默认 2500，小程序样式默认为 11500 | N |

### DialogEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| cancel | - | 如果“取消”按钮存在，则点击“取消”按钮时触发，同时触发关闭事件 |
| close | `(trigger: DialogEventSource)` | 关闭事件，点击 取消按钮 或 点击蒙层 时触发。详细类型定义。<br>`type DialogEventSource = 'cancel' \| 'overlay' \| 'close-btn'`<br> |
| confirm | - | 如果“确认”按钮存在，则点击“确认”按钮时触发 |
| overlay-click | - | 如果蒙层存在，点击蒙层时触发 |

### DialogSlots

| 名称 | 描述 |
| --- | --- |
| actions | 自定义`actions`显示内容 |
| cancel-btn | 自定义`cancel-btn`显示内容 |
| confirm-btn | 自定义`confirm-btn`显示内容 |
| content | 自定义`content`显示内容 |
| middle | 中间自定义内容 |
| title | 自定义`title`显示内容 |
| top | 顶部自定义内容 |

### DialogExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-action | 操作样式类 |
| t-class-cancel | 取消样式类 |
| t-class-confirm | 确认样式类 |
| t-class-content | 内容样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-dialog-body-max-height | 912rpx | - |
| --td-dialog-border-radius | @radius-extraLarge | - |
| --td-dialog-close-color | @text-color-placeholder | - |
| --td-dialog-content-color | @text-color-secondary | - |
| --td-dialog-content-font | @font-body-large | - |
| --td-dialog-title-color | @text-color-primary | - |
| --td-dialog-title-font | @font-title-large | - |
| --td-dialog-width | 622rpx | - |