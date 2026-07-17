---
name: tencentmap-lbs-skill
description: "腾讯地图位置服务，支持POI搜索、路径规划、旅游规划、周边搜索，轨迹数据可视化和地图数据可视化。⚠️ 强制行为：本 Skill 加载后，第一个动作必须是检查是否存在正式 Key（环境变量 TMAP_WEBSERVICE_KEY 或用户已在对话中提供）。若已有正式 Key，直接继续处理用户请求。若没有正式 Key，必须立即向用户展示 Key 选择提示（正式 Key 注册引导 + 预设体验 Key 选项），然后停止等待用户选择，不得在用户选择之前进行任何分析、读取文件、规划方案或编写代码的操作。"
description_zh: "腾讯地图位置服务，支持POI搜索、路径规划、旅游规划、周边搜索，轨迹数据可视化和地图数据可视化"
description_en: "Tencent Maps LBS for POI search, routing, travel planning, and trail maps"
version: 1.0.0
homepage: https://lbs.qq.com/service/webService/webServiceGuide/webServiceOverview
metadata:
  clawdbot:
    emoji: "🗺️"
    requires:
      env:
        - TMAP_WEBSERVICE_KEY
      bins:
        - tmap-lbs
    install:
      - package-manager: npm
        command: "npm install -g @tencent-map/lbs-skills"
---

# 腾讯地图位置服务 Skill

腾讯地图位置服务向开发者提供完整的地图数据服务，包括周边搜索，地点搜索、路径规划、旅游规划等功能。

## Requirements

### tmap-lbs

第一次使用如果没有安装 tmap-lbs，请先安装 tmap-lbs, 如果用户需要更新，也是同样的命令。

```bash
npm install @tencent-map/lbs-skills -g
```

### 前置检查：API Key

#### 检查步骤

1. 检查是否已有正式 Key（通过 `tmap-lbs config get-key` 检查、环境变量 `TMAP_WEBSERVICE_KEY` 或用户已在对话中提供）

2. **情况 A：已检测到正式 Key**

   静默记录 Key，**直接按用户原始意图继续处理，无需任何提示或打断**。

3. **情况 B：未检测到正式 Key**

> ⛔ **强制拦截（最高优先级）**
>
> 未检测到正式 Key 时，**在用户明确完成选择之前**，禁止执行以下任何操作：
> - 分析用户需求
> - 读取任何文件或文档
> - 规划实现方案
> - 编写任何代码
> - 调用任何 API
>
> **第一步且唯一的步骤是：立即输出下方选择提示，然后停止，等待用户回应。**

   输出以下内容，然后**停止，等待用户选择**：

   > ⚠️ 您当前尚未配置正式 Key，请先选择您的使用方式：
   >
   > **推荐：前往官网注册申请正式 Key，享受完整、稳定的服务**
   > 👉 https://lbs.qq.com/dev/console/key/manage
   > 注册后可通过以下方式配置：
   > - 命令行：`tmap-lbs config set-key <你的Key>`
   > - 环境变量：`export TMAP_WEBSERVICE_KEY=<你的Key>`
   > 或在对话中直接告知我来配置。
   >
   > ---
   >
   > 或者，您也可以选择使用腾讯位置服务平台提供的预设体验 Key（免注册，直接使用）。
   > 请注意腾讯位置服务体验 Key 的限制：
   > - 访问频次上限：调用频次受限，超出后触发限流
   > - 数据稳定性一般，不建议用于生产环境
   > - 电动车路线等接口不可用
   >
   > **请告诉我您的选择：**
   > - 回复"我已有 Key"或直接提供 Key → 切换正式模式
   > - 回复"使用体验 Key" → 以腾讯位置服务受限模式继续

   收到用户明确回复后，再按用户选择继续：
   - 用户提供正式 Key → 通过 `tmap-lbs config set-key <key>` 配置或记录 Key，切换正式模式，继续处理请求
   - 用户选择体验 Key → 切换体验模式，继续处理请求（见下方"体验模式调用规则"）

#### 体验模式调用规则

**判断原则：只有"不需要透传用户 Key"的接口才可以走体验模式。** 需要透传用户 Key 的接口，体验模式无法支持，须要求用户配置正式 Key 后再调用。

体验模式下，按以下规则替换请求参数：
- **域名**：将 `https://apis.map.qq.com` 替换为 `https://h5gw.map.qq.com`
- **Key 参数**：设置 `key=none`
- **apptag 参数**：根据接口路径查下方对照表，填入对应 apptag 值

