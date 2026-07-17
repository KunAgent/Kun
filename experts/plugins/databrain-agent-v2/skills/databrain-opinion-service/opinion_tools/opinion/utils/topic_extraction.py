"""
话题提取和排序工具

使用 LLM 智能选择与用户查询最相关的话题
"""

from loguru import logger
from typing import List, Dict, Tuple
import re
import json

from opinion_common.config import globalvar as gl
from opinion_utils.llm_proxy import request_llm
from opinion_tools.opinion.utils.topics_helper import get_topics
from async_lru import alru_cache


class TopicExtraction:
    """话题提取类"""
    
    def __init__(self, query: str, game_ids: List[str], top_k: int = 10, language: str = "English"):
        self.query = query
        self.game_ids = game_ids
        self.top_k = top_k
        self.topics_list = []  # 扁平化后的话题列表 List[Dict]
        self.language = language

    async def get_topics_list(self):
        """获取话题列表并扁平化"""
        raw_topics = await get_topics(tuple(self.game_ids))
        # 将嵌套字典结构扁平化为 List[Dict]
        self.topics_list = self._flatten_topics(raw_topics)

    def _flatten_topics(self, raw_topics: Dict) -> List[Dict]:
        """
        将 get_topics 返回的嵌套字典结构扁平化为话题列表
        
        输入格式: {game_id: {parent_topic_key: [{topic: ..., topic_zh: ...}, ...]}}
        输出格式: [{topic: ..., topic_zh: ...}, ...]
        """
        if not raw_topics or not isinstance(raw_topics, dict):
            return []
        
        flattened = []
        seen_topics = set()  # 用于去重
        
        for game_id, parent_topics in raw_topics.items():
            if not isinstance(parent_topics, dict):
                continue
            for parent_key, topics in parent_topics.items():
                if not isinstance(topics, list):
                    continue
                for topic in topics:
                    if not isinstance(topic, dict):
                        continue
                    # 使用 topic 名称去重
                    topic_name = topic.get("topic") or topic.get("topic_zh", "")
                    if topic_name and topic_name not in seen_topics:
                        seen_topics.add(topic_name)
                        flattened.append(topic)
        
        return flattened

    async def rank_topics_for_query(self, method: str = "llm"):
        """
        对话题进行排序并返回Top-K
        
        Args:
            method: 选择方法 "llm" | "rag" | "hybrid"
        
        Returns:
            话题名称列表
        """
        if not self.topics_list:
            raw_topics = await get_topics(tuple(self.game_ids))
            self.topics_list = self._flatten_topics(raw_topics)
        
        if method == "rag":
            # 使用RAG算法
            topic_scores = await select_topics_by_rag(self.query, self.topics_list, self.top_k, language=self.language)
            return [topic for topic, _ in topic_scores]
        elif method == "hybrid":
            # 混合方法
            return await select_topics_hybrid(self.query, self.topics_list, self.top_k, language=self.language)
        else:
            # 默认使用LLM（已包含降级到RAG）
            return await select_topics_for_query_llm(self.query, self.topics_list, self.top_k, language=self.language)
    
    async def rank_topics_with_scores(self, method: str = "rag"):
        """
        对话题进行排序并返回Top-K及其相似度分数
        
        Args:
            method: 选择方法，建议使用 "rag" 获取分数
        
        Returns:
            [(topic_name, similarity_score), ...]
        """
        if not self.topics_list:
            raw_topics = await get_topics(tuple(self.game_ids))
            self.topics_list = self._flatten_topics(raw_topics)
        
        return await select_topics_by_rag(self.query, self.topics_list, self.top_k, language=self.language)


# @alru_cache(maxsize=16, ttl=900)  # 15分钟缓存
async def select_topics_for_query_llm(
    query: str, 
    topics_list: List[Dict], 
    top_k: int = 10, 
    language: str = "English"
) -> List[str]:
    """
    使用LLM直接对话题进行评分和选择
    
    Args:
        query: 用户查询
        topics_list: 话题列表 [{"topic": "...", "topic_zh": "..."}, ...]
        top_k: 返回前K个话题
        language: 语言选择 "Chinese" 或 "English"
    
    Returns:
        选中的话题名称列表
    """
    if not query or not topics_list:
        logger.warning("查询或话题列表为空")
        return []
    
    logger.info(f"使用LLM对 {len(topics_list)} 个话题进行评分和选择，语言: {language}")
    
    try:
        # 直接使用LLM进行话题选择
        final_topics = await _llm_select_topics(query, topics_list, top_k, language)
        logger.info(f"LLM选择完成，返回 {len(final_topics)} 个话题")
        return final_topics
    except Exception as e:
        logger.warning(f"LLM话题选择失败，尝试降级到RAG: {e}")
        # 降级方案1：使用RAG算法
        try:
            topic_scores = await select_topics_by_rag(query, topics_list, top_k, language)
            topics = [topic for topic, _ in topic_scores]
            logger.info(f"RAG降级成功，返回 {len(topics)} 个话题")
            return topics
        except Exception as rag_error:
            logger.error(f"RAG也失败，使用最终降级: {rag_error}")
            # 降级方案2：根据语言返回前top_k个话题
            if language.lower() == 'chinese':
                return [t.get("topic_zh") or t.get("topic", "") for t in topics_list[:top_k] if t.get("topic_zh") or t.get("topic")]
            else:
                return [t.get("topic") or t.get("topic_zh", "") for t in topics_list[:top_k] if t.get("topic") or t.get("topic_zh")]


