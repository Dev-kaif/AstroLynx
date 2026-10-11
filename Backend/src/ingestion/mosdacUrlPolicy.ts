const ALLOWED_HOSTS = new Set(["mosdac.gov.in", "www.mosdac.gov.in"]);
const TRACKING_PARAMETER = /^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid)$/i;

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlPolicyError";
  }
}

export function isAllowedMosdacHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname.toLowerCase().replace(/\.$/u, ""));
}

/** Canonicalize a URL without discarding catalog query parameters. */
export function canonicalizeMosdacUrl(
  value: string,
  baseUrl?: string
): string {
  let url: URL;
  try {
    url = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    throw new UrlPolicyError(`Invalid URL: ${value}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlPolicyError(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UrlPolicyError("URLs containing user information are not allowed");
  }
  if (!isAllowedMosdacHost(url.hostname)) {
    throw new UrlPolicyError(`Host is outside the MOSDAC allowlist: ${url.hostname}`);
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  return url.toString();
}

export function isLikelyDocumentUrl(urlValue: string): boolean {
  const pathname = new URL(urlValue).pathname.toLowerCase();
  return /\.(pdf|docx?|xlsx?)$/u.test(pathname);
}

export function isCandidateMosdacUrl(urlValue: string): boolean {
  const pathname = new URL(urlValue).pathname.toLowerCase();
  const extension = pathname.match(/\.([a-z0-9]+)$/u)?.[1];
  if (!extension) return true;
  return /^(?:pdf|docx?|xlsx?|xml|html?|php|asp|aspx|jsp)$/u.test(extension);
}

export function shouldSkipAssetUrl(urlValue: string): boolean {
  const pathname = new URL(urlValue).pathname.toLowerCase();
  return /\.(?:css|js|mjs|png|jpe?g|gif|svg|ico|webp|avif|mp4|mp3|woff2?|ttf|eot)$/u.test(
    pathname
  );
}
