# Stepper 步进器

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/1oDoyNmm8G5k)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

基础步进器

**WXML** (`html`):
```html
<view class="stepper-example">
<t-stepper defaultValue="3" theme="filled" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.stepper-example {
padding: 32rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
}

```

### 组件状态

最大最小状态

**WXML** (`html`):
```html
<view class="stepper-example">
<t-stepper defaultValue="0" theme="filled" />
<t-stepper defaultValue="99" theme="filled" min="5" max="999" />
<t-stepper defaultValue="999" theme="filled" max="999" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.stepper-example {
padding: 32rpx;
display: flex;
background-color: var(--bg-color-demo);
justify-content: space-between;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
}

```

禁用状态

**WXML** (`html`):
```html
<view class="stepper-example">
<t-stepper disabled theme="filled" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.stepper-example {
padding: 32rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
}

```

### 组件样式

步进器样式

**WXML** (`html`):
```html
<view class="stepper-example">
<t-stepper defaultValue="3" theme="filled" />
<t-stepper defaultValue="3" theme="outline" />
<t-stepper defaultValue="3" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.stepper-example {
padding: 32rpx;
display: flex;
background-color: var(--bg-color-demo);
justify-content: space-between;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
}

```

步进器尺寸

**WXML** (`html`):
```html
<view class="stepper-example">
<t-stepper value="{{value}}" size="large" theme="filled" bind:change="handleChange" />
<t-stepper defaultValue="3" max="99" theme="filled" />
<t-stepper defaultValue="3" size="small" theme="filled" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 3,
},

methods: {
handleChange(e) {
const { value } = e.detail;

console.log(value);
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.stepper-example {
padding: 32rpx;
display: flex;
background-color: var(--bg-color-demo);
justify-content: space-between;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-stepper": "tdesign-miniprogram/stepper/stepper"
}
}

```

## API

### StepperProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| disable-input | Boolean | false | 禁用输入框 | N |
| disabled | Boolean | undefined | 禁用全部操作 | N |
| input-width | Number | - | 输入框宽度，默认单位`px` | N |
| integer | Boolean | true | 是否整型 | N |
| max | Number | 100 | 最大值 | N |
| min | Number | 0 | 最小值 | N |
| size | String | medium | 组件尺寸。可选项：small/medium/large。TS 类型：`SizeEnum`。通用类型定义 | N |
| step | Number | 1 | 步长 | N |
| theme | String | normal | 组件风格。可选项：normal/filled/outline | N |
| value | String / Number | 0 | 值 | N |
| default-value | String / Number | undefined | 值。非受控属性 | N |

### StepperEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| blur | `({ type: string \| number })` | 输入框失去焦点时触发 |
| change | `({ value: string \| number })` | 数值发生变更时触发 |
| focus | `({ value: string \| number }))` | 输入框聚焦时触发 |
| overlimit | `({type: 'minus' \| 'plus'})` | 数值超出限制时触发 |

### StepperExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-input | 输入框样式类 |
| t-class-minus | 左侧递减号样式类 |
| t-class-plus | 右侧递增号样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-stepper-input-disabled-bg | @bg-color-component-disabled | - |
| --td-stepper-input-disabled-color | @text-color-disabled | - |
| --td-stepper-border-color | @component-border | - |
| --td-stepper-border-radius | @radius-small | - |
| --td-stepper-input-color | @text-color-primary | - |