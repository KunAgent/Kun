from enum import Enum


class DashboardType(Enum):
    Dashboard_1 = "dashboard_1"
    Dashboard_2 = "dashboard_2"
    Dashboard_3 = "dashboard_3"
    Dashboard_4 = "dashboard_4"


DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

HISTORY_TABLE = "t_databrain_agent_history"
SESSION_TABLE = "t_databrain_agent_session"
SNAPSHOT_TABLE = "t_databrain_agent_snapshot"
QUERY_HOTFIX_TABLE = "t_databrain_query_hotfix"
TERM_HOTFIX_TABLE = "t_databrain_term_hotfix"
AGENT_MODEL_TABLE = "t_databrain_agent_model"
AGENT_PROMPT_METRICS_TABLE = "t_databrain_agent_prompt_metrics"
TC_DOC_TABLE = "databrain_doc_table"
TC_PSQL_DOC_TABLE = "t_databrain_tc_doc_session"
LATENCY_TABLE = "t_databrain_component_latency"
FILE_TABLE = "t_databrain_agent_file"
EXCEL_TABLE = "t_databrain_agent_excel"
USER_TABLE = "t_databrain_agent_user"

AGENT_EVAL_QUESTIONS_TABLE = "agent_eval_questions"
AGENT_EVAL_PAIRS_TABLE = "agent_eval_qa_pairs"

STATUS_KEY = "status"

BQ_KEY = "bq_token_handler"
COS_KEY = "cos_handler"
GOOGLE_KEY = "google_image_client"
EXA_KEY = "exa"
EXECUTOR_KEY = "thread_executor"
GSHEET_KEY = "gsheet"
LANG_DETECT_KEY = "lang_detect"
LKE_RETRIEVAL_KEY = "lke_retrieval"
MYSQL_KEY = "mysql"
AGENT_EVAL_MYSQL_KEY = "agent_eval_mysql"
PSQL_KEY = "psql_db"
REDIS_KEY = "redis_helper"
TC_KEY = "tc_vector"
TC_DOC_KEY = "tc_vector_doc"

REASONING_MARKERS = ["</reasoning>", "<plan>"]

REDIS_MESSAGE_QUEUE = "message_queue:{}"
REDIS_MESSAGE_STARTED = "message_start:{}"

DEFAULT_MAX_ROUNDS = 10

class AgentName(Enum):
    DataDescribeAgent = "Data Describe Agent"
    ExcelAgent = "Excel Agent"
    ReferenceFilterAgent = "Reference Filter Agent"
    GenreSelectionAgent = "Genre Selection Agent"
    IntelligenceAgent = "Intelligence Agent"
    QueryAgent = "Query Agent"
    OpinionAgent = "Opinions Agent"
    PlannerAgent = "Planner Agent"
    SummaryAgent = "Summary Agent"
    ReflectionAgent = "Reflection Agent"
    TriageAgent = "Triage Agent"
    DashboardAgent = "Dashboard Agent"
    SimplifiedDashboardAgent = "Simplified Dashboard Agent"
    SimplifiedIntelligenceAgent = "Simplified Intelligence Agent"
    SimplifiedOpinionAgent = "Simplified Opinions Agent"
    SimplifiedPlannerAgent = "Simplified Planner Agent"
    WorkflowAgent = "Workflow Agent"
    MgmtAgent = "Mgmt Agent"
    MiniclipAgent = "Miniclip Agent"
    TechlandAgent = "Techland Agent"
    SimplifiedTechlandPlannerAgent = "Simplified Techland Planner Agent"
    GraphAgent = "Graph Agent"
    GameplayCreativeAgent = "Gameplay Creative Agent"
    GameplayDeepResearchAgent = "Gameplay Deep Research Agent"
    GameplayCodeSandboxAgent = "Gameplay Code Sandbox Agent"
    AnalystAgent = "Analyst Agent"
    CalculationAgent = "Calculation Agent"
    GeneralAgent = "General Agent"

PLANNER_AGENT_MAPPING = {
    AgentName.SimplifiedPlannerAgent.value: {
        AgentName.DashboardAgent.value: AgentName.SimplifiedDashboardAgent.value,
        AgentName.IntelligenceAgent.value: AgentName.SimplifiedIntelligenceAgent.value,
        AgentName.OpinionAgent.value: AgentName.SimplifiedOpinionAgent.value
    }
}

class AgentExecutionType(Enum):
    Parallel = "parallel"
    Serial = "serial"

class AgentArtifactType(Enum):
    SwitchAgent = "switch_agent"

class ChatInputType(Enum):
    InputText = "input_text"
    InputImage = "input_image"

class ChatSource(Enum):
    Databrain = "databrain"
    Iwiki = "iwiki"
    Skill = "skill"
    Wecom = "wecom"

class ChatStatus(Enum):
    Cancelled = "cancel"

class ComponentName(Enum):
    AgentAnswer = "agent_answer"
    ChatFunctionAnswer = "chat_function_answer"
    FixedAnswer = "fixed_answer"
    LlmAgentAnswer = "llm_agent_answer"
    PrePlanAnswer = "pre_plan_answer"
    WebsearchAnswer = "websearch_answer"
    WorkflowAnswer = "workflow_answer"

class DefaultPrompt(Enum):
    LanguagePrompt = "the same language as the user's input"
    ImageLanguagePrompt = "the same language as user's input/images's language"


SENSITIVE_DASHBBOARD_TYPES = [DashboardType.Dashboard_3.value, DashboardType.Dashboard_4.value]

