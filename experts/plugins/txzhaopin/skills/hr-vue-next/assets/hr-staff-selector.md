# HrStaffSelector 员工选择器

## 组件说明

用于选择员工，涉及的数据源均为远程数据。提供3种方式选择员工，用 Tag 展示已选员工：

1. 输入关键字搜索，使用下拉菜单展示筛选后的员工
2. 点击右侧按钮打开弹窗，懒加载员工树选择
3. 将 `staffName;staffName;` 或者 `staffName\nstaffName` (`\n`代表回车) 形式的字符串粘贴进输入框，从服务器获取对应员工项

> 提醒: 请避免在选择后动态改变选择器的宽度，这会造成 Tag 区域样式显示问题

## 基础用法

适用广泛的基础选择，提供3种方式选择员工，用 Tag 展示已选员工。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <div class="demonstration">单选模式</div>
      <hr-staff-selector v-model="value1" selectClass="selectClass" modalClass="modalClass" showFullTag></hr-staff-selector>
    </div>
    <div class="block">
      <div class="demonstration">多选模式</div>
      <hr-staff-selector
        multiple
        v-model="value2"
        :includeDimission="true"
        :includeOnBoarding="true"
        :includePartTimePost="true"
      ></hr-staff-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
</script>

<style lang="less" scoped>

</style>
```

## 设置初始选中项

由于选择器所需的员工选项至少需要包含 `staffId`、`staffName` 等属性，而本地没有完整的员工数据，因此不能简单通过修改 `v-model` 值来设置初始选择项。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-staff-selector ref="selector1" v-model="value1" @change="change" />
    </div>
    <div class="block">
      <hr-staff-selector ref="selector2" :props="myProps" multiple v-model="value2" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const selector1 = ref(null);
const selector2 = ref(null);
const myProps = ref({
  staffName: 'name',
  staffId: 'id',
});
const change = (val) => {
  console.log(val, value1.value);
};
onMounted(() => {
  const initial1 = [{ staffName: 'shanzhang(张三)', staffId: 123456 }];
  selector1.value.setSelected(initial1);
  const initial2 = [{ name: 'lizhang(李四)', id: 654321 }];
  selector2.value.setSelected(initial2);
});
</script>

<style lang="scss" scoped></style>
```

## 限制选项范围

用于仅提供某组织下的员工选择。

> 提醒: 动态切换组织时，已有选项需手动调用方法清空（考虑与组织选择器联动和数据回显等场景，选择器不会主动对已有选项做处理）

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-staff-selector
        v-model="value1"
        :range="range1"
        placeholder="请选择"
        :defaultExpandedKeys="[4791]"
      ></hr-staff-selector>
    </div>
    <div class="block">
      <hr-staff-selector
        v-model="value2"
        :range="range2"
        placeholder="请选择"
        :defaultExpandedKeys="[4791]"
      ></hr-staff-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const range1 = ref({
  unitId: 4791, // 根组织Id
  contractCompanyIdList: [2], // 合同主体公司的Id
  isContainSubStaff: true, // 展示下级组织及员工
  managerPositionLevelIdList: [61], // 限制职级Id集合
});
const value2 = ref([]);
const range2 = ref({
  unitId: 4791, // 根组织Id
  isContainSubStaff: true, // 展示下级组织及员工
  staffTypeIdList: [9], // 员工类型
});
</script>

<style lang="less" scoped></style>
```

## 曾用名查询

模糊查询包含曾用名。

> 提醒: 模糊查询时，搜索曾用名只支持英文名搜索，搜索现用名支持英文+(中文)

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-staff-selector v-model="value" useFormerNameSearch placeholder="请选择"></hr-staff-selector>
    </div>
    <div class="block">
      <hr-staff-selector v-model="value2" useFormerNameSearch timeliness="T1" placeholder="请选择"></hr-staff-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref();
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 文本域

用于多行展示被选择的员工，通过设置 `textarea` 属性启用, 也可通过设置 `textareaModel` 属性启用。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-staff-selector v-model="value" :height="170" textarea multiple placeholder="请选择"></hr-staff-selector>
    </div>
    <div class="block">
      <hr-staff-selector v-model="value2" :height="170" textareaModel multiple placeholder="请选择"></hr-staff-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref();
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了 **medium**、**small** 尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block size-block">
      <span class="demonstration">默认尺寸</span>
      <hr-staff-selector v-model="value1"></hr-staff-selector>
    </div>
    <div class="block size-block">
      <span class="demonstration">中等尺寸</span>
      <hr-staff-selector size="medium" v-model="value2"></hr-staff-selector>
    </div>
    <div class="block size-block">
      <span class="demonstration">小尺寸</span>
      <hr-staff-selector size="small" v-model="value3"></hr-staff-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const value3 = ref('');
</script>

<style lang="less" scoped></style>
```

