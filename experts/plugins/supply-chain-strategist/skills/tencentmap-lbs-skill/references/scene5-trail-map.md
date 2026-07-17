## 场景五：轨迹可视化

用户有一份包含轨迹坐标的数据（JSON 格式），希望在地图上以轨迹图的形式可视化展示。使用 `tmap-lbs trail` 命令生成腾讯地图轨迹可视化链接。

**注意** 严格按照下面的步骤，不要生成代码或者调取其他脚本或者接口

### 触发条件

用户提到"轨迹"、"轨迹图"、"轨迹可视化"、"GPS 轨迹"、"运动轨迹"、"行驶轨迹"等意图，并提供了数据地址或轨迹数据。

### 命令格式

```bash
tmap-lbs trail --data <数据URL>
```

### 执行步骤

#### 第一步：获取数据地址

从用户输入中提取轨迹数据的 URL 地址。

- 如果用户提供了一个 JSON 数据的 URL 地址，直接使用
- 如果用户未提供数据地址，提示用户给出数据链接

**请求数据地址的回复模板（用户未提供时）：**

```
📍 生成轨迹图需要你提供轨迹数据地址（JSON 格式的 URL），请给出数据链接。

轨迹数据格式示例：
- 数据为 JSON 数组，每个点包含经纬度信息
- 示例地址：https://mapapi.qq.com/web/claw/trail.json
```

#### 第二步：生成链接

使用 `tmap-lbs trail` 命令生成可视化链接（工具会自动进行 URL 编码）：

```bash
tmap-lbs trail --data https://mapapi.qq.com/web/claw/trail.json
```

### 完整示例

**用户输入：** "帮我用这份数据生成轨迹图：`https://mapapi.qq.com/web/claw/trail.json`"

```bash
tmap-lbs trail --data https://mapapi.qq.com/web/claw/trail.json
```

输出：

```
📍 轨迹可视化链接:

  https://mapapi.qq.com/web/claw/trail-map.html?data=https%3A%2F%2Fmapapi.qq.com%2Fweb%2Fclaw%2Ftrail.json

数据来源: https://mapapi.qq.com/web/claw/trail.json
```

### 回复模板

```
📍 已为你生成轨迹可视化链接：

https://mapapi.qq.com/web/claw/trail-map.html?data={编码后的数据地址}

数据来源：{原始数据地址}

点击链接即可查看轨迹图展示，同时直接预览这个网页。
```
