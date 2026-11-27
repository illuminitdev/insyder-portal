import { lookup } from "node:dns/promises";
import { isIP } from "node:net";


const TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function privateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIP(ip: string) {
  if (isIP(ip) === 4) return privateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIPv4(mapped[1]!);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

async function publicUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return null;
  }
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIP(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

/** GET the page, following redirects only to public addresses. Returns the final URL and up to MAX_HTML_BYTES of HTML. */
async function fetchHtml(start: string): Promise<{ url: URL; html: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let next = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await publicUrl(next);
      if (!url) return null;
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; InsyderBot/1.0)", accept: "text/html,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) return null;
        next = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        return null;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      await reader.cancel().catch(() => undefined);
      return { url, html: Buffer.concat(chunks).toString("utf8").slice(0, MAX_HTML_BYTES) };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
  return v === null ? null : v.replace(/&amp;/g, "&").trim();
}

/** Largest side from a sizes attribute ("180x180", "any" = vector) */
function sizeOf(sizes: string | null, href: string): number {
  if (sizes?.toLowerCase().includes("any") || /\.svg(\?|$)/i.test(href)) return 512;
  const nums = (sizes ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : 0;
}

function absolute(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function logoFromHtml(html: string, base: URL): string | null {
  const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
  const candidates: Array<{ url: string; score: number }> = [];

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    const href = attr(tag, "href");
    if (!href) continue;
    const url = absolute(href, base);
    if (!url) continue;
    const size = sizeOf(attr(tag, "sizes"), href);
    if (rel.includes("apple-touch-icon")) candidates.push({ url, score: 2000 + (size || 180) });
    else if (/(^|\s)icon(\s|$)/.test(rel) || rel.includes("shortcut")) candidates.push({ url, score: 1000 + size });
  }
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (!content || (key !== "og:logo" && key !== "logo")) continue;
    const url = absolute(content, base);
    if (url) candidates.push({ url, score: 1500 });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url ?? null;
}

/** The logo address of a website, or null when the site can't be read. Never throws. */
export async function findSiteLogo(website: string | null | undefined): Promise<string | null> {
  if (!website) return null;
  const page = await fetchHtml(website);
  if (!page) return null;
  const found = logoFromHtml(page.html, page.url) ?? new URL("/favicon.ico", page.url).toString();
  return found.length <= 2000 ? found : null;
}