> ⚠️ **体验模式存在 CORS 跨域限制**
>
> `h5gw.map.qq.com` 不允许浏览器端直接 `fetch`（包括 localhost 开发环境）。
> **体验模式必须使用 JSONP 方式调用**，在请求中附加 `output=jsonp&callback=函数名` 参数，通过动态插入 `<script>` 标签发起请求。腾讯位置服务 WebService API 原生支持 JSONP 回调。
>
> ```javascript
> // ✅ 体验模式：JSONP 方式（浏览器端可用）
> function jsonpRequest(url, params, callback) {
>   const cbName = 'tmap_cb_' + Date.now();
>   params.output = 'jsonp';
>   params.callback = cbName;
>   const query = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
>   window[cbName] = (data) => { delete window[cbName]; script.remove(); callback(data); };
>   const script = document.createElement('script');
>   script.src = `${url}?${query}`;
>   document.head.appendChild(script);
> }
>
> // 示例：体验模式地理编码
> jsonpRequest('https://h5gw.map.qq.com/ws/geocoder/v1', {
>   address: '北京西站',
>   key: 'none',
>   apptag: 'lbs_geocoder'
> }, (res) => console.log(res));
> ```
>
> ❌ **不建议在正式 Key 模式下使用 JSONP**：JSONP 会将 Key 明文暴露在前端代码中，存在 Key 泄露风险。正式 Key 应通过 `tmap-lbs` CLI 或**服务端代理**转发请求，避免在浏览器端直接调用。

**apptag 对照表：**

| 接口路径 | apptag | 对应场景 |
|---|---|---|
| `/ws/geocoder/v1` | `lbs_geocoder` | 场景一、四（地理编码） |
| `/ws/place/v1/search` | `lbsplace_search` | 场景一、二（POI 搜索） |
| `/ws/place/v1/explore` | `lbsplace_explore` | 场景一（周边搜索） |
| `/ws/direction/v1/driving` | `lbsdirection_driving` | 场景三（驾车路线） |
| `/ws/direction/v1/walking` | `lbsdirection_walking` | 场景三（步行路线） |
| `/ws/direction/v1/bicycling` | `lbsdirection_bicycling` | 场景三（骑行路线） |
| `/ws/direction/v1/transit` | `lbsdirection_transit` | 场景三（公交路线） |

**体验模式不可用的接口**（这些接口需要透传用户自己的 Key，体验模式无法支持）：
- `/ws/direction/v1/ebicycling/`（电动车路线）

当用户在体验模式下请求以上不可用接口时，回复以下内容并停止，等待用户选择：

> ⚠️ 您当前请求的「电动车路线」功能在体验模式下不可用，需要配置正式 Key 才能调用。
> 请前往官网申请正式 Key → https://lbs.qq.com/dev/console/key/manage
> 申请后告知我您的 Key，即可切换正式模式继续使用。

**每次体验模式 API 调用返回结果后，必须在回复末尾追加以下提醒（每次都要加，不可省略）：**

> 📌 温馨提示：当前使用的是腾讯位置服务预设体验 Key，数据稳定性和调用频次均受限。建议尽快申请腾讯位置服务正式 Key → https://lbs.qq.com/dev/console/key/manage

**体验模式下的场景处理说明：**
- **场景五（轨迹可视化）**：不需要 API Key，体验模式下正常使用 `tmap-lbs trail` 命令即可，无需走体验模式 HTTP 请求。

## 功能特性

- 搜索
  - 支持关键词和 POI 搜索功能
  - 支持基于中心点坐标和半径周边搜索
- 规划
  - 旅行日程规划
  - 路径规划（步行、驾车、骑行、公交）
- 数据可视化
  - 地图数据可视化
  - 轨迹数据可视化展示

当用户想要搜索地址、地点、周边信息（如美食、酒店、景点等）、规划路线时，使用此 skill。

## 触发条件

用户表达了以下意图之一：

- 搜索某类地点或某个确定地点（比如"故宫在哪"，"搜酒店"、"找加油站"）
- 基于某个位置搜索周边（如"奥林匹克公园周边美食"、"北京西站附近的加油站"）
- 包含"搜"、"找"、"查"、"附近"、"周边"、"路线"、"规划"等关键词
- 旅游规划（如"帮我规划北京一日游"、"杭州西湖游览路线"）
- 规划路线（如"从故宫到南锣鼓巷怎么走"、"规划一条骑行路线"）
- 轨迹可视化（如"帮我生成轨迹图"、"上传轨迹数据"、"GPS 轨迹展示"）