## 失焦不清除输入值

可通过 `blurClearInputValue` 属性设置失焦不清除输入值。

```vue
<template>
  <div class="example_init_box">
    <hr-staff-selector v-model="value" :blurClearInputValue="false" placeholder="请选择" ref="staff"></hr-staff-selector>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);
</script>

<style lang="less" scoped></style>
```

## 弹窗插入到body中

可通过 `modalAppendToBody` 属性设置弹窗插入位置。默认 `false`，设置为 `true` 时，弹窗会插入到 body 中。

```vue
<template>
  <div class="example_init_box">
    <hr-staff-selector v-model="value" modalAppendToBody />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref('');
</script>

<style lang="less" scoped></style>
```

## 数据源

员工数据均从远程服务器获取，内置了4个默认数据源接口方法满足选择器的功能需求。用户如需替换自己的数据源，需按规范定义接口方法和数据结构，通过4个对应的属性传入 `Function`。

每个 `Function` 接受一个输入参数用于指明需获取的员工数据，返回一个 `Promise` 对象。除 `getTreeData` 以外，完成状态的结果值为包含**员工对象**的**数组**，**员工对象**至少包含 `{ staffName, staffId, avatar(建议) }` 三个属性。

- **`getDataList`** 用于输入关键字筛选员工的场景。输入参数为一个 `String` 类型的关键字字符串
- **`getPasteResult`** 用于粘贴姓名选择员工的场景。输入参数为一个 `String` 类型的 `staffName;staffName;` 或者 `staffName\nstaffName` 形式的字符串
- **`getTreeData`** 用于点击员工树中的组织节点，懒加载其子节点的场景。输入参数为一个能指明组织的 `unitId`，初始获取第一级节点时，输入的 `unitId` 为 `0`。Promise 完成状态的结果值为包含 `{ staff, unit }` 属性的对象
- **`getChildrenData`** 用于点击员工树中组织节点的多选框，批量选择员工的场景。输入参数为一个能指明组织的 `unitId`

```vue
<template>
  <div class="example_init_box">
    <hr-staff-selector
      v-model="value"
      multiple
      modalWidth="1000px"
      :getDataList="customGetDataList"
      :getPasteResult="customGetPasteResult"
      :getTreeData="customGetTreeData"
      :getChildrenData="customGetChildrenData"
    >
    </hr-staff-selector>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);
const remoteData = ref([
  { staffName: 'fourli(李四)', staffId: 288888 },
  { staffName: 'fivewang(王五)', staffId: 123321 },
  { staffName: 'sixzhao(赵六)', staffId: 666666 },
  { staffName: 'sevenchen(陈七)', staffId: 233333 },
  { staffName: 'ninelin(林九)', staffId: 111111 },
]);
/**
 * @method 模糊搜索对应的员工
 * @param {String} name 关键字字符串
 * @returns 返回带有员工列表数据的promise
 */
const customGetDataList = (name) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    data = remoteData.value.filter((item) => item.staffName.indexOf(name) !== -1);
    resolve(data);
  });
};
/**
 * @method 粘贴员工姓名字符串获取对应的员工
 * @param {String} nameString 一个以上员工姓名组成的字符串
 * @returns 返回带有员工列表数据的promise
 */
const customGetPasteResult = (nameString) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    const names = nameString.split(';');
    data = remoteData.value.filter((item) => names.includes(item.staffName));
    resolve(data);
  });
};
/**
 * @method 根据组织Id获取该组织下的子级组织、子级员工列表
 * @param {String} unitId 组织Id
 * @returns 返回带有组织、员工列表数据的promise
 */
const customGetTreeData = (unitId) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    if (unitId === 0) {
      data = {
        unit: [
          { unitId: 1, unitName: '组织一' },
          { unitId: 2, unitName: '组织二' },
        ],
      };
    }
    if (unitId === 1) {
      data = {
        staff: [
          { staffName: 'fourli(李四)', staffId: 288888 },
          { staffName: 'fivewang(王五)', staffId: 123321 },
        ],
        unit: [{ unitId: 3, unitName: '组织三' }],
      };
    }
    if (unitId === 2) {
      data = {
        staff: [
          { staffName: 'sevenchen(陈七)', staffId: 233333 },
          { staffName: 'ninelin(林九)', staffId: 111111 },
        ],
      };
    }
    if (unitId === 3) {
      data = {
        staff: [{ staffName: 'sixzhao(赵六)', staffId: 666666 }],
      };
    }
    resolve(data);
  });
};
/**
 * @method 根据组织Id获取该组织下子级员工列表
 * @param {String} unitId 组织Id
 * @returns 返回带有员工列表数据的promise
 */
const customGetChildrenData = (unitId) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    if (unitId === 1) {
      data = [
        { staffName: 'fourli(李四)', staffId: 288888 },
        { staffName: 'fivewang(王五)', staffId: 123321 },
        // { staffName: 'sixzhao(赵六)', staffId: 666666 }
      ];
    }
    if (unitId === 2) {
      data = [
        { staffName: 'sevenchen(陈七)', staffId: 233333 },
        { staffName: 'ninelin(林九)', staffId: 111111 },
      ];
    }
    if (unitId === 3) {
      data = [{ staffName: 'sixzhao(赵六)', staffId: 666666 }];
    }
    resolve(data);
  });
};
</script>

<style lang="less" scoped></style>
```

