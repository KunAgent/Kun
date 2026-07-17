from loguru import logger
from typing import List
import json
import os
import time
from opinion_tools.opinion.utils.cube_helper import describe_data
from opinion_common.config import globalvar as gl


def _filter_tables_by_tfidf(tables_data: List[dict], user_query: str, top_k: int = 3) -> List[dict]:
    """
    使用 TF-IDF + 余弦相似度的轻量级 RAG 筛选方案
    不依赖任何深度学习库，作为降级方案
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

        # 为每张表构建描述文本
        table_texts = []
        for table in tables_data:
            table_name = table.get('table', '')
            table_desc = table.get('description', '')

            # 收集所有字段描述
            field_descs = []
            for dim in table.get('dimensions', []):
                if dim.get('description'):
                    field_descs.append(dim['description'])
            for measure in table.get('measures', []):
                if measure.get('description'):
                    field_descs.append(measure['description'])

            # 组合成完整描述
            full_desc = f"{table_name} {table_desc} {' '.join(field_descs)}"
            table_texts.append(full_desc)

        # 使用 TF-IDF 向量化
        vectorizer = TfidfVectorizer(max_features=1000)
        all_texts = [user_query] + table_texts
        tfidf_matrix = vectorizer.fit_transform(all_texts)

        # 计算余弦相似度
        query_vector = tfidf_matrix[0:1]
        table_vectors = tfidf_matrix[1:]
        similarities = cosine_similarity(query_vector, table_vectors)[0]

        # 获取 Top K 索引
        top_indices = similarities.argsort()[::-1][:top_k]

        # 返回筛选后的表
        filtered_tables = [tables_data[i] for i in top_indices]

        # 记录日志
        logger.info(
            f"TF-IDF 筛选完成，从 {len(tables_data)} 张表中筛选出 {len(filtered_tables)} 张最相关的表:")
        for idx, i in enumerate(top_indices):
            table_name = tables_data[i].get('table', 'unknown')
            logger.info(
                f"  {idx+1}. {table_name} (相似度: {similarities[i]:.4f})")

        return filtered_tables

    except Exception as e:
        logger.error(f"TF-IDF 筛选失败: {e}，返回前 {top_k} 张表")
        return tables_data[:top_k]


def _filter_tables_by_vector_rag(tables_data: List[dict], user_query: str, top_k: int = 3) -> List[dict]:
    """
    使用向量相似度的 RAG 筛选方案（中间降级方案）
    优先使用 sentence-transformers，其次 text2vec，最后降级到 TF-IDF
    """
    # 尝试向量化模型
    model = None
    model_type = None

    # 方案2: sentence-transformers（推荐，兼容性好）
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
        model_type = "sentence-transformers"
        logger.info("使用 sentence-transformers 模型进行向量 RAG 筛选")
    except Exception as e:
        logger.debug(f"sentence-transformers 不可用: {e}")

    # 方案3: TF-IDF（最终降级方案）
    if model is None:
        logger.info("向量模型不可用，降级使用 TF-IDF 方法")
        return _filter_tables_by_tfidf(tables_data, user_query, top_k)

    try:
        # 为每张表构建描述文本（表名 + 表描述）
        table_texts = []
        for table in tables_data:
            table_name = table.get('table', '')
            table_desc = table.get('description', '')
            full_desc = f"{table_name} {table_desc}"
            table_texts.append(full_desc)

        # 编码
        query_embedding = model.encode(user_query)
        table_embeddings = model.encode(table_texts)

        # 计算相似度（余弦相似度）
        import numpy as np
        similarities = np.dot(table_embeddings, query_embedding) / (
            np.linalg.norm(table_embeddings, axis=1) *
            np.linalg.norm(query_embedding)
        )

        # 获取 Top K 索引
        top_indices = np.argsort(similarities)[::-1][:top_k]

        # 返回筛选后的表
        filtered_tables = [tables_data[i] for i in top_indices]

        # 记录日志
        logger.info(
            f"RAG 筛选完成，从 {len(tables_data)} 张表中筛选出 {len(filtered_tables)} 张最相关的表:")
        for idx, i in enumerate(top_indices):
            table_name = tables_data[i].get('table', 'unknown')
            logger.info(
                f"  {idx+1}. {table_name} (相似度: {similarities[i]:.4f})")

        return filtered_tables

    except Exception as e:
        logger.error(f"RAG 筛选失败: {e}，降级使用 TF-IDF 方法")
        return _filter_tables_by_tfidf(tables_data, user_query, top_k)


async def filter_tables_by_algorithm(tables_data: List[dict], user_query: str, top_k: int = 3) -> List[dict]:
    """
    智能表筛选主函数，三层降级策略：
    1. LLM 智能选择（主方案）
    2. 向量 RAG 相似度匹配（中间降级）
    3. TF-IDF 关键词匹配（最终降级）

    Args:
        tables_data: 完整的表描述列表
        user_query: 用户查询文本
        top_k: 返回前 k 个最相关的表（默认 3）

    Returns:
        筛选后的表列表
    """
    if not user_query or not tables_data:
        logger.warning("表筛选: 用户查询或表数据为空，返回前 3 张表")
        return tables_data[:top_k]

    # 方案1: 优先使用 LLM 进行智能选择
    try:
        from opinion_utils.llm_proxy import request_llm

        # 构建表列表供 LLM 选择
        table_info_list = []
        for idx, table in enumerate(tables_data):
            table_name = table.get('table', '')
            table_desc = table.get('description', '')
            table_info_list.append(f"{idx + 1}. {table_name}: {table_desc}")

        tables_text = "\n".join(table_info_list)

        from opinion_prompts.opinions_prompts import get_extension_rules
        rainbow_rule_tables = get_extension_rules(
            "Opinions Table", "prompt", user_query)
        rainbow_prompt = "\nPrefer these tables if relevant to the query, but only include them when they genuinely match the user's need (do not force-include if not applicable): " + \
            ",".join(rainbow_rule_tables) if rainbow_rule_tables else ""

        # 构建 prompt
        prompt = f"""Analyze the user query and select the most relevant 1 to {top_k} tables from the given database tables.{rainbow_prompt}