## 场景判断

收到用户请求后，先判断属于哪个场景：

- **场景一**：用户搜索**某个位置周边或者附近**的某类地点，输入中同时包含「位置」和「搜索类别或者 POI 类型」两个要素（如"西直门周边美食"、"北京南站附近酒店", "搜索亚洲金融大厦附近的奶茶店"）
- **场景二**：POI 详细搜索（使用 Web 服务 API）
- **场景三**：路径规划
- **场景四**：旅游规划
- **场景五**：轨迹可视化（用户提供了轨迹数据地址，想生成轨迹图）

---

## 场景一：基于位置的周边或者附近搜索

用户想搜索**某个位置周边或者附近**的某类地点。需要先通过地理编码 API 获取该位置的经纬度，再拼接带坐标的搜索链接。

> 📖 匹配到此场景后，**必须先读取** `references/scene1-nearby-search.md` 获取详细的执行步骤、API 格式、完整示例和回复模板，严格按照文档中的步骤执行。

---

## 场景二：POI 详细搜索

使用腾讯地图 tmap-lbs 进行 POI 搜索，支持关键词搜索、城市限定、周边搜索等。

> 📖 详细的格式、参数说明和返回数据格式请参考 [references/scene2-poi-search.md](references/scene2-poi-search.md)

---

## 场景三：路径规划

使用腾讯地图 tmap-lbs 规划路线。支持步行、驾车、骑行（自行车）、电动车、公交等多种出行方式。

> 📖 详细的格式、各出行方式的 API 端点、参数说明和返回数据格式请参考 [references/scene3-route-planning.md](references/scene3-route-planning.md)

---

## 场景四：旅游规划

用户想去某个城市旅游，提供了多个想去的景点，需要规划最佳行程路线，并可选推荐餐厅、酒店等。需要先通过地理编码 API 获取各景点的经纬度，再拼接旅游规划链接。

> 📖 匹配到此场景后，**必须先读取** `references/scene4-travel-planner.md` 获取详细的执行步骤、API 格式、完整示例和回复模板，严格按照文档中的步骤执行。

---

## 场景五：地图数据可视化

当用户有一份包含轨迹坐标的数据，希望在地图上以轨迹图的形式可视化展示。不需要 API Key。

## 触发条件

用户提到"轨迹"、"轨迹图"、"轨迹可视化"、"GPS 轨迹"、"运动轨迹"、"行驶轨迹"等意图，并提供了数据地址或轨迹数据。

> 📖 匹配到此场景后，**必须先读取** `references/scene5-trail-map.md` 获取详细的 URL 格式、执行步骤、完整示例和回复模板，严格按照文档中的步骤执行。

---

## 注意事项

- **场景判断是关键**：区分用户是"直接搜某个东西"、"在某个位置附近搜某个东西"、"规划路线"还是"旅游规划"
- 关键词应尽量精简准确，提取用户真正想搜的内容
- URL 中的中文关键词浏览器会自动处理编码，无需手动 encode
- 腾讯地图坐标格式为 `纬度,经度`（注意：纬度在前，经度在后）
- 如果 API 返回 `status` 不为 `0`，说明请求失败，需提示用户检查地址是否有效
- API Key 请妥善保管，切勿分享给他人

## 文档引用（references）

各场景的详细操作文档存放在 `references/` 目录下：

| 文件                                                                       | 说明                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [references/scene1-nearby-search.md](references/scene1-nearby-search.md)   | 场景一：周边/附近搜索 — 执行步骤、API 格式、完整示例、回复模板 |
| [references/scene2-poi-search.md](references/scene2-poi-search.md)         | 场景二：POI 详细搜索 — 请求格式、参数说明、返回数据格式        |
| [references/scene3-route-planning.md](references/scene3-route-planning.md) | 场景三：路径规划 — 请求格式、API 端点、参数和返回数据说明      |
| [references/scene4-travel-planner.md](references/scene4-travel-planner.md) | 场景四：旅游规划 — 使用方法、功能说明                          |
| [references/scene5-trail-map.md](references/scene5-trail-map.md)           | 场景五：轨迹可视化 — URL 格式、执行步骤、完整示例、回复模板    |

---

## 相关链接

- [腾讯位置服务](https://lbs.qq.com/)
- [Web 服务 API 总览](https://lbs.qq.com/service/webService/webServiceGuide/webServiceOverview)
