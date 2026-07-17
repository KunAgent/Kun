# DateTimePicker 时间选择器

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/hts3GMmc8c5q)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 年月日选择器

**WXML** (`html`):
```html
<t-cell
title="选择日期"
hover
note="{{dateText || ''}}"
arrow
data-mode="date"
bindtap="showPicker"
class="test"
t-class="panel-item"
/>

<!-- 年月日 -->
<t-date-time-picker
auto-close
title="选择日期"
showWeek
visible="{{dateVisible}}"
mode="date"
default-value="{{date}}"
format="YYYY-MM-DD ddd"
filter="{{filter}}"
formatter="{{formatter}}"
popup-props="{{popupProps}}"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
bindclose="handleClose"
/>

```

**JS** (`javascript`):
```javascript
const calendarMonth = [
'January',
'February',
'March',
'April',
'May',
'June',
'July',
'August',
'September',
'October',
'November',
'December',
];

Page({
data: {
mode: '',
dateVisible: false,
date: new Date('2021-12-23').getTime(), // 支持时间戳传入
dateText: '',
filter(type, options) {
if (type === 'year') {
return options.sort((a, b) => b.value - a.value);
}
return options;
},
popupProps: {
usingCustomNavbar: true,
},

formatter(item, index) {
if (index === 1) {
const label = item.label.slice(0, -1);
return {
value: item.value,
label: calendarMonth[Number(label) - 1],
};
}
if (index === 2) {
const [dateValue, weekValue] = item.label.split(' ');
const dateSuffixes = {
1: 'st',
2: 'nd',
3: 'rd',
};
const weekMap = {
周一: 'Mon.',
周二: 'Tues.',
周三: 'Wed.',
周四: 'Thurs.',
周五: 'Fri.',
周六: 'Sat.',
周日: 'Sun.',
};
const label = dateValue.slice(0, -1);

return {
value: item.value,
label: `${label}${dateSuffixes[label] || 'th'} ${weekMap[weekValue]}`,
};
}

return {
value: item.value,
label: item.label.slice(0, -1),
};
},
},
showPicker(e) {
const { mode } = e.currentTarget.dataset;
this.setData({
mode,
[`${mode}Visible`]: true,
});
},

handleClose(e) {
console.log('handleClose:', e);
},

onConfirm(e) {
const { value } = e.detail;
const { mode } = this.data;

console.log('confirm', value);

this.setData({
[mode]: value,
[`${mode}Text`]: value,
});
},

onColumnChange(e) {
console.log('pick', e.detail.value);
},
});

```

**CSS** (`css`):
```css
.panel-item {
margin-bottom: 32rpx;
}

.panel-item::after {
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

#### 年月选择器

**WXML** (`html`):
```html
<t-cell title="选择日期" hover note="{{monthText}}" arrow data-mode="month" bindtap="showPicker" t-class="panel-item" />

<!-- 年月 -->
<t-date-time-picker
title="选择日期"
visible="{{monthVisible}}"
mode="month"
value="{{month}}"
format="YYYY-MM"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
start="{{start}}"
end="{{end}}"
/>

```

**JS** (`javascript`):
```javascript
Page({
data: {
mode: '',
monthVisible: false,
month: '2021-09',
monthText: '',

// 指定选择区间起始值
start: '2000-01-01 00:00:00',
end: '2030-09-09 12:12:12',
},
showPicker(e) {
const { mode } = e.currentTarget.dataset;
this.setData({
mode,
[`${mode}Visible`]: true,
});
},
hidePicker() {
const { mode } = this.data;
this.setData({
[`${mode}Visible`]: false,
});
},
onConfirm(e) {
const { value } = e.detail;
const { mode } = this.data;

console.log('confirm', value);

this.setData({
[mode]: value,
[`${mode}Text`]: value,
});

this.hidePicker();
},

onColumnChange(e) {
console.log('pick', e.detail.value);
},
});

