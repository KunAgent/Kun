# 全国 31 省（自治区/直辖市）教育考试院官网映射

> 用途：免责声明文案中"具体填报事项请前往 {省份} 教育考试院官网（{URL}）查看和操作"的占位符替换源。
> 维护规则：URL 由 AI 在生成免责声明时根据用户阶段一选择的省份动态查表替换；如发现失效或迁移，运行时以官方最新公告为准并同步更新此表。
> 取数时效：本表为长期稳定字段，但官网域名/路径偶有调整，使用前如可联网应做一次有效性校验。

| 省份 | 官方机构名称 | 官网 URL |
| --- | --- | --- |
| 北京 | 北京教育考试院 | https://www.bjeea.cn/ |
| 天津 | 天津市教育招生考试院 | http://www.zhaokao.net/ |
| 上海 | 上海市教育考试院 | https://www.shmeea.edu.cn/ |
| 重庆 | 重庆市教育考试院 | https://www.cqksy.cn/ |
| 河北 | 河北省教育考试院 | http://www.hebeea.edu.cn/ |
| 山西 | 山西招生考试网 | http://www.sxkszx.cn/ |
| 辽宁 | 辽宁省招生考试之窗 | https://www.lnzsks.com/ |
| 吉林 | 吉林省教育考试院 | http://www.jleea.com.cn/ |
| 黑龙江 | 黑龙江省招生考试信息港 | https://www.lzk.hl.cn/ |
| 江苏 | 江苏省教育考试院 | https://www.jseea.cn/ |
| 浙江 | 浙江省教育考试院 | https://www.zjzs.net/ |
| 安徽 | 安徽省教育招生考试院 | https://www.ahzsks.cn/ |
| 福建 | 福建省教育考试院 | https://www.eeafj.cn/ |
| 江西 | 江西省教育考试院 | http://www.jxeea.cn/ |
| 山东 | 山东省教育招生考试院 | https://www.sdzk.cn/ |
| 河南 | 河南省教育考试院 | http://www.haeea.cn/ |
| 湖北 | 湖北省教育考试院 | http://www.hbea.edu.cn/ |
| 湖南 | 湖南省教育考试院 | https://www.hneao.edu.cn/ |
| 广东 | 广东省教育考试院 | https://eea.gd.gov.cn/ |
| 广西 | 广西招生考试院 | https://www.gxeea.cn/ |
| 海南 | 海南省考试局 | http://ea.hainan.gov.cn/ |
| 四川 | 四川省教育考试院 | https://www.sceea.cn/ |
| 贵州 | 贵州省招生考试院 | http://zsksy.guizhou.gov.cn/ |
| 云南 | 云南省招生考试院 | https://www.ynzs.cn/ |
| 陕西 | 陕西省教育考试院 | http://www.sneac.com/ |
| 甘肃 | 甘肃省教育考试院 | https://www.ganseea.cn/ |
| 青海 | 青海省教育考试网 | http://www.qhjyks.com/ |
| 宁夏 | 宁夏教育考试院 | https://www.nxjyks.cn/ |
| 新疆 | 新疆招生网 | http://www.xjzk.gov.cn/ |
| 内蒙古 | 内蒙古自治区教育招生考试中心 | https://www.nm.zsks.cn/ |
| 西藏 | 西藏自治区教育考试院 | http://zsks.edu.xizang.gov.cn/ |

## AI 替换规则

生成免责声明时：

1. 读取阶段一 A 卡中用户选择的"高考省份"字段，得到省份名称（如"广东"）。
2. 在本表中查找对应行，取出"官方机构名称"和"官网 URL"两个字段。
3. 替换免责声明模板中的占位符：
   - `{省份}` → 用户省份（如"广东省"，注意自动补"省/市/自治区"）
   - `{考试院全称}` → 表中"官方机构名称"（如"广东省教育考试院"）
   - `{考试院URL}` → 表中"官网 URL"
4. 直辖市（北京/天津/上海/重庆）拼接时用"市"；自治区（内蒙古/广西/西藏/宁夏/新疆）用"自治区"；其他用"省"。

## 失效处理

- 若校验发现链接 404 / 域名迁移：在文案中改用 `{考试院全称}（请通过搜索引擎获取最新官网）` 占位，并向用户提示"该省考试院官网可能已变更，请以搜索引擎检索到的最新官网为准"。
- 切勿编造已失效或不存在的 URL。
