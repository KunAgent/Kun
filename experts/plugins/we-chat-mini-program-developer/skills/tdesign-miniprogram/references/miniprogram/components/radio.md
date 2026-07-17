# Radio 单选框

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-radio": "tdesign-miniprogram/radio/radio",
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/jWzlhMmr8e5m)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 纵向单选框

**WXML** (`html`):
```html
<t-radio-group bind:change="onChange" allow-uncheck value="{{current}}" options="{{options}}" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
current: 1,
options: [
{ value: 0, label: '单选' },
{ value: 1, label: '单选' },
{ value: 2, label: '单选单选单选单选单选单选单选单选单选单选单选单选单选单选' },
{
value: 3,
label: '单选',
content: '描述信息描述信息描述信息描述信息描述信息描述信息描述信息描述信息描述信息描述信息',
},
],
},
methods: {
onChange(event) {
const { value } = event.detail;

this.setData({ current: value });
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
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group",
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 横向单选框

**WXML** (`html`):
```html
<t-radio-group default-value="0" borderless t-class="box">
<t-radio block="{{false}}" label="单选标题" value="0" />
<t-radio block="{{false}}" label="单选标题" value="1" />
<t-radio block="{{false}}" label="上限四字" value="2" />
</t-radio-group>

```

**JS** (`javascript`):
```javascript
Page({
data: {
checked: false,
},
handleChange(e) {
this.setData({
checked: e.detail.checked,
});
},
});

```

**CSS** (`css`):
```css
.box {
padding: 32rpx;
display: flex;
justify-content: space-between;
flex-wrap: wrap;
background-color: var(--td-bg-color-container, #fff);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group",
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 单选框状态

**WXML** (`html`):
```html
<t-radio-group defaultValue="radio1" disabled="{{true}}">
<t-radio value="radio1" label="单选" />
<t-radio value="radio2" label="单选" />
</t-radio-group>

```

**JS** (`javascript`):
```javascript
Component({
/**
* 组件的属性列表
*/
properties: {},

/**
* 组件的初始数据
*/
data: {},

/**
* 组件的方法列表
*/
methods: {},
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
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group",
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 勾选样式

**WXML** (`html`):
```html
<t-radio default-checked="{{true}}" allow-uncheck icon="line" label="单选" />

<view class="gutter" style="height: 32rpx"></view>

<t-radio default-checked="{{true}}" allow-uncheck icon="dot" label="单选" />

```

**JS** (`javascript`):
```javascript
Component({
/**
* 组件的属性列表
*/
properties: {},

/**
* 组件的初始数据
*/
data: {},

/**
* 组件的方法列表
*/
methods: {},
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
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 勾选显示位置

**WXML** (`html`):
```html
<t-radio value="radio1" allow-uncheck label="单选" default-checked />

<view class="block"></view>

<t-radio value="radio2" allow-uncheck label="单选" placement="right" default-checked />

```

**JS** (`javascript`):
```javascript
Component({
/**
* 组件的属性列表
*/
properties: {},

/**
* 组件的初始数据
*/
data: {},

/**
* 组件的方法列表
*/
methods: {
onChange(event) {
console.log('radio', event.detail);
},
},
});

```

**CSS** (`css`):
```css
.block {
height: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 非通栏单选样式

**WXML** (`html`):
```html
<t-radio-group t-class="theme-card" default-value="radio1">
<t-radio label="单选" value="radio1" default-checked />
<t-radio label="单选" value="radio2" />
<t-radio label="单选标题多行单选标题多行单选标题多行单选标题多行单选标题多行" value="radio3" />
</t-radio-group>

```

**JS** (`javascript`):
```javascript
Component({
/**
* 组件的属性列表
*/
properties: {},

/**
* 组件的初始数据
*/
data: {},

/**
* 组件的方法列表
*/
methods: {
onChange() {},
},
});

```

**CSS** (`css`):
```css
.theme-card {
border-radius: 24rpx;
margin: 32rpx;
overflow: hidden;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group",
"t-radio": "tdesign-miniprogram/radio/radio"
}
}

```

### 特殊样式

**WXML** (`html`):
```html
<t-radio-group value="{{value}}" allow-uncheck bind:change="onChange">
<view wx:for="{{3}}" wx:key="index" class="card {{value == index ? 'card--active' : ''}}">
<t-icon wx:if="{{value == index}}" name="check" t-class="card__icon" />
<t-radio value="{{index}}" label="单选" content="描述信息描述信息描述信息描述信息描述信息" icon="none" borderless />
</view>
</t-radio-group>

<view class="demo-desc" style="margin: 48rpx 32rpx 32rpx">横向卡片单选框</view>

<t-radio-group t-class="horizontal-box" value="{{value1}}" bind:change="onChange1">
<view wx:for="{{3}}" wx:key="index" class="card {{value1 == index ? 'card--active' : ''}}">
<t-icon wx:if="{{value1 == index}}" name="check" t-class="card__icon" />
<t-radio value="{{index}}" label="单选" icon="none" borderless />
</view>
</t-radio-group>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 0,
value1: 0,
},
methods: {
onChange(e) {
this.setData({ value: e.detail.value });
},
onChange1(e) {
this.setData({ value1: e.detail.value });
},
},
});

