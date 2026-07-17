# Input 输入框

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/JMyCXMm98m5b)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

基础输入框

**WXML** (`html`):
```html
<t-input label="标签文字" placeholder="请输入文字" />

<t-input placeholder="请输入文字">
<view slot="label" class="custom-label"> 标签文字 </view>
</t-input>

<t-input placeholder="请输入文字" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.custom-label {
display: inline-flex;
}

.custom-label::after {
content: '*';
color: red;
font-size: 32rpx;
margin-left: 4rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

带字数限制输入框

**WXML** (`html`):
```html
<t-input class="custom-class" label="标签文字" placeholder="请输入文字" tips="最大输入10个字符" maxlength="{{10}}" />
<t-input
class="custom-class"
label="标签文字"
placeholder="请输入文字"
tips="最大输入10个字符，汉字算两个"
maxcharacter="{{10}}"
/>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.custom-class {
--td-input-align-items: start;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

带操作输入框

**WXML** (`html`):
```html
<t-input
label="标签文字"
placeholder="请输入文字"
suffixIcon="{{ { name: 'info-circle-filled', ariaLabel: '提示' } }}"
bind:click="click"
/>

<t-input class="extra" label="标签文字" placeholder="请输入文字" tips="最多十个字" maxcharacter="{{10}}">
<t-button slot="extra" theme="primary" size="extra-small"> 操作按钮 </t-button>
</t-input>

<t-input label="标签文字" placeholder="请输入文字" suffixIcon="{{ { name: 'user-avatar', ariaLabel: '通讯录' } }}" />

```

**JS** (`javascript`):
```javascript
Component({
methods: {
click(e) {
const { trigger } = e.detail;
console.log('click: ', trigger);
},
},
});

```

**CSS** (`css`):
```css
.extra {
--td-input-align-items: start;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-input": "tdesign-miniprogram/input/input"
}
}

```

带图标输入框

**WXML** (`html`):
```html
<t-input prefixIcon="app" label="标签文字" placeholder="请输入文字" />

<t-input prefixIcon="app" placeholder="请输入文字" />

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
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

特定类型输入框

**WXML** (`html`):
```html
<t-input
label="输入密码"
type="password"
value="{{textPassword}}"
suffixIcon="{{ { name: 'browse-off', ariaLabel: '密码' } }}"
/>

<t-input placeholder="输入验证码" label="验证码">
<view slot="suffix" class="suffix">
<view class="suffix--line"></view>
<image
class="image"
src="https://wwcdn.weixin.qq.com/node/wework/images/202010241547.ac6876be9c.png"
mode="heightFix"
aria-role="img"
aria-label="验证码"
/>
</view>
</t-input>

<t-input
label="手机号"
placeholder="输入手机号码"
value="{{phoneNumber}}"
type="number"
tips="{{phoneError ? '手机号输入不正确' : ''}}"
bindchange="onPhoneInput"
>
<view slot="suffix" style="display: flex; align-items: center">
<view class="suffix--line"></view>
<view class="verify" aria-role="button"> 发送验证码 </view>
</view>
</t-input>

<t-input
label="价格"
placeholder="0.00"
suffix="元"
align="right"
type="number"
format="{{priceFormat}}"
bindchange="onPriceInput"
tips="{{priceError ? '请输入正确的价格' : ''}}"
t-class-tips="tips"
/>

<t-input label="数量" placeholder="填写个数" suffix="个" align="right" type="number" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
textPassword: '123456',
phoneError: false,
phoneNumber: '17600600600',
priceError: false,
priceFormat: (v) => {
const isNumber = /^\d+(\.\d+)?$/.test(v);
if (isNumber) {
return parseFloat(v).toFixed(2);
}
return v;
},
},

methods: {
onPhoneInput(e) {
const { phoneError } = this.data;
const isPhoneNumber = /^[1][3,4,5,7,8,9][0-9]{9}$/.test(e.detail.value);
if (phoneError === isPhoneNumber) {
this.setData({
phoneError: !isPhoneNumber,
});
}
},

onPriceInput(e) {
const { priceError } = this.data;
const isNumber = /^\d+(\.\d+)?$/.test(e.detail.value);
if (priceError === isNumber) {
this.setData({
priceError: !isNumber,
});
}
},
},
});

