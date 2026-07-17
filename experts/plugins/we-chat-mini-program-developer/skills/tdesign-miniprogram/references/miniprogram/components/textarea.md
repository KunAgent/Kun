# Textarea 多行文本框

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/Q1EXbNm58n5J)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

基础多行文本框

**WXML** (`html`):
```html
<t-textarea t-class="external-class" placeholder="请输入文字" disableDefaultPadding="{{true}}" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.external-class {
height: 256rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

带标题多行文本框

**WXML** (`html`):
```html
<t-textarea t-class="external-class" label="标签文字" placeholder="请输入文字" disableDefaultPadding="{{true}}" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.external-class {
height: 256rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

自动增高多行文本框

**WXML** (`html`):
```html
<t-textarea
label="标签文字"
placeholder="请输入文字"
disableDefaultPadding="{{true}}"
autosize="{{autosize}}"
bind:line-change="onLineChange"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
autosize: {
maxHeight: 120,
minHeight: 20,
},
},
methods: {
onLineChange(e) {
console.log('lineCount: ', e.detail);
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
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

设置最大字符个数

**WXML** (`html`):
```html
<t-textarea
t-class="external-class"
label="标签文字"
placeholder="设置最大字符个数"
maxlength="200"
disableDefaultPadding="{{true}}"
indicator
/>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.external-class {
height: 324rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

设置最大字符个数，一个汉字表示两个字符

**WXML** (`html`):
```html
<t-textarea
t-class="external-class"
label="标签文字"
placeholder="设置最大字符个数，一个汉字表示两个字符"
maxcharacter="200"
disableDefaultPadding="{{true}}"
indicator
/>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.external-class {
height: 324rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

### 组件状态

禁用多行文本框

**WXML** (`html`):
```html
<t-textarea
t-class="external-class"
label="标签文字"
placeholder="请输入文字"
value="不可编辑文字"
disableDefaultPadding="{{true}}"
disabled
/>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.external-class {
height: 256rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

### 自定义组件样式

标签外置输入框

**WXML** (`html`):
```html
<view class="textarea-example">
<text class="textarea-example__label">标签文字</text>
<t-textarea
t-class="external-class"
placeholder="请输入文字"
bordered
maxlength="100"
disableDefaultPadding="{{true}}"
indicator
style="{{style}}"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
style: 'height: 248rpx',
},
});

```

**CSS** (`css`):
```css
.textarea-example {
padding: 32rpx 32rpx 48rpx;
background-color: var(--bg-color-demo);
}

.external-class {
padding-top: 24rpx !important;
padding-bottom: 24rpx !important;
}

.textarea-example__label {
display: block;
color: var(--td-text-color-primary);
font-size: 24rpx;
line-height: 40rpx;
padding-bottom: 16rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-textarea": "tdesign-miniprogram/textarea/textarea"
}
}

```

## 提示

- 如果需要在页面中调整 `textarea` 中 `placeholder` 样式，请使用名称为`t-textarea__placeholder`的Class选择器，直接覆盖组件内部样式（注意权重）。

## API

### TextareaProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| adjust-position | Boolean | true | 键盘弹起时，是否自动上推页面 | N |
| allow-input-over-max | Boolean | false | `1.8.6`。超出`maxlength`或`maxcharacter`之后是否还允许输入 | N |
| autofocus | Boolean | false | 自动聚焦，拉起键盘 | N |
| autosize | Boolean / Object | false | 是否自动增高，值为 true 时，style.height 不生效。支持传入对象，如 { maxHeight: 120, minHeight: 20 }。TS 类型：`boolean \| { maxHeight?: number, minHeight?: number }` | N |
| bordered | Boolean | false | 是否显示外边框 | N |
| confirm-hold | Boolean | false | 点击键盘右下角按钮时是否保持键盘不收起点 | N |
| confirm-type | String | return | 设置键盘右下角按钮的文字，仅在 type='text'时生效。可选项：return/send/search/next/go/done。TS 类型：`'return' \| 'send' \| 'search' \| 'next' \| 'go' \| 'done'` | N |
| cursor | Number | -1 | 指定 focus 时的光标位置 | N |
| cursor-color | String | #0052d9 | 【试验性】光标颜色，仅在 Skyline 下有效 | N |
| cursor-spacing | Number | 0 | 指定光标与键盘的距离。取textarea距离底部的距离和cursor-spacing指定的距离的最小值作为光标与键盘的距离 | N |
| disable-default-padding | Boolean | false | 是否去掉 iOS 下的默认内边距 | N |
| disabled | Boolean | undefined | 是否禁用文本框 | N |
| fixed | Boolean | false | 如果 textarea 是在一个`position:fixed`的区域，需要显式指定属性 fixed 为 true | N |
| focus | Boolean | false | 自动聚焦 | N |
| hold-keyboard | Boolean | false | focus时，点击页面的时候不收起键盘 | N |
| indicator | Boolean | false | 显示文本计数器，如 0/140。当`maxlength < 0 && maxcharacter < 0`成立时， indicator无效 | N |
| label | String | - | 左侧文本 | N |
| maxcharacter | Number | - | 用户最多可以输入的字符个数，一个中文汉字表示两个字符长度 | N |
| maxlength | Number | -1 | 用户最多可以输入的字符个数，值为 -1 的时候不限制最大长度 | N |
| placeholder | String | undefined | 占位符 | N |
| placeholder-class | String | textarea-placeholder | 指定 placeholder 的样式类，目前仅支持color,font-size和font-weight | N |
| placeholder-style | String | - | 指定 placeholder 的样式，目前仅支持 color ,font-size和font-weight | N |
| readonly | Boolean | undefined | `1.8.6`。只读状态 | N |
| selection-end | Number | -1 | 光标结束位置，自动聚集时有效，需与 selection-start 搭配使用 | N |
| selection-start | Number | -1 | 光标起始位置，自动聚集时有效，需与 selection-end 搭配使用 | N |
| show-confirm-bar | Boolean | true | 是否显示键盘上方带有”完成“按钮那一栏 | N |
| value | String / Number | - | 文本框值。TS 类型：`TextareaValue``type TextareaValue = string \| number`。详细类型定义 | N |
| default-value | String / Number | undefined | 文本框值。非受控属性。TS 类型：`TextareaValue``type TextareaValue = string \| number`。详细类型定义 | N |

### TextareaEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| blur | `(value: TextareaValue, cursor: number)` | 失去焦点时触发 |
| change | `(value: TextareaValue, cursor: number)` | 输入内容变化时触发 |
| enter | `(value: TextareaValue)` | 点击完成时触发 |
| focus | `(value: TextareaValue)` | 获得焦点时触发 |
| keyboardheightchange | `(height: number, duration: number)` | 键盘高度发生变化的时候触发此事件 |
| line-change | `(value: TextareaValue)` | 行高发生变化时触发 |

### TextareaSlots

| 名称 | 描述 |
| --- | --- |
| label | 自定义`label`显示内容 |

### TextareaExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-indicator | 计数器样式类 |
| t-class-label | 左侧文本样式类 |
| t-class-textarea | 多行文本框样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-textarea-background-color | @bg-color-container | - |
| --td-textarea-border-color | @component-border | - |
| --td-textarea-border-radius | @radius-default | - |
| --td-textarea-disabled-text-color | @text-color-disabled | - |
| --td-textarea-indicator-text-color | @text-color-placeholder | - |
| --td-textarea-label-color | @text-color-primary | - |
| --td-textarea-padding | 32rpx | - |
| --td-textarea-placeholder-color | @text-color-placeholder | - |
| --td-textarea-text-color | @text-color-primary | - |