```

**CSS** (`css`):
```css
.card {
position: relative;
margin: 32rpx;
border-radius: 12rpx;
overflow: hidden;
box-sizing: border-box;
border: 3rpx solid var(--td-bg-color-container, #fff);
}

.card--active {
border-color: var(--td-brand-color, #0052d9);
}

.card--active::after {
content: '';
display: block;
position: absolute;
left: 0;
top: 0;
width: 0;
border-width: 28px 28px 28px 0;
border-style: solid;
border-color: var(--td-brand-color, #0052d9) transparent transparent transparent;
}

.card__icon {
color: var(--td-bg-color-container, #fff);
position: absolute;
left: 1.5px;
top: 1.5px;
z-index: 1;
}

/* 横向布局 */
.horizontal-box {
display: flex;
align-items: center;
justify-content: space-between;
flex-wrap: wrap;
margin: 32rpx;
}

.horizontal-box .card {
flex: 0 0 calc(33.33% - 12rpx);
margin: 0 0 24rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-radio-group": "tdesign-miniprogram/radio-group/radio-group",
"t-radio": "tdesign-miniprogram/radio/radio",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

## API

### RadioProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| allow-uncheck | Boolean | false | 是否允许取消选中 | N |
| block | Boolean | true | 是否为块级元素 | N |
| checked | Boolean | false | 是否选中 | N |
| default-checked | Boolean | undefined | 是否选中。非受控属性 | N |
| content | String | - | 单选内容 | N |
| content-disabled | Boolean | false | 是否禁用组件内容（content）触发选中 | N |
| disabled | Boolean | undefined | 是否为禁用态 | N |
| icon | String / Array | 'circle' | 自定义选中图标和非选中图标。使用 Array 时表示：`[选中态图标，非选中态图标]`。使用 String 时，值为 circle 表示填充型图标、值为 line 表示描边型图标、值为 dot 表示圆点图标，值为 slot 时使用插槽。TS 类型：`'circle' \| 'line' \| 'dot' \| Array<string>` | N |
| label | String | - | 主文案 | N |
| max-content-row | Number | 5 | 内容最大行数限制 | N |
| max-label-row | Number | 3 | 主文案最大行数限制 | N |
| name | String | - | HTML 元素原生属性 | N |
| placement | String | - | 复选框和内容相对位置。优先级高于 RadioGroup.placement。Radio 单独存在时，默认值为 left。如果父组件存在 RadioGroup，默认值便由 RadioGroup.placement 决定。可选项：left/right | N |
| readonly | Boolean | undefined | `1.8.6`。只读状态 | N |
| value | String / Number / Boolean | false | 单选按钮的值。TS 类型：`T``type RadioValue = string \| number \| boolean`。详细类型定义 | N |

### RadioEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(checked: boolean)` | 值变化时触发 |

### RadioSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，主文案 |
| content | 自定义`content`显示内容 |
| icon | 自定义选中图标和非选中图标 |
| label | 自定义`label`显示内容 |

### RadioExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-border | 边框样式类 |
| t-class-content | 内容样式类 |
| t-class-icon | 图标样式类 |
| t-class-label | 标签样式类 |

### RadioGroupProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| allow-uncheck | Boolean | false | 是否允许取消选中 | N |
| borderless | Boolean | false | 是否开启无边框模式 | N |
| disabled | Boolean | undefined | 是否禁用全部子单选框 | N |
| icon | String / Array | 'circle' | 自定义选中图标和非选中图标。示例：[选中态图标，非选中态图标]。使用 String 时，值为 circle 表示填充型图标、值为 line 表示描边型图标、值为 dot 表示圆点图标；仅在使用 options 时生效。TS 类型：`'circle' \| 'line' \| 'dot' \| Array<string>` | N |
| keys | Object | - | 用来定义 value / label / disabled 在`options`中对应的字段别名。TS 类型：`KeysType`。通用类型定义 | N |
| name | String | - | HTML 元素原生属性 | N |
| options | Array | - | 单选组件按钮形式。RadioOption 数据类型为 string 或 number 时，表示 label 和 value 值相同。TS 类型：`Array<RadioOption>``type RadioOption = string \| number \| RadioOptionObj``interface RadioOptionObj { label?: string; value?: string \| number; readonly?: boolean; disabled?: boolean; allowUncheck?: boolean; }`。详细类型定义 | N |
| placement | String | left | 复选框和内容相对位置。优先级低于 Radio.placement。可选项：left/right | N |
| readonly | Boolean | undefined | `1.8.6`。只读状态 | N |
| value | String / Number / Boolean | - | 选中的值。TS 类型：`T``type RadioValue = string \| number \| boolean`。详细类型定义 | N |
| default-value | String / Number / Boolean | undefined | 选中的值。非受控属性。TS 类型：`T``type RadioValue = string \| number \| boolean`。详细类型定义 | N |

### RadioGroupEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: RadioValue)` | 选中值发生变化时触发 |

### RadioGroupSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，单选框组内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-radio-bg-color | @bg-color-container | - |
| --td-radio-border-color | @component-stroke | - |
| --td-radio-content-checked-color | @text-color-secondary | - |
| --td-radio-content-color | @text-color-secondary | - |
| --td-radio-content-disabled-color | @text-color-disabled | - |
| --td-radio-content-font | @font-body-medium | - |
| --td-radio-font | @font-body-large | - |
| --td-radio-icon-checked-color | @brand-color | - |
| --td-radio-icon-color | @component-border | - |
| --td-radio-icon-disabled-bg-color | @bg-color-component-disabled | - |
| --td-radio-icon-disabled-color | @brand-color-disabled | - |
| --td-radio-icon-size | 48rpx | - |
| --td-radio-label-checked-color | @text-color-primary | - |
| --td-radio-label-color | @text-color-primary | - |
| --td-radio-label-disabled-color | @text-color-disabled | - |
| --td-radio-label-line-height | 48rpx | - |
| --td-radio-vertical-padding | 32rpx | - |