# ChatThinking 思考过程

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-thinking": "tdesign-miniprogram/chat-thinking/chat-thinking"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/mjXfGtmd8V4h)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

支持多种加载动效类型，包括gradient、moving、dots

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-thinking
content="{{content}}"
layout="block"
status="{{status}}"
animation="moving"
bind:expandChange="handleExpandChange"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
thinking: true,
fullText:
'嗯，用户问牛顿第一定律是不是适用于所有参考系。首先，我得先回忆一下牛顿第一定律的内容。牛顿第一定律，也就是惯性定律，说物体在没有外力作用时会保持静止或匀速直线运动。也就是说， 保持原来的运动状态。',
currentText: '',
isTyping: true,
content: {
text: '',
title: '思考过程',
},
typeSpeed: 50,
status: 'pending',
startTime: 0,
},

lifetimes: {
attached() {
this.setData({
startTime: Date.now(),
});
this.startTyping();
},

detached() {
if (this.typingTimer) {
clearTimeout(this.typingTimer);
}
},
},

methods: {
startTyping() {
const { fullText, typeSpeed } = this.data;
let currentIndex = 0;
const typeNextChar = () => {
if (currentIndex <= fullText.length) {
const currentText = fullText.substring(0, currentIndex);
// 检查是否已经完成打字
if (currentIndex === fullText.length) {
const endTime = Date.now();
const duration = Math.round((endTime - this.data.startTime) / 1000);
this.setData({
currentText,
content: {
text: currentText,
title: `已完成思考（耗时${duration}秒）`,
},
isTyping: false,
status: 'complete',
});
return; // 直接返回，不再继续执行
}
// 正常打字过程
this.setData({
currentText,
content: {
text: currentText,
title: '思考过程',
},
isTyping: currentIndex < fullText.length,
});
if (currentIndex < fullText.length) {
this.typingTimer = setTimeout(typeNextChar, typeSpeed);
}
currentIndex += 1;
}
};
typeNextChar();
},
replayTyping() {
if (this.typingTimer) {
clearTimeout(this.typingTimer);
}
this.setData({
currentText: '',
content: {
text: '',
title: '思考过程',
},
isTyping: true,
startTime: Date.now(),
});
this.startTyping();
},
onStop() {
console.log('停止思考');
this.setData({
thinking: false,
});
wx.showToast({
title: '已停止思考',
icon: 'success',
});
},
toggleThinking() {
this.setData({
thinking: !this.data.thinking,
});
},
resetThinking() {
this.setData({
thinking: true,
});
wx.showToast({
title: '已重置',
icon: 'success',
});
},
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-thinking": "tdesign-miniprogram/chat-thinking/chat-thinking"
},
"component": true
}

```

### 02组件状态

#### 思考中

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-thinking content="{{content}}" layout="block" status="{{status}}" bind:collapsedChange="handleCollapsedChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
animation: 'moving',
content: {
text: '嗯，用户问牛顿第一定律是不是适用于所有参考系。首先，我得先回忆一下牛顿第一定律的内容。牛顿第一定律',
title: '思考中···',
},
status: 'pending',
},
methods: {
handleCollapsedChange(e) {
console.log('展开状态变化:', e.detail);
},
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-thinking": "tdesign-miniprogram/chat-thinking/chat-thinking"
}
}

```

#### 思考完成

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-thinking content="{{content}}" layout="block" status="{{status}}" bind:collapsedChange="handleCollapsedChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
animation: 'moving',
status: 'complete',
content: {
text: '嗯，用户问牛顿第一定律是不是适用于所有参考系。首先，我得先回忆一下牛顿第一定律的内容。牛顿第一定律，也就是惯性定律，说物体在没有外力作用时会保持静止或匀速直线运动。也就是说， 保持原来的运动状态。',
title: '已深度思考(用时19秒)',
},
},
methods: {
handleCollapsedChange(e) {
console.log('展开状态变化:', e.detail);
},
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-thinking": "tdesign-miniprogram/chat-thinking/chat-thinking",
"t-radio": "tdesign-miniprogram/radio/radio",
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group"
}
}

```

### 03组件样式

支持通过`layout`来设置思考过程的布局方式

**WXML** (`html`):
```html
<block>
<view class="chat-example-desc">block 样式</view>
<view class="chat-example-block">
<t-chat-thinking layout="block" content="{{content}}" status="{{status}}" animation="{{animation}}" />
</view>

<view class="chat-example-desc">border 样式</view>
<view class="chat-example-block">
<t-chat-thinking layout="border" content="{{content}}" status="{{status}}" animation="{{animation}}" />
</view>
</block>

```

**JS** (`javascript`):
```javascript
Component({
data: {
animation: 'moving',
status: 'complete',
content: {
text: '嗯，用户问牛顿第一定律是不是适用于所有参考系。首先，我得先回忆一下牛顿第一定律的内容。牛顿第一定律，也就是惯性定律，说物体在没有外力作用时会保持静止或匀速直线运动。也就是说， 保持原来的运动状态。',
title: '已深度思考(用时19秒)',
},
},
});

```

**CSS** (`css`):
```css
.chat-example-desc {
margin: var(--td-spacer-3) var(--td-spacer-2) var(--td-spacer-2);
font-size: var(--td-font-size-base);
white-space: pre-line;
color: var(--bg-color-demo-desc);
line-height: 22px;
}

.chat-example-desc:first-child {
margin-top: -8px;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: var(--td-spacer-2);
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-thinking": "tdesign-miniprogram/chat-thinking/chat-thinking"
}
}

```

## API

### ChatThinkingProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | String | moving | 内容区域最大高度，超出会自动滚动。可选项：skeleton/moving/gradient/dot | N |
| collapsed | Boolean | false | 是否折叠 | N |
| content | Object | - | 必需。思考内容对象。TS 类型：`{ text?: string; title?: string }` | Y |
| layout | String | block | 布局方式。可选项：block/border | N |
| max-height | Number | - | 内容区域最大高度，超出会自动滚动 | N |
| status | String | pending | 必需。思考状态。可选项：complete/stop/error/pending | Y |

### ChatThinkingEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| collapsed-change | `(value: Boolean)` | 切换折叠面板时触发 |