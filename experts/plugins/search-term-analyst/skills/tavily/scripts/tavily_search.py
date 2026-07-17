#!/usr/bin/env python3
"""
Tavily AI Search - Optimized search for LLMs and AI applications
Requires: pip install tavily-python
"""

import argparse
import json
import sys
import os
from typing import Optional, List


def search(
    query: str,
    api_key: str,
    search_depth: str = "basic",
    topic: str = "general",
    max_results: int = 5,
    include_answer: bool = True,
    include_raw_content: bool = False,
    include_images: bool = False,
    include_domains: Optional[List[str]] = None,
    exclude_domains: Optional[List[str]] = None,
) -> dict:
    """
    Execute a Tavily search query.
    
    Args:
        query: Search query string
        api_key: Tavily API key (tvly-...)
        search_depth: "basic" (fast) or "advanced" (comprehensive)
        topic: "general" (default) or "news" (current events)
        max_results: Number of results to return (1-10)
        include_answer: Include AI-generated answer summary
        include_raw_content: Include raw HTML content of sources
        include_images: Include relevant images in results
        include_domains: List of domains to specifically include
        exclude_domains: List of domains to exclude
    
    Returns:
        dict: Tavily API response
    """
    try:
        from tavily import TavilyClient
    except ImportError:
        return {
            "error": "tavily-python package not installed. Run: pip install tavily-python",
            "install_command": "pip install tavily-python"
        }
    
    if not api_key:
        return {
            "error": "Tavily API key required. Get one at https://tavily.com",
            "setup_instructions": "Set TAVILY_API_KEY environment variable or pass --api-key"
        }
    
    try:
        client = TavilyClient(api_key=api_key)
        
        # Build search parameters
        search_params = {
            "query": query,
            "search_depth": search_depth,
            "topic": topic,
            "max_results": max_results,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
            "include_images": include_images,
        }
        
        if include_domains:
            search_params["include_domains"] = include_domains
        if exclude_domains:
            search_params["exclude_domains"] = exclude_domains
        
        response = client.search(**search_params)
        
        return {
            "success": True,
            "query": query,
            "answer": response.get("answer"),
            "results": response.get("results", []),
            "images": response.get("images", []),
            "response_time": response.get("response_time"),
            "usage": response.get("usage", {}),
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "query": query
        }


def main():
    parser = argparse.ArgumentParser(
        description="Tavily AI Search - Optimized search for LLMs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic search
  %(prog)s "What is quantum computing?"
  
  # Advanced search with more results
  %(prog)s "Climate change solutions" --depth advanced --max-results 10
  
  # News-focused search
  %(prog)s "AI developments" --topic news
  
  # Domain filtering
  %(prog)s "Python tutorials" --include-domains python.org --exclude-domains w3schools.com
  
  # Include images in results
  %(prog)s "Eiffel Tower" --images
  
Environment Variables:
  TAVILY_API_KEY    Your Tavily API key (get one at https://tavily.com)
        """
    )
    
    parser.add_argument(
        "query",
        help="Search query"
    )
    
    parser.add_argument(
        "--api-key",
        help="Tavily API key (or set TAVILY_API_KEY env var)"
    )
    
    parser.add_argument(
        "--depth",
        choices=["basic", "advanced"],
        default="basic",
        help="Search depth: 'basic' (fast) or 'advanced' (comprehensive)"
    )
    
    parser.add_argument(
        "--topic",
        choices=["general", "news"],
        default="general",
        help="Search topic: 'general' or 'news' (current events)"
    )
    
    parser.add_argument(
        "--max-results",
        type=int,
        default=5,
        help="Maximum number of results (1-10)"
    )
    
    parser.add_argument(
        "--no-answer",
        action="store_true",
        help="Exclude AI-generated answer summary"
    )
    
    parser.add_argument(
        "--raw-content",
        action="store_true",
        help="Include raw HTML content of sources"
    )
    
    parser.add_argument(
        "--images",
        action="store_true",
        help="Include relevant images in results"
    )
    
    parser.add_argument(
        "--include-domains",
        nargs="+",
        help="List of domains to specifically include"
    )
    
    parser.add_argument(
        "--exclude-domains",
        nargs="+",
        help="List of domains to exclude"
    )
    
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON response"
    )
    
    args = parser.parse_args()
    
    # Get API key from args or environment
    api_key = args.api_key or os.getenv("TAVILY_API_KEY")
    
    result = search(
        query=args.query,
        api_key=api_key,
        search_depth=args.depth,
        topic=args.topic,
        max_results=args.max_results,
        include_answer=not args.no_answer,
        include_raw_content=args.raw_content,
        include_images=args.images,
        include_domains=args.include_domains,
        exclude_domains=args.exclude_domains,
    )
    
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"Error: {result['error']}", file=sys.stderr)
            if "install_command" in result:
                print(f"\nTo install: {result['install_command']}", file=sys.stderr)
            if "setup_instructions" in result:
                print(f"\nSetup: {result['setup_instructions']}", file=sys.stderr)
            sys.exit(1)
        
        # Format human-readable output
        print(f"Query: {result['query']}")
        print(f"Response time: {result.get('response_time', 'N/A')}s")
        print(f"Credits used: {result.get('usage', {}).get('credits', 'N/A')}\n")
        
        if result.get("answer"):
            print("=== AI ANSWER ===")
            print(result["answer"])
            print()
        
        if result.get("results"):
            print("=== RESULTS ===")
            for i, item in enumerate(result["results"], 1):
                print(f"\n{i}. {item.get('title', 'No title')}")
                print(f"   URL: {item.get('url', 'N/A')}")
                print(f"   Score: {item.get('score', 'N/A'):.3f}")
                if item.get("content"):
                    content = item["content"]
                    if len(content) > 200:
                        content = content[:200] + "..."
                    print(f"   {content}")
        
        if result.get("images"):
            print(f"\n=== IMAGES ({len(result['images'])}) ===")
            for img_url in result["images"][:5]:  # Show first 5
                print(f"   {img_url}")


if __name__ == "__main__":
    main()
