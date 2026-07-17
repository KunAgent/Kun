# TreeSelect 树形选择器

## 示例

该组件于 0.32.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-tree-select": "tdesign-miniprogram/tree-select/tree-select"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/1zElDNmq8v5G)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 基础树形选择

**WXML** (`html`):
```html
<t-tree-select options="{{options}}" value="{{value}}" bind:change="onChange" />

```

**JS** (`javascript`):
```javascript
const chineseNumber = '一二三四五六七八九十'.split('');

const generateTree = function (deep = 0, count = 10, prefix) {
const ans = [];

for (let i = 0; i < count; i += 1) {
const value = prefix ? `${prefix}-${i}` : `${i}`;
const rect = {
label: `选项${chineseNumber[i]}`,
value,
};

if (deep > 0) {
rect.children = generateTree(deep - 1, 10, value);
}
ans.push(rect);
}

return ans;
};

Component({
data: {
options: generateTree(1),
value: ['5', '5-5'],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
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
"t-tree-select": "tdesign-miniprogram/tree-select/tree-select"
}
}

```

#### 多选树形选择

**WXML** (`html`):
```html
<t-tree-select options="{{options}}" value="{{value}}" multiple bind:change="onChange" />

```

**JS** (`javascript`):
```javascript
const chineseNumber = '一二三四五六七八九十'.split('');

const generateTree = function (deep = 0, count = 10, prefix) {
const ans = [];

for (let i = 0; i < count; i += 1) {
const value = prefix ? `${prefix}-${i}` : `${i}`;
const rect = {
label: `选项${chineseNumber[i]}`,
value,
};

if (deep > 0) {
rect.children = generateTree(deep - 1, 10, value);
}
ans.push(rect);
}

return ans;
};

Component({
data: {
options: generateTree(1),
value: ['5', ['5-0', '5-1']],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
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
"t-tree-select": "tdesign-miniprogram/tree-select/tree-select"
}
}

```

### 组件状态

#### 三级树形选择

**WXML** (`html`):
```html
<t-tree-select options="{{options}}" value="{{value}}" bind:change="onChange" />

```

**JS** (`javascript`):
```javascript
const areaList = {
provinces: {
110000: '北京市',
440000: '广东省',
},
cities: {
110100: '北京市',
440100: '广州市',
440200: '韶关市',
440300: '深圳市',
440400: '珠海市',
440500: '汕头市',
440600: '佛山市',
},
counties: {
110101: '东城区',
110102: '西城区',
110105: '朝阳区',
110106: '丰台区',
110107: '石景山区',
110108: '海淀区',
110109: '门头沟区',
110111: '房山区',
110112: '通州区',
110113: '顺义区',
110114: '昌平区',
110115: '大兴区',
110116: '怀柔区',
110117: '平谷区',
110118: '密云区',
110119: '延庆区',
440103: '荔湾区',
440104: '越秀区',
440105: '海珠区',
440106: '天河区',
440111: '白云区',
440112: '黄埔区',
440113: '番禺区',
440114: '花都区',
440115: '南沙区',
440117: '从化区',
440118: '增城区',
440203: '武江区',
440204: '浈江区',
440205: '曲江区',
440222: '始兴县',
440224: '仁化县',
440229: '翁源县',
440232: '乳源瑶族自治县',
440233: '新丰县',
440281: '乐昌市',
440282: '南雄市',
440303: '罗湖区',
440304: '福田区',
440305: '南山区',
440306: '宝安区',
440307: '龙岗区',
440308: '盐田区',
440309: '龙华区',
440310: '坪山区',
440311: '光明区',
440402: '香洲区',
440403: '斗门区',
440404: '金湾区',
440507: '龙湖区',
440511: '金平区',
440512: '濠江区',
440513: '潮阳区',
440514: '潮南区',
440515: '澄海区',
440523: '南澳县',
440604: '禅城区',
440605: '南海区',
440606: '顺德区',
440607: '三水区',
440608: '高明区',
},
};

const generateTree = () => {
const { provinces, cities, counties } = areaList;
const options = [];
const eachObj = (obj, cb) => Object.keys(obj).forEach(cb);
const match = (v1, v2, base) => parseInt(v1 / base, 10) === parseInt(v2 / base, 10);

eachObj(provinces, (prov) => {
const cityList = [];

eachObj(cities, (city) => {
const countyList = [];

if (match(city, prov, 10000)) {
eachObj(counties, (county) => {
if (match(county, city, 100)) {
countyList.push({
label: counties[county],
value: county,
});
}
});
cityList.push({
label: cities[city],
value: city,
children: countyList,
});
}
});

const item = {
label: provinces[prov],
value: prov,
children: cityList,
};

options.push(item);
});

return options;
};

Component({
data: {
options: generateTree(),
value: ['110000', '110100', '110101'],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
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
"t-tree-select": "tdesign-miniprogram/tree-select/tree-select"
}
}

```

## API

### TreeSelectProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| custom-value | String / Number / Array | - | 自定义选中值，优先级高于`value`。TS 类型：`TreeSelectValue` | N |
| height | String / Number | 336 | 高度，默认单位为 px | N |
| keys | Object | - | 用来定义`value / label / disabled / children`在`options`数据中对应的字段别名，示例：`{ value: 'key', label: 'name', children: 'list' }`。TS 类型：`TreeKeysType`。通用类型定义 | N |
| multiple | Boolean | false | 是否允许多选 | N |
| options | Array | [] | 选项。TS 类型：`Array<DataOption>` | N |
| value | String / Number / Array | - | 选中值。TS 类型：`TreeSelectValue``type TreeSelectValue = string \| number \| Array<TreeSelectValue>`。详细类型定义 | N |
| default-value | String / Number / Array | undefined | 选中值。非受控属性。TS 类型：`TreeSelectValue``type TreeSelectValue = string \| number \| Array<TreeSelectValue>`。详细类型定义 | N |

### TreeSelectEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: TreeSelectValue, level: TreeLevel) ` | 点击任何节点均会触发；level 代表当前点击的层级，0 代表最左侧，依次递进。详细类型定义。<br>`type TreeLevel = 0 \| 1 \| 2`<br> |

### TreeSelectExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-left-column | 左侧第一列样式类 |
| t-class-left-item | 左侧第一列子项样式类 |
| t-class-middle-item | 中间列子项样式类 |
| t-class-right-column | 右侧第一列样式类 |
| t-class-right-item | 右侧第一列子项样式类 |
| t-class-right-item-label | 右侧第一列子项标签样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-tree-bg-color | @bg-color-container | - |
| --td-tree-colum-text-color | @text-color-primary | - |
| --td-tree-colum-width | 206rpx | - |
| --td-tree-item-active-color | @brand-color | - |
| --td-tree-item-disabled-color | @text-color-disabled | - |
| --td-tree-item-font-size | 32rpx | - |
| --td-tree-item-height | 112rpx | - |
| --td-tree-root-bg-color | @bg-color-secondarycontainer | - |