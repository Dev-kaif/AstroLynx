// src/advancedCrawler.ts

import Crawler from "simplecrawler";
import { URL } from "url";
import { processDocumentLink, PERMANENT_DOWNLOAD_DIR } from "./documentParser";
import { exportToPdf, ExtractedContent } from "./pdfExporter";
import * as fsp from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// src/crawler.ts

import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CrawlResult {
  url: string;
  title: string | null;
  extractedText: string;
  links: string[];
  documentLinks: { url: string; type: 'pdf' | 'docx' | 'xlsx' | 'unknown' }[];
  error?: string;
}

export async function crawlPage(url: string): Promise<CrawlResult> {
  const result: CrawlResult = {
    url,
    title: null,
    extractedText: '',
    links: [],
    documentLinks: [],
  };

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'AstroLynx-Bot/1.0 (+https://www.mosdac.gov.in/)',
      },
      timeout: 5000,
      decompress: true,
    });

    if (response.status !== 200) {
      result.error = `Failed to fetch page, status: ${response.status}`;
      return result;
    }

    const $ = cheerio.load(response.data);

    result.title = $('title').text().trim() || null;

    const textElements = $('p, h1, h2, h3, h4, h5, h6, li, span.content, div.article-body, div.text-content, .main-content');
    let pageText = '';
    textElements.each((_i, el) => {
      const text = $(el).text().trim();
      if (text) {
        pageText += text + '\n';
      }
    });
    result.extractedText = pageText.trim();

    $('a').each((_i, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, url).href;

          if (absoluteUrl.startsWith('http://') || absoluteUrl.startsWith('https://')) {
            const skipExtensions = /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico)$/i;
            if (skipExtensions.test(absoluteUrl)) {
              return;
            }

            result.links.push(absoluteUrl);

            const lowerCaseUrl = absoluteUrl.toLowerCase();
            if (lowerCaseUrl.endsWith('.pdf')) {
              result.documentLinks.push({ url: absoluteUrl, type: 'pdf' });
            } else if (lowerCaseUrl.endsWith('.docx') || lowerCaseUrl.endsWith('.doc')) {
              result.documentLinks.push({ url: absoluteUrl, type: 'docx' });
            } else if (lowerCaseUrl.endsWith('.xlsx') || lowerCaseUrl.endsWith('.xls')) {
              result.documentLinks.push({ url: absoluteUrl, type: 'xlsx' });
            }
          }
        } catch {}
      }
    });

    result.links = Array.from(new Set(result.links));
    const uniqueDocLinksMap = new Map<string, { url: string; type: 'pdf' | 'docx' | 'xlsx' | 'unknown' }>();
    result.documentLinks.forEach(doc => uniqueDocLinksMap.set(doc.url, doc));
    result.documentLinks = Array.from(uniqueDocLinksMap.values());

  } catch (error: any) {
    result.error = `Error crawling ${url}: ${error.message}`;
  }

  return result;
}


const START_URL = "https://www.mosdac.gov.in/sitemap";
const ALLOWED_DOMAIN = "mosdac.gov.in";
const MAX_CRAWL_DEPTH = 3;
const CRAWL_DELAY_MS = 300;
const MAX_CONCURRENT_REQUESTS = 20;
const FETCH_TIMEOUT_MS = 30000;
const MAX_PARSE_DOCUMENT_SIZE_BYTES = 0 * 1024 * 1024;
const MAX_URLS_TO_PROCESS = 500;

const OUTPUT_PDF_FILENAME = "mosdac_exported_content.pdf";
const OUTPUT_PDF_PATH = path.join(__dirname, "..", OUTPUT_PDF_FILENAME);

const processedUrls = new Set<string>();
const collectedContent: ExtractedContent[] = [];
let activeDownloads = 0;
let lastActivity = Date.now();

function normalizeUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        url.hash = "";
        url.search = "";
        return url.toString();
    } catch {
        return rawUrl;
    }
}

