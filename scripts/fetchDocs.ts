#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import TurndownService from 'turndown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_BASE_URL = 'https://docs.payram.com';
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'payram-docs-live');

interface DocPage {
  path: string;
  url: string;
}

const visitedUrls = new Set<string>();
const discoveredUrlSet = new Set<string>();
const discoveredPages: DocPage[] = [];

const normalizeUrlPath = (url: string) => {
  if (!url) {
    return '/';
  }
  const withoutHash = url.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  const normalized = withoutQuery.replace(/\/$/, '');
  return normalized === '' ? '/' : normalized;
};

const addDiscoveredPage = (url: string) => {
  const normalizedUrl = normalizeUrlPath(url);
  if (normalizedUrl.endsWith('.xml')) {
    return;
  }
  if (normalizedUrl.startsWith('/cdn-cgi/')) {
    return;
  }
  if (discoveredUrlSet.has(normalizedUrl)) {
    return;
  }
  discoveredUrlSet.add(normalizedUrl);
  discoveredPages.push({
    url: normalizedUrl,
    path: urlToFilePath(normalizedUrl),
  });
};

async function fetchPageHtml(url: string): Promise<string> {
  const fullUrl = `${DOCS_BASE_URL}${url}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'PayRam-MCP-Server-Doc-Fetcher/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`Error fetching ${url}:`, error);
        throw error;
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw new Error(`Failed to fetch ${url}`);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];

    // Skip external links, anchors, and non-doc links
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
      continue;
    }

    // Handle relative URLs
    if (href.startsWith('/')) {
      links.push(href);
    } else if (!href.includes('://')) {
      // Relative path - resolve it
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const resolved = new URL(href, `${DOCS_BASE_URL}${base}`).pathname;
      links.push(resolved);
    }
  }

  return [...new Set(links)]; // Remove duplicates
}

function urlToFilePath(url: string): string {
  // Convert URL path to file path
  const normalized = normalizeUrlPath(url);
  if (normalized === '/') {
    return 'index.md';
  }

  let filePath = normalized.replace(/^\//, ''); // Remove leading slash

  // Remove trailing slash
  filePath = filePath.replace(/\/$/, '');

  // Convert kebab-case to snake_case for better readability (optional)
  // filePath = filePath.replace(/-/g, '_');

  // Add .md extension if not present
  if (!filePath.endsWith('.md')) {
    filePath = filePath + '.md';
  }

  return filePath;
}

async function crawlPage(url: string, depth: number = 0, maxDepth: number = 5): Promise<void> {
  // Normalize URL
  const normalizedUrl = normalizeUrlPath(url);

  if (visitedUrls.has(normalizedUrl) || depth > maxDepth) {
    return;
  }

  visitedUrls.add(normalizedUrl);
  console.log(`${'  '.repeat(depth)}Crawling: ${normalizedUrl}`);

  try {
    const html = await fetchPageHtml(normalizedUrl);

    // Add this page to discovered pages
    addDiscoveredPage(normalizedUrl);

    // Extract and crawl links
    const links = extractLinks(html, normalizedUrl);

    for (const link of links) {
      // Only crawl links that look like documentation pages
      // Skip common non-documentation paths
      if (
        link.includes('/api/') ||
        link.includes('/static/') ||
        link.includes('/_next/') ||
        link.includes('/images/') ||
        link.includes('/assets/')
      ) {
        continue;
      }

      await crawlPage(link, depth + 1, maxDepth);

      // Small delay to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    console.error(`Failed to crawl ${normalizedUrl}:`, error);
  }
}

async function discoverFromSitemap(): Promise<string[]> {
  const discovered: string[] = [];
  const sitemapQueue: string[] = [];
  const seenSitemaps = new Set<string>();

  const seedSitemaps = ['/sitemap.xml', '/sitemap-index.xml'];
  for (const seed of seedSitemaps) {
    sitemapQueue.push(seed);
  }

  try {
    const robotsTxt = await fetch(`${DOCS_BASE_URL}/robots.txt`, {
      headers: {
        'User-Agent': 'PayRam-MCP-Server-Doc-Fetcher/1.0',
      },
    });
    if (robotsTxt.ok) {
      const robotsBody = await robotsTxt.text();
      const sitemapMatches = robotsBody.match(/^Sitemap:\s*(.+)$/gim) ?? [];
      for (const line of sitemapMatches) {
        const sitemapUrl = line.replace(/^Sitemap:\s*/i, '').trim();
        if (sitemapUrl.startsWith(DOCS_BASE_URL)) {
          sitemapQueue.push(new URL(sitemapUrl).pathname);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to read robots.txt for sitemap discovery:', error);
  }

  while (sitemapQueue.length) {
    const sitemapPath = sitemapQueue.shift();
    if (!sitemapPath) {
      continue;
    }
    const normalizedPath = normalizeUrlPath(sitemapPath);
    if (seenSitemaps.has(normalizedPath)) {
      continue;
    }
    seenSitemaps.add(normalizedPath);

    try {
      const response = await fetch(`${DOCS_BASE_URL}${normalizedPath}`, {
        headers: {
          'User-Agent': 'PayRam-MCP-Server-Doc-Fetcher/1.0',
        },
      });
      if (!response.ok) {
        continue;
      }
      const xml = await response.text();
      const matches = xml.match(/<loc>([^<]+)<\/loc>/gi) ?? [];
      for (const match of matches) {
        const loc = match.replace(/<\/??loc>/g, '').trim();
        if (!loc) {
          continue;
        }
        if (!loc.startsWith(DOCS_BASE_URL)) {
          continue;
        }
        const urlPath = new URL(loc).pathname;
        if (urlPath.endsWith('.xml')) {
          sitemapQueue.push(urlPath);
        } else {
          discovered.push(urlPath);
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch ${normalizedPath}:`, error);
    }
  }

  return [...new Set(discovered.map(normalizeUrlPath))];
}

