# 需求背景：

目标：需要给舆情 Agent 加个功能 ——在涉及关键词分析的对话末尾挂载报告卡片，点击卡片可跳转至对应舆情关键词分析报告详情页

需求详情：针对get_opinion_analysis_by_topic这个tool，用户如果想查看完整的分析报告，或者对回答结果不满意/感觉深度不够时，缺少下钻途径，需要手动退出对话、进入报告后台逐项筛选条件，操作路径长、易出错，导致分析效率低

优化方案：在舆情Agent关键词分析类对话回复末尾，新增专属报告界面跳转按钮，agent侧生成short url，任务是pending。用户点击卡片时，先取到short url后再新建标签页&创建任务。实现对话内一键跳转目标报告页并自动预填筛选条件，用户点击按钮后可以直接看到深度舆情报告。

额外需求：维护一个表来支持多语种的展示文案



# 触发场景

1.  当舆情agent调用话题类/关键词类相关tool时，Agent对话界面自动触发展示固定提示文案及功能按钮，非此类场景不展示；

固定引导文案

“如需深度分析，点击按钮查看舆情系统【关键词分析报告】”


# 参数传递

Agent 侧先解析用户提问，提取并整合以下核心数据：

1.  核心维度：游戏名（分析主体）；

2.  筛选条件：关键词 / 话题集合、时间范围、区域等（限定分析范围）；

3.  辅助信息：AI 生成的 “关键词 / 话题总结词”（用于构成报告名称）、用户 ID 等基础信息；

基于上述数据生成全局唯一的 Short ID

最终，Agent 侧将Short ID + 上述所有核心数据封装为标准参数，随用户点击按钮的跳转请求，同步传递至目标舆情界面。


## 报告名称agent侧提供

结构为：[游戏名称]_[语种]_[渠道]_[AI总结词]_[时间范围]_"分析报告"（其中游戏名称和时间范围必有；AI总结词为agent总结得出；区域和渠道无涉及则不展示）

（如 “原神_日语_游戏更新_2025.01.01-2026.01.01_分析报告”）

1. 游戏名称（必传）
2. 时间（必传）
3. 语种（可选）
4. 渠道（可选）
5. ai总结词（必传）
（可选项有则加入名称，没有则不显示在名称内）
 

模块

数据来源

预填规则

字段	
交互说明

截图

筛选器条件预填



agent侧提供
（工具解析结果，优先使用关键词分析tool分析得到的字段；话题tool作为补充）

筛选器默认展开，自动填充 Agent 传递的“时间范围”、“语种”、“区域”、“渠道”（有则预填，没有则默认设置为“全部”）

1.  时间（必传）
2. 语种（可选）

3. 渠道（可选）

4. 整句情感分（可选）

5. 评论类型（可选）
（可选项有则预填，没有则默认设置为“全部”）

预填后支持手动修改

；与正常进入报告详情页的筛选器交互一致；



关键词输入框预填

agent侧提供
（工具解析结果，关键词tool的“关键词”；话题tool的“话题”）


自动填入合并后的关键词&话题（以 “；” 分隔，去重）

1. 关键词/话题合集	
填充后支持手动增删关键词；与正常进入报告详情页的关键词输入框交互一致



报告名称

agent侧提供

 

结构为：

[游戏名称]_[语种]_[渠道]_[AI总结词]_[时间范围]_"分析报告"（其中游戏名称和时间范围必有；AI总结词为agent总结得出；区域和渠道无涉及则不展示）

（如 “原神_日语_游戏更新_2025.01.01-2026.01.01_分析报告”）

1. 游戏名称（必传）
2. 时间（必传）

3. 语种（可选）

4. 渠道（可选）

5. ai总结词（必传）
（可选项有则加入名称，没有则不显示在名称内）

支持手动修改名称



选项默认勾选

固定默认勾选

1.  AI版本默认勾选“deepseek”

2.  默认勾选“高级量化总结”

 

默认	
支持手动修改勾选选项

关键词拼接语法：
支持使用【且】/【或】关系进行精准筛选。注：拓展搜索当前仅支持或搜索，即;符号的输入。
•语法示例（不区分大小写）
• Bug
内容必须提及"Bug"
• Bug;Issue | Bug,Issue
內容必须提及"Bug"或"Issue"
• Bug + Issue
内容必须同时提及“Bug”和"Issue”
• Bug + (Issue; Problem)
內容必须提及"Bug + Issue”或"Bug + Problem"
• % Bug, %
内容必须精准提及“Bug.”，支持空格和各种标点