```

**CSS** (`css`):
```css
.panel-item {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

### 时间选择器

包括：`时分秒`、`时分`两个示例

**WXML** (`html`):
```html
<view class="demo-desc">时分秒选择器</view>
<t-cell
title="选择时间"
hover
note="{{secondText || ''}}"
arrow
data-mode="second"
bindtap="showPicker"
t-class="panel-item"
/>

<view class="demo-desc">时分选择器</view>
<t-cell
title="选择时间"
hover
note="{{minuteText || ''}}"
arrow
data-mode="minute"
bindtap="showPicker"
t-class="panel-item"
/>

<!-- 时分 -->
<t-date-time-picker
title="选择时间"
visible="{{secondVisible}}"
mode="{{['null', 'second']}}"
value="{{second}}"
format="HH:mm:ss"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
/>

<!-- 时分 -->
<t-date-time-picker
title="选择时间"
visible="{{minuteVisible}}"
mode="{{['null', 'minute']}}"
start="{{start}}"
value="{{minute}}"
format="HH:mm"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
mode: '',
second: '10:00:00',
minute: '23:59',
start: '2025-04-29 00:00:00',
},
methods: {
showPicker(e) {
const { mode } = e.currentTarget.dataset;
this.setData({
mode,
[`${mode}Visible`]: true,
});
},
hidePicker() {
const { mode } = this.data;
this.setData({
[`${mode}Visible`]: false,
});
},
onConfirm(e) {
const { value } = e.detail;
const { mode } = this.data;

console.log('confirm', value);

this.setData({
[mode]: value,
[`${mode}Text`]: value,
});

this.hidePicker();
},

onColumnChange(e) {
console.log('pick', e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.panel-item {
margin: 32rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"styleIsolation": "apply-shared",
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

#### 年月日时分秒选择器

**WXML** (`html`):
```html
<t-cell
title="选择日期时间"
hover
note="{{datetimeText}}"
arrow
data-mode="datetime"
bindtap="showPicker"
t-class="panel-item"
/>

<!-- 年月日时分 -->
<t-date-time-picker
title="选择日期和时间"
visible="{{datetimeVisible}}"
mode="second"
value="{{datetime}}"
format="YYYY-MM-DD HH:mm:ss"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
/>

```

**JS** (`javascript`):
```javascript
Page({
data: {
mode: '',
datetimeVisible: false,
datetime: new Date('2021-12-23').getTime(),
datetimeText: '',
},
showPicker(e) {
const { mode } = e?.currentTarget?.dataset;
this.setData({
mode,
[`${mode}Visible`]: true,
});
},
hidePicker() {
const { mode } = this.data;
this.setData({
[`${mode}Visible`]: false,
});
},
onConfirm(e) {
const { value } = e?.detail;
const { mode } = this.data;

console.log('confirm', value);

this.setData({
[mode]: value,
[`${mode}Text`]: value,
});

this.hidePicker();
},

onColumnChange(e) {
console.log('pick', e?.detail?.value);
},
});

```

**CSS** (`css`):
```css
.panel-item {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

### 组件用法

#### 调整步数

**WXML** (`html`):
```html
<t-cell title="选择时间" hover note="{{text || ''}}" arrow bindtap="showPicker" t-class="panel-item" />

<t-date-time-picker
title="选择时间"
visible="{{visible}}"
value="{{value}}"
format="HH:mm:ss"
mode="{{['null', 'second']}}"
steps="{{ { minute: 5 } }}"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
text: '',
value: '10:00:00',
visible: false,
},
methods: {
showPicker() {
this.setData({
visible: true,
});
},
hidePicker() {
this.setData({
visible: false,
});
},
onConfirm(e) {
const { value } = e.detail;

console.log('confirm', value);

this.setData({
value,
text: value,
});

this.hidePicker();
},

onColumnChange(e) {
console.log('pick', e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.panel-item {
margin: 32rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

#### 不使用Popup

**WXML** (`html`):
```html
<t-date-time-picker
usePopup="{{false}}"
title="选择日期"
visible="{{dateVisible}}"
mode="date"
defaultValue="{{date}}"
format="YYYY-MM-DD"
bindchange="onConfirm"
bindpick="onColumnChange"
bindcancel="hidePicker"
start="{{start}}"
end="{{end}}"
/>

```

**JS** (`javascript`):
```javascript
Page({
data: {
mode: '',
dateVisible: false,
date: new Date('2021-12-23').getTime(), // 支持时间戳传入

// 指定选择区间起始值
start: '2000-01-01 00:00:00',
end: '2030-09-09 12:12:12',
},

hidePicker() {
const { mode } = this.data;
this.setData({
[`${mode}Visible`]: false,
});
},
onConfirm(e) {
const { value } = e.detail;
const { mode } = this.data;

console.log('confirm', value);

this.setData({
[mode]: value,
[`${mode}Text`]: value,
});

this.hidePicker();
},

onColumnChange(e) {
console.log('pick', e.detail.value);
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
}
}

```

## API

### DateTimePickerProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| auto-close | Boolean | false | 自动关闭；在确认、取消、点击遮罩层自动关闭，不需要手动设置 visible | N |
| cancel-btn | String | 取消 | 取消按钮文字 | N |
| confirm-btn | String | - | 确定按钮文字 | N |
| custom-locale | String | zh | 组件国际化语言，目前支持: 简体中文(zh)、(tc)、英文(en)、日语(ja)、韩语(ko)、俄语(ru)等六种语言 | N |
| end | String / Number | - | 选择器的最大可选时间，默认为当前时间+10年 | N |
| filter | Function | - | 列选项过滤函数，支持自定义列内容。(type 值可为: year, month, date, hour, minute, second)。TS 类型：`(type: TimeModeValues, columns: DateTimePickerColumn) => DateTimePickerColumn``type DateTimePickerColumn = DateTimePickerColumnItem[]``interface DateTimePickerColumnItem { label: string,value: string}`。详细类型定义 | N |
| format | String | 'YYYY-MM-DD HH:mm:ss' | 用于格式化 pick、change、confirm 事件返回的值，详细文档 | N |
| formatter | Function | - | 格式化标签。TS 类型：`(option: DateTimePickerColumnItem, columnIndex: number) => DateTimePickerColumnItem` | N |
| header | Boolean | true | 头部内容。值为 true 显示空白头部，值为 false 不显示任何内容 | N |
| mode | String / Array | 'date' | year = 年；month = 年月；date = 年月日；hour = 年月日时； minute = 年月日时分；当类型为数组时，第一个值控制年月日，第二个值控制时分秒。TS 类型：`DateTimePickerMode``type DateTimePickerMode = TimeModeValues \| Array<TimeModeValues> ``type TimeModeValues = 'year' \| 'month' \| 'date' \| 'hour' \| 'minute' \| 'second'`。详细类型定义 | N |
| popup-props | Object | {} | 透传 Popup 组件全部属性。TS 类型：`PopupProps`，Popup API Documents。详细类型定义 | N |
| show-week | Boolean | false | `1.9.0`。是否在日期旁边显示周几（如周一，周二，周日等） | N |
| start | String / Number | - | 选择器的最小可选时间，默认为当前时间-10年 | N |
| steps | Object | {} | 时间间隔步数，示例：`{ minute: 5 }`。TS 类型：`{ [key in TimeModeValues]?: number }` | N |
| title | String | - | 标题 | N |
| use-popup | Boolean | true | 是否使用弹出层包裹 | N |
| value | String / Number | - | 选中值。TS 类型：`DateValue``type DateValue = string \| number`。详细类型定义 | N |
| default-value | String / Number | undefined | 选中值。非受控属性。TS 类型：`DateValue``type DateValue = string \| number`。详细类型定义 | N |
| visible | Boolean | false | 是否显示 | N |

### DateTimePickerEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| cancel | - | 取消按钮点击时触发 |
| change | `(value: DateValue)` | 确认按钮点击时触发 |
| close | `(trigger: TriggerSource)` | `1.0.1`。关闭时触发。详细类型定义。<br>`type TriggerSource = 'overlay' \| 'cancel-btn' \| 'confirm-btn'`<br> |
| confirm | `(value: DateValue)` | `1.0.1`。确认按钮点击时触发 |
| pick | `(value: DateValue)` | 选中值发生变化时触发 |

### DateTimePickerSlots

| 名称 | 描述 |
| --- | --- |
| footer | 底部内容 |
| header | 自定义`header`显示内容 |

### DateTimePickerExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-cancel | 取消样式类 |
| t-class-confirm | 确认样式类 |
| t-class-title | 标题样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-data-time-picker-year-width | 128rpx | - |