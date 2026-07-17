# Message 消息通知

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-message": "tdesign-miniprogram/message/message"
}
```

### 引入API

若以 API 形式调用 Message，则需在页面 `page.js` 中引入组件 API：

```js
import Message from 'tdesign-miniprogram/message/index';
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/mAyR8MmK8z5A)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

弹窗内容为纯文本、标题和副标题、带输入框，用 API `Message.info` 方法调用反馈类对话框。

**WXML** (`html`):
```html
<t-message id="t-message" />

<t-message visible="{{visible}}" offset="{{[90, 32]}}" content="这是一条通过组件调用的消息通知" />

<view class="message-example">
<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showTextMessage"
>纯文字的通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showIconMessage"
>带图标的通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showCloseMessage"
>带关闭的通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showScrollMessage"
>可滚动的通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showBtnMessage"
>带按钮的通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showComponent"
>组件调用</t-button
>
</view>

```

**JS** (`javascript`):
```javascript
import Message from 'tdesign-miniprogram/message/index';

Component({
data: {
visible: false,
},
methods: {
showTextMessage() {
Message.info({
context: this,
offset: [90, 32],
duration: 5000,
icon: false,
// single: false, // 打开注释体验多个消息叠加效果
content: '这是一条纯文字的消息通知 5s消失',
});
},

showIconMessage() {
Message.info({
context: this,
offset: ['180rpx', '32rpx'],
duration: 5000,
content: '这是一条带图标的消息通知 5s消失',
});
},

showCloseMessage() {
Message.info({
context: this,
offset: ['180rpx', 32],
content: '这是一条带关闭的消息通知',
duration: -1,
link: {
content: '按钮',
navigatorProps: {
url: '/page/xxx/xxx',
},
},
closeBtn: true,
});
},

showScrollMessage() {
Message.info({
context: this,
offset: [90, 32],
marquee: { speed: 50, loop: -1, delay: 5000 },
icon: false,
content: '这是一条滚动的通知信息',
duration: -1,
});
},

showBtnMessage() {
Message.info({
context: this,
offset: [90, 32],
icon: 'notification-filled',
content: '这是一条带操作的消息通知',
duration: -1,
link: {
content: '链接',
navigatorProps: {
url: '/page/xxx/xxx',
},
},
});
},
showSingleMessage() {
Message.info({
context: this,
offset: [90, 32],
duration: 5000,
icon: false,
content: '这是一条纯文字的消息通知且仅显示一条',
single: true,
});
},
showComponent() {
this.setData({
visible: true,
});
},
},
});

```

**CSS** (`css`):
```css
.message-example {
margin: 32rpx;
}

.external-class {
margin: 0 0 32rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-message": "tdesign-miniprogram/message/message"
}
}

```

### 组件状态

消息通知类型为普通（info）、警示（warning）、成功（success）、错误（error）

**WXML** (`html`):
```html
<t-message id="t-message" />

<view class="message-example">
<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showInfoMessage"
>普通通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showSuccessMessage"
>成功通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showWarnMessage"
>警示通知</t-button
>

<t-button t-class="external-class" theme="primary" variant="outline" size="large" block bind:tap="showErrorMessage"
>错误通知</t-button
>
</view>

```

**JS** (`javascript`):
```javascript
import Message from 'tdesign-miniprogram/message/index';

Component({
methods: {
showInfoMessage() {
Message.info({
context: this,
offset: [90, 32],
duration: 5000,
content: '这是一条普通通知信息',
});
},

showWarnMessage() {
Message.warning({
context: this,
offset: [90, 32],
duration: 5000,
content: '这是一条需要用户关注到的警示通知',
});
},

showSuccessMessage() {
Message.success({
context: this,
offset: [90, 32],
duration: 5000,
content: '这是一条成功的提示消息',
});
},

showErrorMessage() {
Message.error({
context: this,
offset: [90, 32],
duration: 5000,
content: '这是一条错误提示通知',
});
},
},
});

```

