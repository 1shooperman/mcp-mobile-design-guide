"""Crawl curated Google Search Central pages and cache as markdown to .cache/google-search/hig/.

Unlike crawl_apple.py / crawl_android.py this doesn't discover links by walking
a site — these are specific pages (a guide, a blog post) picked by hand. Add to
SOURCES to track more.
"""

import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

OUT_DIR = Path(".cache/google-search/hig")
INDEX_FILE = OUT_DIR / "index.json"

# as_of: the date that matters for this content (page's "Last updated" for
# docs, publish date for blog posts) — Google's page chrome doesn't expose
# this consistently enough to scrape reliably, so it's hand-maintained here.
SOURCES = [
    {
        "url": "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
        "as_of": "2026-07-10",
        "tags": ["seo", "ai-search", "generative-ai", "content-strategy"],
    },
    {
        "url": "https://developers.google.com/search/blog/2026/03/crawler-blog-post",
        "as_of": "2026-03-31",
        "tags": ["crawling", "googlebot", "technical-seo", "infrastructure"],
    },
]

BROWSER_CFG = BrowserConfig(headless=True, verbose=False)
RUN_CFG = CrawlerRunConfig(
    cache_mode=CacheMode.BYPASS,
    markdown_generator=DefaultMarkdownGenerator(),
    word_count_threshold=10,
    excluded_tags=["nav", "footer", "header"],
    exclude_external_links=True,
)


def url_to_slug(url: str) -> str:
    path = urlparse(url).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1] or "index"
    return re.sub(r"[^\w\-]", "_", slug)


def trim_chrome(markdown: str) -> str:
    """Strip Google's site nav/lang-switcher chrome and footer feedback widget.

    The rendered markdown brackets the real content between two "Send feedback"
    occurrences (crawl4ai's excluded_tags doesn't catch this chrome since it's
    not in nav/header/footer tags on these pages).
    """
    parts = markdown.split("Send feedback", 2)
    if len(parts) < 2:
        return markdown.strip()
    return parts[1].strip()


async def crawl():
    index: dict[str, str] = {}

    async with AsyncWebCrawler(config=BROWSER_CFG) as crawler:
        for entry in SOURCES:
            url = entry["url"]
            slug = url_to_slug(url)
            out_path = OUT_DIR / f"{slug}.md"

            print(f"[crawl] {url}")
            try:
                result = await crawler.arun(url=url, config=RUN_CFG)
            except Exception as e:
                print(f"  ERROR: {e}")
                continue

            if not result.success:
                print(f"  FAILED: {result.error_message}")
                continue

            body = trim_chrome(result.markdown or "")
            tags = ",".join(entry.get("tags", []))
            frontmatter = f"---\nas_of: {entry['as_of']}\ntags: {tags}\n---\n\n"
            out_path.write_text(frontmatter + body, encoding="utf-8")
            index[slug] = url
            print(f"  -> {out_path} ({len(body)} chars)")

    INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"\nDone. {len(index)} pages -> {OUT_DIR}")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    asyncio.run(crawl())