class ChatFunction(Enum):
    Empty = ""
    AiExcel = "ai_excel"
    SmartQA = "smart_qa"
    MagicPoster = "magic_poster"

class ChatFunctionSource(Enum):
    Empty = ""
    MainChat = "main_chat"
    FileChat = "file_chat"
    RowChat = "row_chat"
    ColumnChat = "column_chat"
    MagicPosterButton = "button_gp_chat"

class ChatFunctionArgs(Enum):
    InputExcel = "input_excel"
    InputMdId = "input_md_id"
    InputMdUrl = "input_md_url"
    ContentPrompt = "content_prompt"
    PosterPrompt = "poster_prompt"
    PosterTemplate = "poster_template"

class DatabrainChatStatus(Enum):
    Normal = 0
    Cancelled = 1

class DatabrainMode(Enum):
    All = "all"
    Auto = "auto"
    Fastqa = "fastqa"
    Deepthink = "deepthink"

class DataType(Enum):
    DataDescription = "data_description"
    PlanJson = "plan_json"
    ThinkTimeSeconds = "think_time_seconds"
    SensitiveDataInfo = "sensitive_data_info"
    Reference = "reference"

class HandledException(Exception):
    pass

class LoggingCategory(Enum):
    Default = "default"
    Sensitive = "sensitive"

class NerType(Enum):
    Game = "game"
    GameCompany = "game company"

class PlanStages(Enum):
    PreNer = "pre_ner"
    PreIntention = "pre_intention"

class SensitiveDataTypes(Enum):
    Dashboard = "dashboard"
    Mgmt = "mgmt"

class SystemLanguage(Enum):
    En = "en-US"
    Zh = "zh-CN"

class ToolName(Enum):
    CompetitorSearchTool = "game_relation_tool"
    DataExportTool = "data_export_tool"
    GameInfoSearchTool = "entities_info_search_tool"
    GetCommonTopCharts = "get_topN_games_by_filters"
    GetCommonTopGames = "get_common_top_games"
    GetCompanyGames = "get_company_games"
    GetCompanyMetricsTool = "company_metrics_query_tool"
    GetCompanyMetricsWithSearchTool = "company_metrics_query_with_search_tool"
    GetGameLeaderboardRank = "get_game_rank_in_leaderboard"
    GetGameStoreLeaderboard = "get_leaderboard"
    GetGenreMarketSize = "get_genre_market_overview"
    GetTopGenreByFilter = "compare_genre_performance"
    GetGameMarketSize = "get_game_market_size"
    GetTopGameMarkets = "get_topN_market_by_filters"
    MetricsQueryTool = "metrics_query_tool"
    GetOverlapGames = "get_overlap_games"
    QueryGameMarketData = "query_game_market_data"
    GetTopCompanies = "get_topN_companies"

    OpinionDataQueryTool = "opinion_data_query_tool"
    GetGameScore = "get_game_score"
    OpinionSummaryTool = "get_opinion_summary_report"
    TopicRatioAnalysis = "get_metrics_by_topic"
    GetTopContentByTopic = "get_top_content_by_topic"
    GetOpinionAnalysisByTopic = "get_opinion_analysis_by_topic"
    YoutubeUrlAnalysis = "youtube_url_analysis_tool"
    OpinionRedirectTool = "opinion_redirect_tool"
    OpinionWordcloud = "opinion_wordcloud"
    GetGameInformation = "get_game_information"
    GetHashtagTrending = "get_tiktok_hashtag_trending"
    GetIndustryTopVideos = "get_industry_top_videos"
    GetIndustryMemeTrending = "get_industry_meme_trending"

    GetDatabrainKnowledge = "get_databrain_knowledge"
    FaqLookupTool = "faq_lookup_tool"
    DocumentSummaryTool = "document_summary_tool"
    LlmWebsearchTool = "llm_websearch_tool"
    WebsearchTool = "web_search_tool"
    WebReaderTool = "web_reader_tool"

    GetIdTool = "get_id_tool"
    RetrieveFullAnswerTool = "retrieve_full_answer"

    DashboardGameCodeAndFiltersQueryTool = "dashboard_game_code_and_filters_query_tool"
    DashboardMetricsQueryTool = "dashboard_metrics_query_tool"
    DashboardTopCountryQueryTool = "dashboard_top_country_query_tool"
    DashboardMcpDescribeDataTool = "dashboard_mcp_describe_data_tool"
    DashboardMcpReadDataTool = "dashboard_mcp_read_data_tool"
    DashboardMetricPercentageTool = "dashboard_metric_percentage_tool"

    SandboxOpen = "sandbox_open"
    SandboxExecuteCode = "sandbox_execute_code"
    SandboxClose = "sandbox_close"
    GetSkillContext = "get_skill_context"
    GetSkillReference = "get_skill_reference"
    UploadDataToSandbox = "upload_data_to_sandbox"

    MgmtMetricsQueryTool = "mgmt_metrics_query_tool"
    MgmtTopNTool = "mgmt_topn_query_tool"

class ToolCall(Enum):
    DatabrainKnowledgeBaseQuery = "databrain_knowledge_base_query"
    DocumentSummary = "document_summary"
    LlmWebsearch = "llm_websearch"

class UserLike(Enum):
    Like = 1
    Neutral = 0
    Dislike = -1

class UserIntention(Enum):
    Intention0 = 0
    Easy = 1
    Hard = 2