function getQueueLengthAsync(queue: any): Promise<number> {
    return new Promise((resolve, reject) => {
        queue.getLength((err: any, length: number) => {
            if (err) reject(err);
            else resolve(length);
        });
    });
}


(async function startCrawler() {
    console.log(`[Crawler] Starting at ${START_URL}`);
    await fsp.mkdir(PERMANENT_DOWNLOAD_DIR, { recursive: true });

    const crawler = new Crawler(START_URL);
    crawler.maxDepth = MAX_CRAWL_DEPTH;
    crawler.interval = CRAWL_DELAY_MS;
    crawler.maxConcurrency = MAX_CONCURRENT_REQUESTS;
    crawler.timeout = FETCH_TIMEOUT_MS;

    crawler.addFetchCondition(queueItem => {
        const normalized = normalizeUrl(queueItem.url);
        const urlObj = new URL(queueItem.url);
        const ext = path.extname(urlObj.pathname).toLowerCase();

        if (processedUrls.has(normalized)) return false;
        if (!urlObj.hostname.includes(ALLOWED_DOMAIN)) return false;
        if ([".css", ".js", ".mjs"].includes(ext)) return false;
        if (/\.(png|jpg|jpeg|gif|svg|ico|mp4|mp3|webp|woff|woff2|ttf|eot)$/i.test(ext)) return false;

        return processedUrls.size < MAX_URLS_TO_PROCESS;
    });

    crawler.on("fetchcomplete", async (queueItem) => {
        const url = normalizeUrl(queueItem.url);
        if (processedUrls.has(url)) return;
        processedUrls.add(url);
        lastActivity = Date.now();

        const queueLength = await getQueueLengthAsync(crawler.queue);
        console.log(`[Crawling] ${url} | Queue length: ${queueLength}`);

        try {
            const contentType = queueItem.stateData.contentType || "";
            if (contentType.includes("text/html")) {
                const result: CrawlResult = await crawlPage(url);
                if (result.extractedText.trim()) {
                    collectedContent.push({
                        url,
                        type: "webpage",
                        title: result.title,
                        content: result.extractedText,
                    });
                }
                for (const link of result.documentLinks) {
                    const normalizedLink = normalizeUrl(link.url);
                    if (!processedUrls.has(normalizedLink) && processedUrls.size < MAX_URLS_TO_PROCESS) {
                        crawler.queueURL(link.url);
                    }
                }
            } else if (contentType.includes("application/pdf")) {
                activeDownloads++;
                try {
                    const result = await processDocumentLink(url, "pdf", MAX_PARSE_DOCUMENT_SIZE_BYTES);
                    if (result?.text) {
                        collectedContent.push({
                            url,
                            type: "pdf",
                            title: path.basename(url),
                            content: result.text,
                        });
                    }
                } catch (err) {
                    console.error(`[Error] PDF parse failed for ${url}: ${err}`);
                } finally {
                    activeDownloads--;
                }
            }
        } catch (err) {
            console.error(`[Error] Processing ${url}: ${err}`);
        }
    });

    const interval = setInterval(async () => {
        const idleTime = Date.now() - lastActivity;
        const queueLength = await getQueueLengthAsync(crawler.queue);
        if (queueLength === 0 && activeDownloads === 0) {
            console.log("✅ Queue empty and all downloads complete. Generating PDF...");
            clearInterval(interval);
            await exportToPdf(collectedContent, OUTPUT_PDF_PATH);
            console.log(`✅ PDF generated: ${OUTPUT_PDF_PATH}`);
            process.exit(0);
        } else if (idleTime > 300000) { // 5 min no new activity
            console.warn("⚠️ No activity for 5 min, force exiting.");
            clearInterval(interval);
            await exportToPdf(collectedContent, OUTPUT_PDF_PATH);
            console.log(`✅ PDF generated: ${OUTPUT_PDF_PATH}`);
            process.exit(0);
        }
    }, 5000);

    crawler.start();
})();
