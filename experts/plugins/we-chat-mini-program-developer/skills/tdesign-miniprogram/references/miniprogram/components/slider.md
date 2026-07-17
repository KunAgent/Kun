# Slider 滑动选择器

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/5gDq5NmO8D5P)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

单游标滑块

**WXML** (`html`):
```html
<view class="wrapper">
<t-slider default-value="{{23}}" step="{{0.1}}" bind:change="handleChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
handleChange(e) {
console.log(e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
background: var(--bg-color-demo);
padding: 0 12rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

双游标滑块

**WXML** (`html`):
```html
<view class="wrapper">
<t-slider range defaultValue="{{[35, 65]}}" bind:dragstart="onDragstart" bind:dragend="onDragend" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
onDragstart(e) {
console.log('dragstart', e.detail);
},
onDragend(e) {
console.log('dragend', e.detail);
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
background: var(--bg-color-demo);
padding: 0 12rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

带数值滑动选择器

**WXML** (`html`):
```html
<view class="wrapper">
<t-slider value="{{value}}" label="${value}%" bind:change="handleChange"></t-slider>
</view>

<view class="demo-desc">带数值双游标滑块</view>

<view class="wrapper">
<t-slider show-extreme-value label="{{label}}" default-value="{{ [40, 60] }}" range />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 35,
label(value, position) {
const symbols = { min: '%', max: '%', start: '%', end: '%' };
return `${value}${symbols[position]}`;
},
},

methods: {
handleChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-desc {
margin-top: 24rpx;
margin-bottom: 16rpx;
}

.wrapper {
background: var(--bg-color-demo);
padding: 40rpx 12rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

带刻度滑动选择器

**WXML** (`html`):
```html
<view class="wrapper">
<t-slider defaultValue="{{60}}" marks="{{marks}}" step="{{20}}" bind:change="handleChange" />
</view>

<view class="demo-desc">带刻度双游标滑块</view>

<view class="wrapper">
<t-slider range defaultValue="{{ [20, 60] }}" marks="{{marks}}" step="{{20}}" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
marks: {
0: '0',
20: '20',
40: '40',
60: '60',
80: '80',
100: '100',
},
},
methods: {
handleChange(e) {
console.log(e);
},
},
});

```

**CSS** (`css`):
```css
.demo-desc {
margin-top: 24rpx;
margin-bottom: 16rpx;
}

.wrapper {
background: var(--bg-color-demo);
padding: 40rpx 12rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

### 组件状态

滑块禁用状态

**WXML** (`html`):
```html
<t-slider value="{{35}}" disabled />

<view class="wrapper">
<t-slider show-extreme-value label="${value}%" value="{{ [40, 60] }}" range disabled />
</view>

<view class="wrapper">
<t-slider range value="{{ [20, 60] }}" marks="{{marks}}" step="{{20}}" disabled />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
marks: {
0: '0',
20: '20',
40: '40',
60: '60',
80: '80',
100: '100',
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
margin-top: 32rpx;
background: var(--bg-color-demo);
padding: 40rpx 12rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

#### 特殊样式

胶囊型滑块

**WXML** (`html`):
```html
<view class="wrapper">
<t-slider defaultValue="{{30}}" theme="capsule" />

<t-slider defaultValue="{{ [40, 60] }}" range theme="capsule" />

<t-slider defaultValue="{{ [40, 60] }}" range label="${value}%" theme="capsule" />

<t-slider defaultValue="{{60}}" marks="{{marks}}" step="{{20}}" theme="capsule" />

<t-slider defaultValue="{{ [20, 80] }}" range marks="{{marks}}" step="{{20}}" theme="capsule" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
marks: {
0: '0',
20: '20',
40: '40',
60: '60',
80: '80',
100: '100',
},
},
});

```

**CSS** (`css`):
```css
.label {
display: flex;
align-items: center;
width: 718rpx;
padding-left: 32rpx;
}

.label-class {
flex-grow: 1;
}

