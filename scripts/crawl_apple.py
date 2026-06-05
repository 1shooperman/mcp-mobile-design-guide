"""Crawl Apple HIG and cache pages as markdown to .cache/apple/hig/"""

import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

ROOT_URL = "https://developer.apple.com/design/human-interface-guidelines/"
BASE_DOMAIN = "developer.apple.com"
BASE_PATH = "/design/human-interface-guidelines"
OUT_DIR = Path(".cache/apple/hig")
INDEX_FILE = OUT_DIR / "index.json"

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
    slug = path.replace(BASE_PATH, "").strip("/").replace("/", "__") or "index"
    return re.sub(r"[^\w\-]", "_", slug)


def is_hig_url(url: str) -> bool:
    p = urlparse(url)
    return p.netloc == BASE_DOMAIN and p.path.startswith(BASE_PATH)


async def crawl():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    visited: set[str] = set()
    queue: list[str] = [ROOT_URL]
    index: dict[str, str] = {}  # slug -> url

    async with AsyncWebCrawler(config=BROWSER_CFG) as crawler:
        while queue:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)

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

            out_path.write_text(result.markdown or "", encoding="utf-8")
            index[slug] = url
            print(f"  -> {out_path} ({len(result.markdown or '')} chars)")

            # enqueue discovered HIG links
            for link in result.links.get("internal", []):
                href = link.get("href", "")
                full = urljoin(url, href).split("#")[0].rstrip("/") + "/"
                if is_hig_url(full) and full not in visited:
                    queue.append(full)

            time.sleep(0.5)

    INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"\nDone. {len(index)} pages -> {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(crawl())
