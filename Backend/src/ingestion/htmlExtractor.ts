import { createHash } from "node:crypto";
import { load } from "cheerio";
import { canonicalizeMosdacUrl, isLikelyDocumentUrl, shouldSkipAssetUrl } from "./mosdacUrlPolicy";

export interface ExtractedHtmlPage {
  title: string | null;
  headings: string[];
  text: string;
  links: string[];
  documentLinks: string[];
  selectorUsed: string;
  extractionStatus: "static_html_extracted" | "needs_browser_render";
  extractionSignals: string[];
  feedEntries?: FeedEntry[];
  feedIsComplete?: boolean;
}

export interface FeedEntry {
  entryId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  acquisitionStart: string | null;
  productName: string | null;
  previewUrl: string | null;
  url: string | null;
}

function isPreviewAsset(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(url.pathname);
  } catch {
    return false;
  }
}

function stableFeedEntryId(entry: {
  url: string | null;
  productName: string | null;
  acquisitionStart: string | null;
  title: string | null;
  publishedAt: string | null;
  description: string | null;
}, sourceUrl: string): string {
  const normalize = (value: string | null) =>
    value?.normalize("NFKC").trim().toLowerCase() ?? "";
  const identity = entry.url
    ? `url:${normalize(entry.url)}`
    : entry.productName
      ? `product:${normalize(entry.productName)}\0acquisition:${normalize(entry.acquisitionStart)}`
      : JSON.stringify([
          normalize(entry.title),
          normalize(entry.acquisitionStart),
          normalize(entry.publishedAt),
          normalize(entry.description),
        ]);
  return createHash("sha256").update(identity || sourceUrl).digest("hex");
}

const CONTENT_CANDIDATES = [
  "main",
  '[role="main"]',
  "article",
  ".main-content",
  ".content-area",
  "#content",
  "body",
];

const REMOVE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "nav",
  "footer",
  "aside",
  "form",
  '[role="navigation"]',
  ".breadcrumb",
  ".breadcrumbs",
  ".menu",
  ".sidebar",
  ".footer",
  ".header",
];

function normalizeLines(value: string): string[] {
  return value
    .replace(/\u00a0/gu, " ")
    .split(/\n+/u)
    .map((line) => line.replace(/[\t ]+/gu, " ").trim())
    .filter(Boolean);
}

export function extractHtmlPage(
  html: string,
  sourceUrl: string,
  options: { javascriptRendered?: boolean } = {}
): ExtractedHtmlPage {
  const $ = load(html);
  $("header, footer").each((_, element) => {
    const wrapper = $(element);
    if (!wrapper.find("main, article, table, [role='main']").length) {
      wrapper.remove();
    }
  });
  $("[aria-hidden='true']").each((_, element) => {
    const wrapper = $(element);
    if (!wrapper.find("main, article, table, [role='main']").length) {
      wrapper.remove();
    }
  });
  for (const selector of REMOVE_SELECTORS) $(selector).remove();

  let selectorUsed = "body";
  let bestRoot = $("body");
  let bestLength = 0;
  for (const selector of CONTENT_CANDIDATES.slice(0, -1)) {
    const candidate = $(selector).first();
    if (!candidate.length) continue;
    const length = candidate.text().trim().length;
    if (length > bestLength) {
      selectorUsed = selector;
      bestRoot = candidate as typeof bestRoot;
      bestLength = length;
    }
  }
  if (bestLength < 80) {
    selectorUsed = "body";
    bestRoot = $("body");
  }

  const headings = bestRoot
    .find("h1, h2, h3, h4")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter(Boolean);

  const contentLines: string[] = [];
  bestRoot.find("h1, h2, h3, h4, p, li, caption, tr, blockquote").each((_, el) => {
    const element = $(el);
    if (element.is("tr")) {
      const cells = element
        .find("th, td")
        .toArray()
        .map((cell) => $(cell).text().trim())
        .filter(Boolean);
      if (cells.length) contentLines.push(cells.join(" | "));
      return;
    }
    const text = element.text().trim();
    if (text) contentLines.push(text);
  });

  // Some sites place meaningful text in div/span structures rather than
  // paragraphs. Use the selected content block only when semantic blocks are
  // absent or nearly empty; this avoids letting a small toolbar fragment hide
  // an otherwise readable body or table.
  if (contentLines.join("\n").trim().length < 80) {
    contentLines.splice(0, contentLines.length, ...normalizeLines(bestRoot.text()));
  }

  // Preserve repeated table rows and values; repetition is evidence for the
  // downstream quality scorer, not a reason to silently delete source text.
  const normalizedLines = contentLines.flatMap(normalizeLines);

  const links = new Set<string>();
  const documentLinks = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const url = canonicalizeMosdacUrl(href, sourceUrl);
      if (shouldSkipAssetUrl(url)) return;
      links.add(url);
      if (isLikelyDocumentUrl(url)) documentLinks.add(url);
    } catch {
      // External and malformed links are intentionally excluded.
    }
  });

  const pageTitle = $("title").first().text().trim();
  const unresolvedTemplates = /\{\{[^{}]{1,160}\}\}/u.test(normalizedLines.join("\n"));
  const modernAngularShell = $("app-root, [ng-version], [ngcspnonce]").length > 0 ||
    /<app-root\b|ngcspnonce|(?:main|polyfills|runtime)-[a-z0-9_-]+\.js/iu.test(html);
  const angularMarkers = $("[ng-app], [ng-repeat], [\*ngFor]").length > 0 ||
    /angular(?:\.min)?\.js|ng-app/iu.test(html) || modernAngularShell;
  const extractionSignals: string[] = [];
  if (unresolvedTemplates) extractionSignals.push("unresolved_template_bindings");
  if (angularMarkers) extractionSignals.push("javascript_application_markers");
  if (modernAngularShell && normalizedLines.join("\n").length < 80) {
    extractionSignals.push("empty_client_application_root");
  }
  const needsBrowserRender = unresolvedTemplates ||
    (!options.javascriptRendered && angularMarkers && normalizedLines.join("\n").length < 1200);
  return {
    title: pageTitle || headings[0] || null,
    headings: [...new Set(headings)],
    text: normalizedLines.join("\n"),
    links: [...links],
    documentLinks: [...documentLinks],
    selectorUsed,
    extractionStatus: needsBrowserRender ? "needs_browser_render" : "static_html_extracted",
    extractionSignals,
    feedEntries: [],
  };
}