## API

### 属性 (Props)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 绑定值 | String / Number / Array | — | — |
| multiple | 是否多选 | Boolean | — | false |
| width | 输入框宽度 | String / Number | — | — |
| size | 输入框尺寸 | String | medium / small | — |
| search | 是否模糊搜索 | Boolean | — | true |
| disabled | 是否禁用 | Boolean | — | false |
| textarea | 文本框 (上下布局) | Boolean | — | false |
| textareaModel | 文本框 (左右布局) | Boolean | — | false |
| height | 文本框高度 | Number / String | — | 130 |
| showTotal | 多选且非textarea模式下，是否显示后置的已选数量 | Boolean | — | true |
| showFullTag | 是否在输入框中展示完整的tag | Boolean | — | false |
| placeholder | 占位符 | String | — | — |
| selectClass | 选择框自定义类名 | String | — | — |
| modalClass | 弹窗自定义类名 | String | — | — |
| modalWidth | 弹窗自定义宽度 | String | 参考Modal弹窗组件width | '750px' |
| modalAppendToBody | 弹窗自身是否插入至 body 元素上 | Boolean | — | false |
| includeDimission | 是否包含离职员工 | Boolean | — | false |
| includeOnBoarding | 是否包含待入职员工 | Boolean | — | false |
| includePartTimePost | 是否显示组织下的兼岗员工 | Boolean | — | false |
| useFormerNameSearch | 是否使用曾用名搜索 | Boolean | — | false |
| timeliness | 曾用名搜索获取数据的时效性，T0代表T+0，T1代表T+1 | String | T0 / T1 | T0 |
| defaultExpandedKeys | 一级默认展开的节点的unitId的数组 | Array | — | [] |
| range | 限制选项范围，具体见下表 | Object | — | — |
| props | 数据字段别名，具体见下表 | Object | — | — |
| blurClearInputValue | 失焦时清除输入值 | Boolean | — | true |
| getDataList | 通过关键字获取对应员工的方法 | Function | — | — |
| getPasteResult | 通过姓名字段串获取对应员工的方法 | Function | — | — |
| getTreeData | 通过组织标识获取其子组织、子员工的方法 | Function | — | — |
| getChildrenData | 通过组织标识获取其下所有员工的方法 | Function | — | — |
| titleTip | 弹窗标题旁提示文字 | String | — | — |

### range 限制选项范围配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| unitId | 组织Id, 仅选择该组织下的子级员工, 会先查对应的组织 | Number / Array | — | - |
| contractCompanyIdList | 合同公司Id集合, 仅选择该合同下的员工 | Array | — | - |
| manageUnitIdList | 管理主体Id集合, 仅选择该管理主体下的员工 | Array | — | - |
| isContainSubStaff | 是否包含子级员工 | Boolean | — | false |
| managerPositionLevelIdList | 职级Id集合，仅选择对应职级的员工 | Array | — | - |
| staffTypeIdList | 员工类型Id集合, 仅选择该员工类型的员工 | Array | — | - |

### props 字段别名配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| staffId | 员工Id字段名 | String | — | 'staffId' |
| staffName | 员工姓名字段名 | String | — | 'staffName' |
| engName | 员工英文名字段名 | String | — | 'engName' |
| avatar | 员工头像字段名 | String | — | 'avatar' |
| unitId | 组织Id字段名 | String | — | 'unitId' |
| unitName | 组织名称字段名 | String | — | 'unitName' |
| unitFullName | 组织全路径字段名 | String | — | 'unitFullName' |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项 |
