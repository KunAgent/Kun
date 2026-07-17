# Tavily API Reference

## Overview

Tavily is a search engine optimized for Large Language Models (LLMs) and AI applications. It provides:

- **AI-optimized results**: Results specifically formatted for LLM consumption
- **Answer generation**: Optional AI-generated summaries from search results
- **Raw content extraction**: Clean, parsed HTML content from sources
- **Domain filtering**: Include or exclude specific domains
- **Image search**: Relevant images for visual context
- **Topic specialization**: General or news-focused search

## API Key Setup

1. Visit https://tavily.com and sign up
2. Generate an API key from your dashboard
3. Store the key securely:
   - **Recommended**: Add to Clawdbot config under `skills.entries.tavily.apiKey`
   - **Alternative**: Set `TAVILY_API_KEY` environment variable

## Search Parameters

### Required

- `query` (string): The search query

### Optional

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search_depth` | string | `"basic"` | `"basic"` (fast, ~1-2s) or `"advanced"` (comprehensive, ~5-10s) |
| `topic` | string | `"general"` | `"general"` or `"news"` (current events, last 7 days) |
| `max_results` | int | 5 | Number of results (1-10) |
| `include_answer` | bool | true | Include AI-generated answer summary |
| `include_raw_content` | bool | false | Include cleaned HTML content of sources |
| `include_images` | bool | false | Include relevant images |
| `include_domains` | list[str] | null | Only search these domains |
| `exclude_domains` | list[str] | null | Exclude these domains |

## Response Format

```json
{
  "success": true,
  "query": "What is quantum computing?",
  "answer": "Quantum computing is a type of computing that uses...",
  "results": [
    {
      "title": "Quantum Computing Explained",
      "url": "https://example.com/quantum",
      "content": "Quantum computing leverages...",
      "score": 0.95,
      "raw_content": null
    }
  ],
  "images": ["https://example.com/image.jpg"],
  "response_time": "1.67",
  "usage": {
    "credits": 1
  }
}
```

## Use Cases & Best Practices

### When to Use Tavily

1. **Research tasks**: Comprehensive information gathering
2. **Current events**: News-focused queries with `topic="news"`
3. **Domain-specific search**: Use `include_domains` for trusted sources
4. **Visual content**: Enable `include_images` for visual context
5. **LLM consumption**: Results are pre-formatted for AI processing

### Search Depth Comparison

| Depth | Speed | Results Quality | Use Case |
|-------|-------|-----------------|----------|
| `basic` | 1-2s | Good | Quick lookups, simple facts |
| `advanced` | 5-10s | Excellent | Research, complex topics, comprehensive analysis |

**Recommendation**: Start with `basic`, use `advanced` for research tasks.

### Domain Filtering

**Include domains** (allowlist):
```python
include_domains=["python.org", "github.com", "stackoverflow.com"]
```
Only search these specific domains - useful for trusted sources.

**Exclude domains** (denylist):
```python
exclude_domains=["pinterest.com", "quora.com"]
```
Remove unwanted or low-quality sources.

### Topic Selection

**General** (`topic="general"`):
- Default mode
- Broader web search
- Historical and evergreen content
- Best for most queries

**News** (`topic="news"`):
- Last 7 days only
- News-focused sources
- Current events and developments
- Best for "latest", "recent", "current" queries

## Cost & Rate Limits

- **Credits**: Each search consumes credits (1 credit for basic search)
- **Free tier**: Check https://tavily.com/pricing for current limits
- **Rate limits**: Varies by plan tier

## Error Handling

Common errors:

1. **Missing API key**
   ```json
   {
     "error": "Tavily API key required",
     "setup_instructions": "Set TAVILY_API_KEY environment variable"
   }
   ```

2. **Package not installed**
   ```json
   {
     "error": "tavily-python package not installed",
     "install_command": "pip install tavily-python"
   }
   ```

3. **Invalid API key**
   ```json
   {
     "error": "Invalid API key"
   }
   ```

4. **Rate limit exceeded**
   ```json
   {
     "error": "Rate limit exceeded"
   }
   ```

## Python SDK

The skill uses the official `tavily-python` package:

```python
from tavily import TavilyClient

client = TavilyClient(api_key="tvly-...")
response = client.search(
    query="What is AI?",
    search_depth="advanced",
    max_results=10
)
```

Install: `pip install tavily-python`

## Comparison with Other Search APIs

| Feature | Tavily | Brave Search | Perplexity |
|---------|--------|--------------|------------|
| AI Answer | ✅ Yes | ❌ No | ✅ Yes |
| Raw Content | ✅ Yes | ❌ No | ❌ No |
| Domain Filtering | ✅ Yes | Limited | ❌ No |
| Image Search | ✅ Yes | ✅ Yes | ❌ No |
| News Mode | ✅ Yes | ✅ Yes | ✅ Yes |
| LLM Optimized | ✅ Yes | ❌ No | ✅ Yes |
| Speed | Medium | Fast | Medium |
| Free Tier | ✅ Yes | ✅ Yes | Limited |

## Additional Resources

- Official Docs: https://docs.tavily.com
- Python SDK: https://github.com/tavily-ai/tavily-python
- API Reference: https://docs.tavily.com/documentation/api-reference
- Pricing: https://tavily.com/pricing