async def _llm_select_topics(
    query: str, 
    topics_list: List[Dict], 
    top_k: int, 
    language: str = "English"
) -> List[str]:
    """
    使用LLM直接对所有话题进行评分和选择
    
    Args:
        query: 用户查询
        topics_list: 所有话题列表
        top_k: 返回前K个话题
        language: 语言选择 "Chinese" 或 "English"
    
    Returns:
        话题名称列表（按相关度排序）
    """
    # 根据语言选择单语言的topic构建列表
    topics_text = []
    topics_map = []  # 保存topic名称列表，用于后续验证
    
    if language.lower() == 'chinese':
        # 使用中文
        for topic in topics_list:
            topic_name = topic.get("topic_zh") or topic.get("topic", "")
            if topic_name:
                topics_text.append(f"- {topic_name}")
                topics_map.append(topic_name)
    else:
        # 使用英文
        for topic in topics_list:
            topic_name = topic.get("topic") or topic.get("topic_zh", "")
            if topic_name:
                topics_text.append(f"- {topic_name}")
                topics_map.append(topic_name)
    
    topics_str = "\n".join(topics_text)
    
    # 构建prompt，强化游戏领域上下文和输出格式要求
    prompt = f"""You are a video game industry topic relevance analysis expert. Given a user query about a video game and a list of game-related topics, select the top {top_k} most relevant topics.

IMPORTANT CONTEXT:
- This is a GAMING related analysis, all topics are related to video games.
- Game-specific terms and acronyms should be interpreted within gaming domain
- Focus on gameplay, mechanics, and player experience topics

User Query: {query}

Available Topics:
{topics_str}

Instructions:
1. Analyze the semantic relevance between the query and each topic IN THE GAMING CONTEXT, and score the relevance between 0 and 1.
2. Select the top {top_k} most relevant topics from the list above
3. Return EXACTLY the following JSON format with topic name and similarity_score

IMPORTANT:
- Use "topic" field with EXACT topic name from the list above
- Use "similarity_score" (NOT "score" or "relevance")
- Return ONLY the JSON array, NO markdown, NO explanation
- Sort by similarity_score (highest first)
- Topic names must EXACTLY match the names in the list
- Interpret ALL terms in GAMING context"""

    # LLM配置
    llm_config = {
        "model_name": "gpt-4o-mini",
        "temperature": 0,
        "timeout": 5,
        "max_tokens": 512,
        "extra_body": {}
    }
    
    # 调用LLM
    result = await request_llm(
        llm_config=llm_config,
        request_id="topic_selection",
        prompt=prompt,
        system_prompt="You are a video game industry topic relevance analysis expert. You understand gaming terminology, mechanics, and player community discussions. Always interpret queries in gaming context and return valid JSON array."
    )
    
    # 解析结果
    try:
        # 清理可能的markdown格式
        result = result.strip()
        if result.startswith("```"):
            result = re.sub(r'^```json?\s*|\s*```$', '', result, flags=re.MULTILINE)
        
        scored_results = json.loads(result)
        
        # 直接提取topic名称
        selected_topics = []
        for item in scored_results[:top_k]:
            topic_name = item.get("topic", "")
            similarity = item.get("similarity_score", 0)
            
            # 验证topic名称是否在原始列表中
            if topic_name and topic_name in topics_map:
                selected_topics.append(topic_name)
                logger.debug(f"选择话题: {topic_name} (相似度: {similarity:.3f})")
            else:
                logger.warning(f"LLM返回的话题不在列表中: {topic_name}")
        
        logger.info(f"LLM选择成功，选出 {len(selected_topics)} 个话题: {selected_topics}")
        return selected_topics
        
    except Exception as e:
        logger.error(f"解析LLM结果失败: {e}, 原始输出: {result[:200]}")
        raise