.wrapper {
background: var(--bg-color-demo);
padding: 0 12rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

#### 垂直状态

垂直方向的滑块

**WXML** (`html`):
```html
<view class="demo-desc">单游标垂直滑块</view>
<view class="wrapper">
<t-slider vertical value="{{singlevalue}}" label="${value}%" bind:change="handleSingleChange" />
</view>
<view class="demo-desc">带刻度的双游标垂直滑块</view>
<view class="wrapper">
<t-slider vertical range defaultValue="{{ [20, 60] }}" marks="{{marks}}" step="{{20}}" />
</view>
<view class="demo-desc">胶囊型垂直滑块</view>
<view class="wrapper">
<t-slider vertical value="{{capsuleValue}}" label="${value}%" theme="capsule" bind:change="handleCapsuleChange" />
</view>
<view class="demo-desc">带刻度的胶囊型垂直滑块</view>
<view class="wrapper">
<t-slider vertical defaultValue="{{ [20, 80] }}" range marks="{{marks}}" step="{{20}}" theme="capsule" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
singlevalue: 35,
capsuleValue: 35,
marks: {
0: '0',
20: '20',
40: '40',
60: '60',
80: '80',
100: '100',
},
},

methods: {
handleSingleChange(e) {
this.setData({
singlevalue: e.detail.value,
});
},
handleCapsuleChange(e) {
this.setData({
capsuleValue: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-desc {
margin-top: 24rpx;
margin-bottom: 16rpx;
}

.wrapper {
background: var(--bg-color-demo);
padding-top: 40rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

## FAQ

当 slider 外层使用 `hidden` 包裹，需要在 `hidden = false` 时，重新调用组件的 `init` 方法，才能正常渲染（在t-popup/t-dialog中同理）。如下：

```html
<t-slider id="slider" />
```

```js
const $slider = this.selectComponent('#slider');

$slider.init();
```

## API

### SliderProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| colors | Array | [] | 已废弃。颜色，[已选择, 未选择]。TS 类型：`Array<string>` | N |
| disabled | Boolean | undefined | 是否禁用组件 | N |
| disabled-color | Array | [] | 已废弃。禁用状态滑动条的颜色，[已选, 未选]。TS 类型：`Array<string>` | N |
| label | String / Boolean / Function | false | 滑块当前值文本。<br>值为 true 显示默认文案；值为 false 不显示滑块当前值文本；<br>值为`${value}%`则表示组件会根据占位符渲染文案；<br>值类型为函数时，参数`value`标识滑块值，参数`position=start`表示范围滑块的起始值，参数`position=end`表示范围滑块的终点值。TS 类型：`string \| boolean` | N |
| marks | Object / Array | {} | 刻度标记，示例：`[0, 10, 40, 200]`或者`{ 5:  '5¥', 10: '10%' }`。TS 类型：`Record<number, string> \| Array<number>` | N |
| max | Number | 100 | 滑块范围最大值 | N |
| min | Number | 0 | 滑块范围最小值 | N |
| range | Boolean | false | 双游标滑块 | N |
| show-extreme-value | Boolean | false | 是否边界值 | N |
| step | Number | 1 | 步长 | N |
| theme | String | default | `0.30.0`。滑块风格。可选项：default/capsule | N |
| value | Number / Array | 0 | 滑块值。TS 类型：`SliderValue``type SliderValue = number \| Array<number>`。详细类型定义 | N |
| default-value | Number / Array | undefined | 滑块值。非受控属性。TS 类型：`SliderValue``type SliderValue = number \| Array<number>`。详细类型定义 | N |
| vertical | Boolean | false | 是否是垂直的滑块（渲染垂直滑块时，默认高度为400rpx，可通过修改`--td-slider-bar-height`来自定义高度） | N |

### SliderEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: SliderValue)` | 滑块值变化时触发 |
| dragend | `(value: SliderValue, e: TouchEvent)` | 结束拖动时触发 |
| dragstart | `(e: TouchEvent)` | 开始拖动时触发 |

### SliderExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-bar | 滑道底部样式类 |
| t-class-bar-active | 滑道激活态样式类 |
| t-class-bar-disabled | 滑道禁用态样式类 |
| t-class-cursor | 游标样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-slider-active-color | @brand-color | - |
| --td-slider-bar-height | 8rpx | - |
| --td-slider-bar-width | 8rpx | - |
| --td-slider-capsule-bar-color | @bg-color-component | - |
| --td-slider-capsule-bar-heihgt | 48rpx | - |
| --td-slider-capsule-bar-width | 48rpx | - |
| --td-slider-capsule-line-heihgt | 36rpx | - |
| --td-slider-default-color | @bg-color-component | - |
| --td-slider-disabled-color | @brand-color-disabled | - |
| --td-slider-disabled-text-color | @text-color-disabled | - |
| --td-slider-dot-bg-color | #fff | - |
| --td-slider-dot-color | @component-border | - |
| --td-slider-dot-disabled-bg-color | #fff | - |
| --td-slider-dot-disabled-border-color | #f3f3f3 | - |
| --td-slider-dot-size | 40rpx | - |
| --td-slider-text-color | @text-color-primary | - |