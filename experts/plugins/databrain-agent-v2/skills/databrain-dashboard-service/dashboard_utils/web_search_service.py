"""Stub: utils.web_search_service — web search functions for react agent skills."""
from loguru import logger
from typing import List, Dict, Any, Optional


async def get_web_search_results(context=None, query: str = "", search_query: str = "", **kwargs) -> Dict[str, Any]:
    """Stub: returns empty results. React agent uses its own web search tool."""
    q = search_query or query
    logger.warning("web_search_service.get_web_search_results called in skill (query={}) — returning empty", q)
    return {
        "code": -1,
        "msg": "web_search not available in skill subprocess",
        "no_reference": True,
        "source": [],
        "data": {},
    }


def process_websearch_results(results: Any, **kwargs) -> List[Dict[str, Any]]:
    """Format web search results into structured list.
    
    Handles both:
    - exa_py Result objects (with .title, .text, .url attributes)
    - plain dicts with 'title', 'text'/'content', 'url' keys
    """
    if not results:
        return []
    processed = []
    for r in results:
        try:
            if hasattr(r, "title"):
                # exa Result object
                processed.append({
                    "title": getattr(r, "title", ""),
                    "text": getattr(r, "text", "") or getattr(r, "content", ""),
                    "url": getattr(r, "url", ""),
                })
            elif isinstance(r, dict):
                processed.append({
                    "title": r.get("title", ""),
                    "text": r.get("text", "") or r.get("content", ""),
                    "url": r.get("url", ""),
                })
            else:
                processed.append({"text": str(r)})
        except Exception:
            continue
    return processed


def add_references_to_context(context, results: List[Dict], **kwargs):
    """No-op: references handled by agent."""
    pass


async def execute_exa_search(query: str, **kwargs) -> List[Dict[str, Any]]:
    """Stub: returns empty results."""
    logger.warning("execute_exa_search called in skill — returning empty")
    return []