async def select_topics_by_rag(
    query: str,
    topics_list: List[Dict],
    top_k: int = 10,
    language: str = "English"
) -> List[Tuple[str, float]]:
    """
    使用RAG（向量相似度）算法选择最相关的话题
    
    Args:
        query: 用户查询
        topics_list: 话题列表 [{"topic": "...", "topic_zh": "..."}, ...]
        top_k: 返回前K个话题
        language: 语言选择 "Chinese" 或 "English"
    
    Returns:
        [(topic_name, similarity_score), ...] 按相似度降序排列
    """
    if not query or not topics_list:
        logger.warning("查询或话题列表为空")
        return []
    
    logger.info(f"使用RAG算法对 {len(topics_list)} 个话题进行向量相似度计算，语言: {language}")
    
    # 提取话题名称列表
    topics_names = []
    topics_map = {}  # {topic_name: original_dict}
    
    for topic in topics_list:
        if language.lower() == 'chinese':
            topic_name = topic.get("topic_zh") or topic.get("topic", "")
        else:
            topic_name = topic.get("topic") or topic.get("topic_zh", "")
        
        if topic_name:
            topics_names.append(topic_name)
            topics_map[topic_name] = topic
    
    if not topics_names:
        logger.warning("没有有效的话题名称")
        return []
    
    # 尝试使用不同的embedding方法
    similarities = None
    
    # 方法1: 使用 sentence-transformers
    try:
        similarities = _compute_similarity_sentence_transformers(query, topics_names)
        logger.info("使用 sentence-transformers 计算相似度成功")
    except Exception as e:
        logger.debug(f"sentence-transformers 不可用: {e}")
    
    # 方法2: 降级到简单的词重叠率
    if similarities is None:
        logger.info("降级使用词重叠率计算相似度")
        similarities = _compute_similarity_word_overlap(query, topics_names)
    
    # 排序并返回Top-K
    topic_scores = list(zip(topics_names, similarities))
    topic_scores.sort(key=lambda x: x[1], reverse=True)
    
    top_topics = topic_scores[:top_k]
    
    logger.info(f"RAG选择完成，Top-{len(top_topics)} 话题:")
    for topic, score in top_topics[:5]:  # 只打印前5个
        logger.info(f"  - {topic}: {score:.4f}")
    
    return top_topics


def _compute_similarity_sentence_transformers(query: str, topics: List[str]) -> List[float]:
    """
    使用 sentence-transformers 计算余弦相似度
    
    Returns:
        相似度列表，范围 [0, 1]
    """
    from sentence_transformers import SentenceTransformer
    import numpy as np
    
    # 加载模型（推荐使用多语言模型）
    model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    
    # 编码
    query_embedding = model.encode(query, convert_to_tensor=False)
    topics_embeddings = model.encode(topics, convert_to_tensor=False)
    
    # 计算余弦相似度
    similarities = []
    for topic_emb in topics_embeddings:
        # 余弦相似度
        cos_sim = np.dot(query_embedding, topic_emb) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(topic_emb)
        )
        # 归一化到 [0, 1]
        normalized_sim = (cos_sim + 1) / 2
        similarities.append(float(normalized_sim))
    
    return similarities


def _compute_similarity_word_overlap(query: str, topics: List[str]) -> List[float]:
    """
    使用词重叠率计算相似度（降级方案）
    
    Returns:
        相似度列表，范围 [0, 1]
    """
    import re
    
    # 提取查询词
    query_words = set(re.findall(r'\w+', query.lower()))
    
    if not query_words:
        return [0.0] * len(topics)
    
    similarities = []
    for topic in topics:
        topic_words = set(re.findall(r'\w+', topic.lower()))
        
        if not topic_words:
            similarities.append(0.0)
            continue
        
        # 计算Jaccard相似度
        intersection = len(query_words & topic_words)
        union = len(query_words | topic_words)
        
        if union == 0:
            similarity = 0.0
        else:
            similarity = intersection / union
        
        # 额外加分：完全匹配或包含关系
        if topic.lower() in query.lower() or query.lower() in topic.lower():
            similarity = min(1.0, similarity + 0.3)
        
        similarities.append(similarity)
    
    return similarities


async def select_topics_hybrid(
    query: str,
    topics_list: List[Dict],
    top_k: int = 10,
    language: str = "English",
    use_llm_first: bool = True
) -> List[str]:
    """
    混合方法：优先使用LLM，失败时降级到RAG
    
    Args:
        query: 用户查询
        topics_list: 话题列表
        top_k: 返回前K个话题
        language: 语言选择
        use_llm_first: 是否优先使用LLM
    
    Returns:
        话题名称列表
    """
    if use_llm_first:
        try:
            # 尝试使用LLM
            return await select_topics_for_query_llm(query, topics_list, top_k, language)
        except Exception as e:
            logger.warning(f"LLM选择失败，降级到RAG: {e}")
    
    # 使用RAG
    try:
        topic_scores = await select_topics_by_rag(query, topics_list, top_k, language)
        return [topic for topic, _ in topic_scores]
    except Exception as e:
        logger.error(f"RAG选择也失败: {e}")
        # 最终降级：返回前top_k个话题
        if language.lower() == 'chinese':
            return [t.get("topic_zh") or t.get("topic", "") for t in topics_list[:top_k] if t.get("topic_zh") or t.get("topic")]
        else:
            return [t.get("topic") or t.get("topic_zh", "") for t in topics_list[:top_k] if t.get("topic") or t.get("topic_zh")]


# 兼容旧的导入方式
async def extract_topics(query: str, game_ids: List[str], top_k: int = 10, language: str = "English") -> List[str]:
    """
    提取与查询最相关的话题
    
    Args:
        query: 用户查询
        game_ids: 游戏ID列表
        top_k: 返回前K个话题
        language: 语言选择
    
    Returns:
        话题名称列表
    """
    extractor = TopicExtraction(query, game_ids, top_k)
    await extractor.get_topics_list()
    return await extractor.rank_topics_for_query()