如何获取short_url, 参考代码：

def get_short_url(
    host: str, token: str,
    game_id: str, entity_type: str, id_type: str,
    start_time: str, end_time: str, language: list,
) -> str:
    """Call agent_summary/create → parse shortid from opinion_path as short_url."""
    url = host + _AGENT_SUMMARY_PATH
    payload = {
        "message_id":          f"dsagent_opinion_{uuid.uuid4().hex}",
        "edition_unified_id":  game_id,
        "id_type":             id_type,
        "entity_type":         entity_type,
        "date_type":           "daily",
        "start_time":          start_time,
        "end_time":            end_time,
        "language":            language,
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(url, json=payload, headers=_headers(token))
        if not resp.is_success:
            print(f"[ERROR] agent_summary/create HTTP {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
            resp.raise_for_status()
        data = resp.json()
    if data.get("code") != 0:
        print(f"[ERROR] agent_summary/create failed: {data}", file=sys.stderr)
        sys.exit(1)
    opinion_path = data["data"]["opinion_path"]
    params = parse_qs(urlparse(opinion_path).query)
    short_url = params.get("shortid", [""])[0]
    if not short_url:
        raise RuntimeError(f"shortid not found in opinion_path: {opinion_path}")
    print(f"[INFO] short_url={short_url}  path={opinion_path}", file=sys.stderr)
    return short_url 


接口文档：
agent_summary/create

gc_liangxinzhou
更新于 
02 月 10 日
·
gc_liangxinzhou
创建于 
02 月 10 日
·
ID #12289
Agent Summary 创建接口文档
接口概览
项目	说明
接口名称	临时创建 Summary
请求方式	POST
接口路径	api/v1/opinion_pc/agent_summary/create
接口描述	根据过滤条件临时创建 Summary，生成带短链的分析页面访问地址
请求参数
请求头 (Headers)
参数名	类型	必填	说明
Content-Type	string	是	固定值：application/json
Authorization	string	是	Bearer Token，用户认证令牌
请求体 (Body)
基础信息参数
参数名	类型	必填	验证规则	说明
message_id	string	否	required	消息ID，调用方传递的唯一标识
edition_unified_id	string	是	required, companyIdValidation	游戏统一ID（公司ID验证）
id_type	string	是	required, gsv	ID类型：unified_id 或 edition_id
entity_type	string	否	gsv	实体类型：pc、mobile、console
时间参数
参数名	类型	必填	验证规则	说明
date_type	string	否	gsv	时间类型：hourly、daily、weekly、monthly
start_time	string	否	datetime=2006-01-02 15:04:05	开始时间，格式：2024-01-15 00:00:00
end_time	string	否	datetime=2006-01-02 15:04:05	结束时间，格式：2024-01-15 23:59:59
语种参数
参数名	类型	必填	验证规则	说明
language	[]string	否	dive, keywordValidation	语种列表，如 ["en", "zh", "ja"]
渠道参数
参数名	类型	必填	验证规则	说明
channel	[]string	否	dive, gsv	渠道列表，如 ["twitter", "youtube", "reddit"]
channel_type	string	否	gsv	渠道类型：comments、social、news
地区参数
参数名	类型	必填	验证规则	说明
region_type	string	否	gsv	地区类型：market（国家）或 region（地区）
region	[]string	否	dive, gsv	国家或地区列表，取决于 region_type
话题参数
参数名	类型	必填	验证规则	说明
topic	[]string	否	dive, topicValidation	话题标签列表，如 ["gameplay", "bug", "update"]
关键词过滤参数 (CommonKeywordFilter)
参数名	类型	必填	验证规则	说明
keyword_input	string	否	dive	关键词列表
图片

响应参数
成功响应 (HTTP 200)
参数名	类型	说明
code	int	状态码，0 表示成功
message	string	状态描述
data	object	响应数据
data.message_id	string	消息ID，与请求中的 message_id 一致，用于请求追踪
data.opinion_path	string	AI分析页面访问路径（包含游戏ID和短链ID）
data.ok	bool	操作是否成功
错误响应
HTTP状态码	错误码	说明
400	参数错误	请求参数验证失败
401	未授权	Token无效或过期
500	系统错误	服务器内部错误
参数详细说明
1. 游戏相关参数
edition_unified_id
用途：标识要查询的游戏
格式：公司ID格式，由系统分配
示例："company_123456"
id_type
用途：指定 edition_unified_id 的类型
可选值：
unified_id：统一ID
edition_id：版本ID
entity_type
用途：指定游戏平台类型
可选值：
pc：PC端
mobile：移动端
console：主机端
2. 时间相关参数
date_type
用途：指定数据聚合的时间粒度
可选值：
hourly：按小时
daily：按天
weekly：按周
monthly：按月
start_time / end_time
格式：YYYY-MM-DD HH:MM:SS
时区：服务器本地时间
示例："2024-01-01 00:00:00"
请求示例
示例 1：基础查询（最小必填参数）
curl -X POST 'https://api.example.com/api/agent_summary/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_token_here' \
  -d '{
    "message_id": "msg_001_20240115",
    "edition_unified_id": "game_12345",
    "id_type": "unified_id"
  }'
示例 2：带时间范围和语种的查询
curl -X POST 'https://api.example.com/api/agent_summary/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_token_here' \
  -d '{
    "message_id": "msg_002_20240115",
    "edition_unified_id": "game_12345",
    "id_type": "unified_id",
    "entity_type": "mobile",
    "date_type": "daily",
    "start_time": "2024-01-01 00:00:00",
    "end_time": "2024-01-15 23:59:59",
    "language": ["en", "zh", "ja"]
  }'