/** Extract feed text and entry URLs without treating feed metadata as web chrome. */
export function extractXmlFeed(xml: string, sourceUrl: string): ExtractedHtmlPage {
  const $ = load(xml, { xmlMode: true });
  const title = $("channel > title").first().text().trim() || null;
  const rootIsComplete = /<rss\b[^>]*>[\s\S]*<\/rss\s*>/iu.test(xml) ||
    /<feed\b[^>]*>[\s\S]*<\/feed\s*>/iu.test(xml);
  const textLines: string[] = [];
  const links = new Set<string>();
  const feedEntries: FeedEntry[] = [];

  $("item, entry").each((_, item) => {
    const entry = $(item);
    const entryTitle = entry.children("title").first().text().trim();
    const description =
      entry.children("description, summary, content").first().text().trim();
    const published =
      entry.children("pubDate, published, updated").first().text().trim();
    const fields = new Map<string, string>();
    for (const child of entry.children().toArray()) {
      const localName = (child.tagName ?? "").split(":").pop()?.toLowerCase();
      if (localName) fields.set(localName, $(child).text().trim());
    }
    const entryParts = [
      entryTitle,
      fields.get("productname"),
      fields.get("acquisitionstartdate"),
      published,
      description,
    ].filter((part): part is string => Boolean(part));
    if (entryParts.length) textLines.push(entryParts.join("\n"));

    const candidateLinks = [
      entry.children("link").first().text().trim(),
      entry.children("guid").first().text().trim(),
      entry.children("link[rel=\"alternate\"]").attr("href") ?? "",
    ];
    let canonicalEntryUrl: string | null = null;
    for (const candidate of candidateLinks) {
      if (!candidate) continue;
      try {
        const canonical = canonicalizeMosdacUrl(candidate, sourceUrl);
        if (isPreviewAsset(canonical)) continue;
        canonicalEntryUrl = canonical;
        links.add(canonical);
        break;
      } catch {
        // Some feeds use GUIDs that are not URLs; ignore them.
      }
    }

    let previewUrl: string | null = null;
    const previewCandidate = fields.get("preview") ?? "";
    if (previewCandidate) {
      try {
        previewUrl = canonicalizeMosdacUrl(previewCandidate, sourceUrl);
      } catch {
        previewUrl = null;
      }
    }
    const entryDescription =
      fields.get("description") ?? fields.get("summary") ?? fields.get("content") ?? null;
    const acquisitionStart = fields.get("acquisitionstartdate") ?? null;
    const productName = fields.get("productname") ?? null;
    feedEntries.push({
      entryId: stableFeedEntryId(
        {
          url: canonicalEntryUrl,
          productName,
          acquisitionStart,
          title: entryTitle || null,
          publishedAt: published || null,
          description: entryDescription,
        },
        sourceUrl
      ),
      title: entryTitle || null,
      description: entryDescription,
      publishedAt: published || null,
      acquisitionStart,
      productName,
      previewUrl,
      url: canonicalEntryUrl,
    });
  });

  const normalizedLines = textLines.flatMap(normalizeLines);
  const documentLinks = [...links].filter(isLikelyDocumentUrl);
  const extractionSignals = rootIsComplete ? [] : ["invalid_or_truncated_xml_feed"];
  return {
    title,
    headings: [],
    text: normalizedLines.join("\n"),
    links: [...links],
    documentLinks,
    selectorUsed: "rss-item/atom-entry",
    extractionStatus: "static_html_extracted",
    extractionSignals,
    feedEntries,
    feedIsComplete: rootIsComplete,
  };
}