```

**CSS** (`css`):
```css
.suffix {
display: flex;
align-items: center;
}

.suffix--line {
width: 1px;
height: 24px;
background-color: var(--td-component-stroke, #f3f3f3);
margin-right: 16px;
}

.image {
width: 72px;
height: 36px;
display: block;
margin-top: -6px;
margin-bottom: -6px;
}

.tips {
text-align: right !important;
}

.verify {
color: var(--td-brand-color, #0052d9);
font-size: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

### 02组件状态

输入框状态

**WXML** (`html`):
```html
<t-input
class="custom-class"
label="标签文字"
placeholder="请输入文字"
value="已输入内容"
status="error"
tips="错误提示"
clearable="{{ { name: 'close', color: '#D54941', ariaLabel: '通讯录' } }}"
/>

<t-input label="标签文字" value="不可编辑文字" disabled />

<t-input label="标签文字" value="只读模式" readonly></t-input>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.custom-class {
--td-input-align-items: start;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

信息超长状态

**WXML** (`html`):
```html
<t-input label="标签超长时最多十个字" placeholder="请输入文字" />

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
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

### 03组件样式

内容位置

**WXML** (`html`):
```html
<t-input label="左对齐" placeholder="请输入文字" />
<t-input label="居中" placeholder="请输入文字" align="center" />
<t-input label="右对齐" placeholder="请输入文字" align="right" />

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
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

竖排样式

**WXML** (`html`):
```html
<t-input
label="标签文字"
layout="vertical"
placeholder="请输入文字"
suffixIcon="{{ { name: 'info-circle-filled', ariaLabel: '提示' } }}"
></t-input>

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
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

非通栏样式

**WXML** (`html`):
```html
<view class="input-example">
<t-input style="{{style}}" label="标签文字" placeholder="请输入文字" borderless />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
style: 'border-radius: 18rpx;',
},
});

```

**CSS** (`css`):
```css
.input-example {
margin: 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

标签外置样式

**WXML** (`html`):
```html
<view class="input-example">
<view class="input-example__label"> 标签文字 </view>
<t-input
placeholder="请输入文字"
borderless="{{true}}"
suffixIcon="{{ { name: 'info-circle-filled', ariaLabel: '提示' } }}"
style="{{style}}"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
style: 'border: 2rpx solid var(--td-component-border);border-radius: 12rpx;',
},
});

```

**CSS** (`css`):
```css
.input-example {
--td-input-vertical-padding: 24rpx;
background-color: var(--bg-color-demo);
padding: 32rpx 32rpx 16rpx;
}