User Query: {user_query}

Available Tables: Table with _content contains content and details, table with _stats contains metrics and statistics
{tables_text}

Requirements:
1. Analyze the core needs of the user query (e.g., view comments, view video metrics, view news updates)
2. Select the most relevant {top_k} tables (minimum 1, maximum {top_k})
3. Return only the table numbers, separated by commas, e.g., 1,3,5

Output Format: Only output the numbers separated by commas, nothing else"""

        # 从 Rainbow 配置中读取 LLM 调用参数
        agent_config = gl.get_value("agent_config", expected_type=dict)
        llm_config = agent_config.get("opinion_table_selection", {
            "model_name": "gpt-4.1",
            "temperature": 0,
            "timeout": 5,
            "max_tokens": 512,
            "extra_body": {}
        })

        # 调用 LLM
        result = await request_llm(
            llm_config=llm_config,
            request_id="table_selection",
            prompt=prompt,
            system_prompt="You are a database table selection expert who can accurately understand user needs and select the most appropriate tables."
        )

        # 解析 LLM 返回结果
        selected_indices = []
        result = result.strip()
        for part in result.split(','):
            try:
                idx = int(part.strip()) - 1  # 转为 0-based 索引
                if 0 <= idx < len(tables_data):
                    selected_indices.append(idx)
            except ValueError:
                continue

        # 如果没有选中任何表，抛出异常触发降级
        if not selected_indices:
            raise ValueError(f"LLM 未返回有效的表索引，原始输出: {result}")

        # 返回选中的表
        filtered_tables = [tables_data[i] for i in selected_indices]

        # 记录日志
        logger.info(
            f"LLM 表筛选成功，从 {len(tables_data)} 张表中筛选出 {len(filtered_tables)} 张:")
        for idx, table_idx in enumerate(selected_indices):
            table_name = tables_data[table_idx].get('table', 'unknown')
            logger.info(f"  {idx+1}. {table_name}")

        return filtered_tables

    except Exception as e:
        logger.warning(f"LLM 表筛选失败: {e}，降级使用向量 RAG 方法")
        # 方案2: 降级到向量 RAG（内部会再降级到 TF-IDF）
        return _filter_tables_by_vector_rag(tables_data, user_query, top_k)

# 读取缓存的 describe_data 结果
async def generate_describe_data() -> str:
    """
    基于 describe_data() 结果生成并缓存到 data/describe_data.json。
    - 若缓存未过期（15分钟内），直接返回缓存中的 data 字段字符串。
    - 否则重新生成，并写入 {"generated_at": ts, "data": schema} 结构。
    返回值为 schema 的字符串形式。
    """
    # 当前文件: tools/opinion/utils/cube_table_selection.py
    # 目标路径: tools/opinion/data/describe_data.json
    # 向上两级 (utils/ -> opinion/) 再进入 data/
    opinion_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    describe_data_path = os.path.join(opinion_dir, "data", "describe_data.json")

    # 优先尝试读取缓存文件（15分钟 = 900秒）
    try:
        if os.path.exists(describe_data_path):
            with open(describe_data_path, "r", encoding="utf-8") as f:
                cached_payload = json.load(f)
            generated_at = cached_payload.get("generated_at", 0)
            if time.time() - generated_at < 9000:
                logger.info(f"使用本地缓存的 describe_data，生成时间: {time.ctime(generated_at)}")
                return str(cached_payload.get("data", ""))
            else:
                logger.info("describe_data 缓存已过期，将重新生成")
    except Exception as e:
        logger.info(f"读取 describe_data 缓存失败: {e}，将重新生成")

    # 重新生成
    try:
        start_time = time.time()
        schema = await describe_data()
        payload = {"generated_at": time.time(), "data": schema}
        os.makedirs(os.path.dirname(describe_data_path), exist_ok=True)
        with open(describe_data_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        cost_ms = round((time.time() - start_time) * 1000, 2)
        logger.info(f"describe_data 已重新生成并写入缓存，耗时: {cost_ms}ms")
        return str(schema)
    except Exception as e:
        logger.error(f"❌ 重新生成 describe_data 失败: {e}")
        # 回退：尝试读取现有文件（可能无 generated_at 字段）
        try:
            with open(describe_data_path, "r", encoding="utf-8") as f:
                fallback_payload = json.load(f)
            return str(fallback_payload.get("data", fallback_payload))
        except Exception:
            return "数据描述暂不可用，请稍后重试"