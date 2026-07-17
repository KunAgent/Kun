"""Stub: utils.llm_proxy — LLM calls for react agent skills.

Uses the same litellm_config as the main react agent model.
"""
import json
from loguru import logger
from typing import Dict, List, Any


def _get_llm_config() -> Dict[str, Any]:
    from context_loader import get_context
    ctx = get_context()
    rb = ctx.rb_config or {}
    litellm_config = rb.get("litellm_config", {})
    base_url = litellm_config.get("base_url", "").rstrip("/")
    if base_url and not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    return {
        "base_url": base_url,
        "api_key": litellm_config.get("api_key", ""),
        "model_name": "gpt-4.1",
    }


async def _call_llm(messages: List[Dict], model: str = None, temperature: float = 0,
                     max_tokens: int = 1024, timeout: int = 30) -> str:
    from openai import AsyncOpenAI
    cfg = _get_llm_config()
    client = AsyncOpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"], timeout=timeout)
    response = await client.chat.completions.create(
        model=model or cfg["model_name"],
        messages=messages,
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    if isinstance(content, list):
        return "".join(c.get("text", "") for c in content if isinstance(c, dict))
    return content or ""


async def request_llm(llm_config: Dict, request_id: str, prompt: str,
                      system_prompt: str = "", image_urls: List[str] = [],
                      history: List[Dict] = [], max_tries: int = 3, **kwargs) -> str:
    """Generic LLM request — replaces hermes request_llm."""
    model = llm_config.get("model_name", "gpt-4.1")
    temperature = llm_config.get("temperature", 0)
    max_tokens = llm_config.get("max_tokens", 1024)
    timeout = llm_config.get("timeout", 30)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for msg in history:
        messages.append(msg)
    if prompt:
        messages.append({"role": "user", "content": prompt})

    import asyncio
    last_err = None
    for i in range(max_tries):
        try:
            return await _call_llm(messages, model=model, temperature=temperature,
                                   max_tokens=max_tokens, timeout=timeout)
        except Exception as e:
            last_err = e
            logger.warning("request_llm attempt {} failed: {}", i + 1, e)
            if i + 1 < max_tries:
                await asyncio.sleep(0.4 * (i + 1))
    raise last_err


async def request_ner_llm(request_id: str, prompt: str, image_urls: List[str] = [], max_tries: int = 3) -> str:
    """NER LLM request."""
    from context_loader import get_context
    ctx = get_context()
    rb = ctx.rb_config or {}
    ner_config = rb.get("agent_config", {}).get("ner", {})
    return await request_llm(ner_config, request_id, prompt, image_urls=image_urls, max_tries=max_tries)


async def request_mcp_llm(request_id: str, prompt: str, chat_rounds: int = 1,
                           image_urls: List[str] = [], max_tries: int = 3) -> str:
    """MCP LLM request."""
    from context_loader import get_context
    ctx = get_context()
    rb = ctx.rb_config or {}
    mcp_config = rb.get("agent_config", {}).get("single_intention", {})
    mcp_config["max_tokens"] = 2048
    return await request_llm(mcp_config, request_id, prompt, image_urls=image_urls, max_tries=max_tries)


async def request_tool_check_config_llm(request_id: str, prompt: str,
                                         image_urls: List[str] = [], max_tries: int = 3) -> str:
    """Tool check config LLM request."""
    from context_loader import get_context
    ctx = get_context()
    rb = ctx.rb_config or {}
    tool_check_config = rb.get("agent_config", {}).get("tool_check_config", {})
    return await request_llm(tool_check_config, request_id, prompt, image_urls=image_urls, max_tries=max_tries)