.input-example__label {
color: var(--td-text-color-primary);
font-size: 24rpx;
line-height: 40rpx;
margin: 0 8rpx 16rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

自定义样式文本框

**WXML** (`html`):
```html
<view class="input-example custom-theme">
<t-input label="标签文字" placeholder="请输入文字" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.input-example {
padding-bottom: 48rpx;
}

.custom-theme {
--td-input-bg-color: rgba(44, 44, 44, 1);
--td-input-border-color: rgba(75, 75, 75, 1);
--td-input-default-text-color: rgba(255, 255, 255, 1);
--td-input-placeholder-text-color: rgba(255, 255, 255, 0.35);
--td-input-label-text-color: rgba(255, 255, 255, 1);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-input": "tdesign-miniprogram/input/input"
}
}

```

## API

### InputProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| adjust-position | Boolean | true | 键盘弹起时，是否自动上推页面 | N |
| align | String | left | 文本内容位置，居左/居中/居右。可选项：left/center/right | N |
| allow-input-over-max | Boolean | false | `1.8.6`。超出`maxlength`或`maxcharacter`之后是否允许继续输入 | N |
| always-embed | Boolean | false | 强制 input 处于同层状态，默认 focus 时 input 会切到非同层状态 (仅在 iOS 下生效) | N |
| auto-focus | Boolean | false | (即将废弃，请直接使用 focus )自动聚焦，拉起键盘 | N |
| borderless | Boolean | false | 是否开启无边框模式 | N |
| clear-trigger | String | always | 清空图标触发方式，仅在输入框有值时有效。可选项：always / focus | N |
| clearable | Boolean / Object | false | 是否可清空，默认不启动。值为`true`表示使用默认清空按钮，值为`Object`表示透传至`icon` | N |
| confirm-hold | Boolean | false | 点击键盘右下角按钮时是否保持键盘不收起 | N |
| confirm-type | String | done | 设置键盘右下角按钮的文字，仅在type='text'时生效。<br>具体释义：<br>`send`右下角按钮为“发送”；<br>`search`右下角按钮为“搜索”；<br>`next`右下角按钮为“下一个”；<br>`go`右下角按钮为“前往”；<br>`done`右下角按钮为“完成”。<br>小程序官方文档。可选项：send/search/next/go/done | N |
| cursor | Number | -1 | 必需。指定 focus 时的光标位置 | Y |
| cursor-color | String | #0052d9 | 光标颜色。iOS 下的格式为十六进制颜色值 #000000，安卓下的只支持 default 和 green，Skyline 下无限制 | N |
| cursor-spacing | Number | 0 | 指定光标与键盘的距离，取 input 距离底部的距离和 cursor-spacing 指定的距离的最小值作为光标与键盘的距离 | N |
| disabled | Boolean | undefined | 是否禁用输入框 | N |
| error-message | String | - | 已废弃。错误提示文本，值为空不显示（废弃属性，如果需要，请更为使用 status 和 tips） | N |
| focus | Boolean | false | 获取焦点 | N |
| format | Function | - | 指定输入框展示值的格式。TS 类型：`InputFormatType``type InputFormatType = (value: InputValue) => string`。详细类型定义 | N |
| hold-keyboard | Boolean | false | focus时，点击页面的时候不收起键盘 | N |
| label | String | - | 左侧文本 | N |
| layout | String | horizontal | 标题输入框布局方式。可选项：vertical/horizontal | N |
| maxcharacter | Number | - | 用户最多可以输入的字符个数，一个中文汉字表示两个字符长度。`maxcharacter`和`maxlength`二选一使用 | N |
| maxlength | Number | -1 | 用户最多可以输入的文本长度，一个中文等于一个计数长度。默认为 -1，不限制输入长度。`maxcharacter`和`maxlength`二选一使用 | N |
| password | Boolean | false | 已废弃。是否是密码类型（已废弃，请更为使用 type 指定输入框类型） | N |
| placeholder | String | undefined | 占位符 | N |
| placeholder-class | String | input-placeholder | 指定 placeholder 的样式类 | N |
| placeholder-style | String | - | 必需。指定 placeholder 的样式 | Y |
| prefix-icon | String / Object | - | 组件前置图标。值为字符串表示图标名称，值为`Object`类型，表示透传至`icon` | N |
| readonly | Boolean | undefined | `1.7.1`。只读状态 | N |
| safe-password-cert-path | String | - | 安全键盘加密公钥的路径，只支持包内路径 | N |
| safe-password-custom-hash | String | - | 安全键盘计算 hash 的算法表达式，如`md5(sha1('foo' + sha256(sm3(password + 'bar'))))` | N |
| safe-password-length | Number | - | 安全键盘输入密码长度 | N |
| safe-password-nonce | String | - | 安全键盘加密盐值 | N |
| safe-password-salt | String | - | 安全键盘计算 hash 盐值，若指定custom-hash 则无效 | N |
| safe-password-time-stamp | Number | - | 安全键盘加密时间戳 | N |
| selection-end | Number | -1 | 光标结束位置，自动聚集时有效，需与 selection-start 搭配使用 | N |
| selection-start | Number | -1 | 光标起始位置，自动聚集时有效，需与 selection-end 搭配使用 | N |
| size | String | medium | 已废弃。输入框尺寸。可选项：small/medium。TS 类型：`'medium' \| 'small'` | N |
| status | String | default | 输入框状态。可选项：default/success/warning/error | N |
| suffix | String | - | 后置图标前的后置内容 | N |
| suffix-icon | String / Object | - | 后置文本内容。值为字符串则表示图标名称，值为`Object`类型，表示透传至`icon` | N |
| tips | String | - | 输入框下方提示文本，会根据不同的`status`呈现不同的样式 | N |
| type | String | text | 输入框类型。可选项：text/number/idcard/digit/safe-password/password/nickname | N |
| value | String / Number | - | 输入框的值。TS 类型：`InputValue``type InputValue = string \| number`。详细类型定义 | N |
| default-value | String / Number | undefined | 输入框的值。非受控属性。TS 类型：`InputValue``type InputValue = string \| number`。详细类型定义 | N |

### InputEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| blur | `(value: InputValue)` | 失去焦点时触发 |
| change | `(value: InputValue, cursor: number, keyCode: number)` | 输入框值发生变化时触发；cursor 为光标位置； |
| clear | - | 清空按钮点击时触发 |
| click | `(trigger: InputTrigger)` | `0.32.0`。点击事件。详细类型定义。<br>`type InputTrigger = 'suffix' \| 'suffix-icon';`<br> |
| enter | `(value: InputValue)` | 回车键按下时触发 |
| focus | `(value: InputValue)` | 获得焦点时触发 |
| keyboardheightchange | `(height: number, duration: number)` | 键盘高度发生变化的时候触发此事件 |
| nicknamereview | `(pass: boolean, timeout: boolean)` | 用户昵称审核完毕后触发，仅在 type 为 "nickname" 时有效 |
| validate | `(detail: { error?: 'exceed-maximum' \| 'below-minimum' })` | 字数超出限制时触发 |

### InputSlots

| 名称 | 描述 |
| --- | --- |
| extra | `1.9.1`。右侧额外内容 |
| label | 自定义`label`显示内容 |
| prefix-icon | 组件前置图标 |
| suffix | 自定义`suffix`显示内容 |
| suffix-icon | 后置文本图标 |
| tips | 输入框下方提示内容 |

### InputExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-clearable | 清空按钮样式类 |
| t-class-input | 输入框样式类 |
| t-class-label | 标签样式类 |
| t-class-prefix-icon | 前置图标样式类 |
| t-class-suffix | 后置样式类 |
| t-class-suffix-icon | 后置图标样式类 |
| t-class-tips | 提示样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-input-align-items | center | - |
| --td-input-bg-color | @bg-color-container | - |
| --td-input-border-color | @component-stroke | - |
| --td-input-border-left-space | 32rpx | - |
| --td-input-border-right-space | 0 | - |
| --td-input-default-text-color | @text-color-primary | - |
| --td-input-default-tips-color | @text-color-placeholder | - |
| --td-input-disabled-text-color | @text-color-disabled | - |
| --td-input-error-text-color | @error-color | - |
| --td-input-error-tips-color | @error-color | - |
| --td-input-label-max-width | 5em | - |
| --td-input-label-min-width | 2em | - |
| --td-input-label-text-color | @text-color-primary | - |
| --td-input-label-text-font | @font-body-large | - |
| --td-input-placeholder-text-color | @text-color-placeholder | - |
| --td-input-placeholder-text-font | @font-body-large | - |
| --td-input-prefix-icon-color | @text-color-primary | - |
| --td-input-success-text-color | @success-color | - |
| --td-input-success-tips-color | @success-color | - |
| --td-input-suffix-icon-color | @text-color-placeholder | - |
| --td-input-suffix-text-color | @text-color-primary | - |
| --td-input-vertical-padding | 32rpx | - |
| --td-input-warning-text-color | @warning-color | - |
| --td-input-warning-tips-color | @warning-color | - |