async function fetchPage(docPage: DocPage): Promise<string> {
  console.log(`Fetching: ${docPage.url}`);

  try {
    const html = await fetchPageHtml(docPage.url);

    // Extract main content from the HTML
    // Try multiple patterns to find the main content
    const contentMatch =
      html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
      html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
      html.match(/<div[^>]*class="[^"]*markdown[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (!contentMatch) {
      console.warn(`Could not extract main content from ${docPage.url}, using full HTML`);
      return convertHtmlToMarkdown(html);
    }

    return convertHtmlToMarkdown(contentMatch[1]);
  } catch (error) {
    console.error(`Error fetching ${docPage.url}:`, error);
    throw error;
  }
}

function convertHtmlToMarkdown(html: string): string {
  // Initialize Turndown service for HTML to Markdown conversion
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Remove script and style tags before conversion
  let cleanHtml = html;
  cleanHtml = cleanHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert to markdown
  const markdown = turndownService.turndown(cleanHtml);

  // Clean up excessive newlines
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function savePage(docPage: DocPage, content: string): Promise<void> {
  const filePath = path.join(OUTPUT_DIR, docPage.path);
  ensureDirectoryExists(filePath);

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`✓ Saved: ${docPage.path}`);
}

async function fetchAllDocs(): Promise<void> {
  console.log('Starting documentation crawl and fetch...\n');
  console.log('Step 1: Discovering all documentation pages...\n');

  const sitemapUrls = await discoverFromSitemap();
  if (sitemapUrls.length) {
    console.log(`Discovered ${sitemapUrls.length} pages from sitemap`);
    for (const url of sitemapUrls) {
      addDiscoveredPage(url);
    }
  } else {
    console.warn('No sitemap entries found; falling back to crawling');
  }

  // Crawl the root to pick up any pages not in sitemap
  await crawlPage('/', 0, 6);

  console.log(`\nDiscovered ${discoveredPages.length} pages\n`);
  console.log('Step 2: Fetching and converting pages...\n');

  // Clear the output directory
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  // Sort pages by path for better organization
  const sortedPages = discoveredPages.sort((a, b) => a.path.localeCompare(b.path));

  for (const docPage of sortedPages) {
    try {
      const content = await fetchPage(docPage);
      await savePage(docPage, content);
      successCount++;

      // Small delay to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      console.error(`✗ Failed to fetch ${docPage.path}`);
      failCount++;
    }
  }

  // Save a manifest file with all discovered pages
  const manifest = {
    fetchedAt: new Date().toISOString(),
    totalPages: discoveredPages.length,
    pages: sortedPages.map((p) => ({ url: p.url, path: p.path })),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  console.log('\n' + '='.repeat(60));
  console.log(`Documentation fetch complete!`);
  console.log(`Success: ${successCount} | Failed: ${failCount}`);
  console.log(`Total pages discovered: ${discoveredPages.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Manifest saved to: ${path.join(OUTPUT_DIR, 'manifest.json')}`);
  console.log('='.repeat(60));
}

// Run the script
fetchAllDocs().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
