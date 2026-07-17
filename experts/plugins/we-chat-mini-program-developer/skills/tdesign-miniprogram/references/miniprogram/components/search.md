# Search 搜索框

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-search": "tdesign-miniprogram/search/search"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/2XDtrNmK8o5d)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

基础搜索框

**WXML** (`html`):
```html
<view class="example-search">
<t-search placeholder="搜索预设文案" />
</view>

<view class="example-search">
<t-search placeholder="输入tdesign，有预览结果" resultList="{{resultList}}" bind:change="onChangeValue" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: '',
resultList: [],
},
methods: {
onChangeValue(e) {
const { value } = e.detail;
const list = [
'tdesign-vue',
'tdesign-react',
'tdesign-miniprogram',
'tdesign-angular',
'tdesign-mobile-vue',
'tdesign-mobile-react',
];
this.setData({
resultList: value ? list.filter((v) => v.includes(value)) : [],
});
},
},
});

```

**CSS** (`css`):
```css
.example-search {
background-color: var(--bg-color-demo);
padding: 16rpx 32rpx;
}

.example-search:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-search": "tdesign-miniprogram/search/search"
}
}

```

获取焦点后显示取消按钮

**WXML** (`html`):
```html
<view class="example-search">
<t-search
value="{{value}}"
center
placeholder="搜索预设文案"
action="{{actionText}}"
bind:blur="blurHandle"
bind:focus="focusHandle"
bind:action-click="actionHandle"
bind:change="changeHandle"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: '',
actionText: '',
},

methods: {
changeHandle(e) {
const { value } = e.detail;
this.setData({
value,
});
},

focusHandle() {
this.setData({
actionText: '取消',
});
},

blurHandle() {
this.setData({
actionText: '',
});
},

actionHandle() {
this.setData({
value: '',
actionText: '',
});
},
},
});

```

**CSS** (`css`):
```css
.example-search {
background-color: var(--bg-color-demo);
padding: 16rpx 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-search": "tdesign-miniprogram/search/search"
}
}

```

### 02组件样式

搜索框形状

**WXML** (`html`):
```html
<view class="example-search">
<t-search placeholder="搜索预设文案" />
</view>

<view class="example-search">
<t-search placeholder="搜索预设文案" shape="round" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: '',
},
methods: {
onChange(e) {
console.log(e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.example-search {
background-color: var(--bg-color-demo);
padding: 16rpx 32rpx;
}

.example-search:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"styleIsolation": "apply-shared",
"usingComponents": {
"t-search": "tdesign-miniprogram/search/search"
}
}

```

### 03组件状态

默认状态其他对齐方式

**WXML** (`html`):
```html
<view class="example-search">
<t-search model:value="{{value}}" center placeholder="搜索预设文案" bind:change="onChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: '',
},

methods: {
onChange({ detail }) {
console.log(`modelValue: ${detail.value}`);
},
},
});

```

**CSS** (`css`):
```css
.example-search {
background-color: var(--bg-color-demo);
padding: 16rpx 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-search": "tdesign-miniprogram/search/search"
}
}

```

## API

### SearchProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| action | String | '' | 自定义右侧操作按钮文字 | N |
| adjust-position | Boolean | true | 键盘弹起时，是否自动上推页面 | N |
| always-embed | Boolean | false | 强制 input 处于同层状态，默认 focus 时 input 会切到非同层状态 (仅在 iOS 下生效) | N |
| center | Boolean | false | 是否居中 | N |
| clear-trigger | String | always | 清空图标触发方式，仅在输入框有值时有效。可选项：always / focus | N |
| clearable | Boolean | true | 是否启用清除控件 | N |
| confirm-hold | Boolean | false | 点击键盘右下角按钮时是否保持键盘不收起 | N |
| confirm-type | String | search | 设置键盘右下角按钮的文字，仅在type='text'时生效。<br>具体释义：<br>`send`右下角按钮为“发送”；<br>`search`右下角按钮为“搜索”；<br>`next`右下角按钮为“下一个”；<br>`go`右下角按钮为“前往”；<br>`done`右下角按钮为“完成”。<br>小程序官方文档。可选项：send/search/next/go/done | N |
| cursor | Number | -1 | 必需。指定 focus 时的光标位置 | Y |
| cursor-color | String | #0052d9 | `1.12.1`。光标颜色。iOS 下的格式为十六进制颜色值 #000000，安卓下的只支持 default 和 green，Skyline 下无限制 | N |
| cursor-spacing | Number | 0 | 搜索框聚焦时底部与键盘的距离 | N |
| disabled | Boolean | false | 是否禁用 | N |
| focus | Boolean | false | 是否聚焦 | N |
| hold-keyboard | Boolean | false | focus时，点击页面的时候不收起键盘 | N |
| label | String | '' | 已废弃。左侧文本 | N |
| left-icon | String | 'search' | 左侧图标。如果需要使用`Slot`进行自定义，必须将该值设置为假值 | N |
| maxcharacter | Number | - | 用户最多可以输入的字符个数，一个中文汉字表示两个字符长度。`maxcharacter`和`maxlength`二选一使用 | N |
| maxlength | Number | -1 | 用户最多可以输入的文本长度，一个中文等于一个计数长度。默认为 -1，不限制输入长度。`maxcharacter`和`maxlength`二选一使用 | N |
| placeholder | String | '' | 占位符 | N |
| placeholder-class | String | input-placeholder | 指定 placeholder 的样式类 | N |
| placeholder-style | String | - | 必需。指定 placeholder 的样式 | Y |
| readonly | Boolean | undefined | 只读状态 | N |
| result-list | Array | [] | 预览结果列表。TS 类型：`Array<string>` | N |
| right-icon | String | 'close-circle-filled' | 已废弃。右侧图标 | N |
| selection-end | Number | -1 | 光标结束位置，自动聚集时有效，需与 selection-start 搭配使用 | N |
| selection-start | Number | -1 | 光标起始位置，自动聚集时有效，需与 selection-end 搭配使用 | N |
| shape | String | 'square' | 搜索框形状。可选项：square/round | N |
| type | String | 'text' | 拉起键盘的类型。可选项：text/number/idcard/digit/nickname | N |
| value | String | '' | 值 | N |

### SearchEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| action-click | `({})` | 点击右侧操作按钮文字时触发 |
| blur | `({ value: string })` | 失去焦点时触发 |
| change | `({ value: string })` | 值发生变化时触发 |
| clear | `({ value: string })` | 点击清除时触发 |
| focus | `({ value: string })` | 聚焦时触发 |
| submit | `({ value: string })` | 提交时触发 |

### SearchSlots

| 名称 | 描述 |
| --- | --- |
| action | 自定义`action`显示内容 |
| left-icon | 左侧图标 |
| right-icon | 已废弃。自定义`right-icon`显示内容 |

### SearchExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-action | 操作按钮样式类 |
| t-class-clear | 右侧图标样式类 |
| t-class-input | 输入框样式类 |
| t-class-input-container | 输入框容器样式类 |
| t-class-left | 左侧图标样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-search-action-color | @brand-color | - |
| --td-search-bg-color | @bg-color-secondarycontainer | - |
| --td-search-clear-icon-color | @text-color-placeholder | - |
| --td-search-clear-icon-size | 48rpx | - |
| --td-search-disabled-text-color | @text-color-disabled | - |
| --td-search-font | @font-body-large | - |
| --td-search-height | 80rpx | - |
| --td-search-icon-color | @text-color-placeholder | - |
| --td-search-icon-size | 48rpx | - |
| --td-search-label-color | @text-color-primary | - |
| --td-search-padding | 16rpx 24rpx | - |
| --td-search-placeholder-color | @text-color-placeholder | - |
| --td-search-result-high-light-color | @brand-color | - |
| --td-search-square-radius | @radius-default | - |
| --td-search-text-color | @text-color-primary | - |