**CSS** (`css`):
```css
.message-example {
margin: 32rpx;
}

.external-class {
margin: 0 0 32rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-message": "tdesign-miniprogram/message/message"
}
}

```

## API

### MessageProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| action | String | - | 已废弃。操作 | N |
| align | String | left | 文本对齐方式。可选项：left/center。TS 类型：`MessageAlignType``type MessageAlignType = 'left' \| 'center'`。详细类型定义 | N |
| close-btn | String / Boolean / Object | false | 关闭按钮，可以自定义。值为 true 显示默认关闭按钮，值为 false 不显示关闭按钮。值类型为 string ，如：'user'，则显示组件内置图标。值类型为 object ，则会透传至 icon 组件 | N |
| content | String | - | 用于自定义消息弹出内容 | N |
| duration | Number | 3000 | 消息内置计时器，计时到达时会触发 duration-end 事件。单位：毫秒。值为 0 则表示没有计时器 | N |
| gap | String / Number / Boolean | 12 | 两条`message`之间的间距 | N |
| icon | String / Boolean / Object | true | 消息提醒前面的图标，可以自定义。值为 true 则根据 theme 显示对应的图标，值为 false 则不显示图标。值为 true 显示默认关闭按钮，值为 false 不显示关闭按钮。值类型为 string ，如：'info'，则显示组件内置图标。值类型为 object ，则会透传至 icon 组件 | N |
| link | String / Object | - | 链接名称。值为字符串表示链接名称，值为`Object`类型，表示透传至`Link` | N |
| marquee | Boolean / Object | false | 跑马灯效果。speed 指速度控制；loop 指循环播放次数，值为 -1 表示循环播放，值为 0 表示不循环播放；delay 表示延迟多久开始播放。TS 类型：`boolean \| MessageMarquee``interface MessageMarquee { speed?: number; loop?: number; delay?: number }`。详细类型定义 | N |
| offset | Array | - | 相对于 placement 的偏移量，默认单位 rpx。示例：[-10, 20] 或 ['10rpx', '8rpx']。TS 类型：`Array<string \| number>` | N |
| single | Boolean | true | 是否保持仅显示一条信息 | N |
| theme | String | info | 消息组件风格。可选项：info/success/warning/error。TS 类型：`MessageThemeList``type MessageThemeList = 'info' \| 'success' \| 'warning' \| 'error'`。详细类型定义 | N |
| visible | Boolean | false | 是否显示，隐藏时默认销毁组件 | N |
| default-visible | Boolean | undefined | 是否显示，隐藏时默认销毁组件。非受控属性 | N |
| z-index | Number | 15000 | 元素层级，样式默认为 15000 | N |

### MessageEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| action-btn-click | - | 已废弃。当操作按钮存在时，用户点击操作按钮时触发 |
| close-btn-click | - | 当关闭按钮存在时，用户点击关闭按钮触发 |
| duration-end | - | 计时结束后触发 |
| link-click | - | 当`link`链接存在时，点击链接文本时触发 |

### MessageSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| action | 已废弃。自定义`action`显示内容 |
| close-btn | 关闭按钮 |
| content | 自定义消息弹出内容 |
| icon | 消息提醒前面的图标 |
| link | 链接名称 |

### MessageExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-close-btn | 关闭按钮样式类 |
| t-class-content | 内容样式类 |
| t-class-icon | 图标样式类 |
| t-class-link | 链接样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-message-bg-color | @bg-color-container | - |
| --td-message-border-radius | @radius-default | - |
| --td-message-box-shadow | @shadow-4 | - |
| --td-message-close-icon-color | @font-gray-3 | - |
| --td-message-content-font-color | @font-gray-1 | - |
| --td-message-error-color | @error-color | - |
| --td-message-info-color | @brand-color | - |
| --td-message-success-color | @success-color | - |
| --td-message-warning-color | @warning-color | - |