示例 3：带关键词过滤的查询
curl -X POST 'https://api.example.com/api/agent_summary/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_token_here' \
  -d '{
    "message_id": "msg_003_20240115",
    "edition_unified_id": "game_12345",
    "id_type": "unified_id",
    "start_time": "2024-01-01 00:00:00",
    "end_time": "2024-01-15 23:59:59",
    "keyword_input": "bug|Issue"
  }'
示例 4：完整参数查询
curl -X POST 'https://api.example.com/api/agent_summary/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your_token_here' \
  -d '{
    "message_id": "msg_004_20240115",
    "edition_unified_id": "game_12345",
    "id_type": "unified_id",
    "entity_type": "mobile",
    "date_type": "daily",
    "start_time": "2024-01-01 00:00:00",
    "end_time": "2024-01-15 23:59:59",
    "language": ["en", "zh", "ja", "ko"],
    "channel": ["twitter", "youtube", "reddit", "bilibili"],
    "channel_type": "social",
    "region_type": "market",
    "region": ["US", "CN", "JP", "KR"],
    "topic": ["gameplay", "update", "event"],
     "keyword_input": "bug|Issue"
  }'
响应示例
成功响应
{
  "code": 0,
  "message": "success",
  "data": {
    "message_id": "msg_001_20240115",
    "opinion_path": "/v2/opinion/AIAnalysisHub/KeywordAnalysis?gameid=game_12345&shortid=abc123xyz",
    "ok": true
  }
}
参数错误响应
{
  "code": 400,
  "message": "参数验证失败: edition_unified_id 不能为空",
  "data": null
}
系统错误响应
{
  "code": 500,
  "message": "系统异常",
  "data": {
    "message_id": "msg_001_20240115",
    "opinion_path": "",
    "ok": false
  }
}
页面访问路径说明
成功创建 Summary 后，返回的 opinion_path 是一个相对路径，需要拼接域名前缀访问：

完整URL = https://your-domain.com + opinion_path

例如：
https://your-domain.com/v2/opinion/AIAnalysisHub/KeywordAnalysis?gameid=game_12345&shortid=abc123xyz
路径参数说明：

gameid：游戏统一ID
shortid：生成的短链ID，包含了所有过滤条件的编码信息
注意事项
必填参数：message_id、edition_unified_id、id_type 必须提供
时间格式：start_time 和 end_time 必须使用 YYYY-MM-DD HH:MM:SS 格式
关键词逻辑：
keywords_list 外层是 OR 关系，内层是 AND 关系
数组验证：所有数组类型的参数都需要通过 dive 验证器验证每个元素
短链有效期：生成的短链长期有效，可以多次访问
权限控制：需要有效的 Bearer Token 才能访问该接口


message_id: str | None = ""  # 用于传参
获取方式 projects/databrain_host/context/game_context.py 

edition_unified_id	string	是	required, companyIdValidation	游戏统一ID（公司ID验证）
获取方式 _ensure_game_id的返回结果

language：
展示文案的语言 projects/databrain_host/context/game_context.py

