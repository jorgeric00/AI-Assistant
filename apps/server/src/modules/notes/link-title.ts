const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Título de una página HTML: og:title si existe, si no <title>. */
export function extractTitle(html: string): string | null {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const raw = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : '';
  return title || null;
}

/** Descarga la página (máx. 512 KB, 5 s) y devuelve su título. Cualquier fallo devuelve null. */
export async function fetchLinkTitle(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (AI-Assistant)' },
    });
    if (!res.ok || !res.body || !/html/i.test(res.headers.get('content-type') ?? '')) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => {});
    return extractTitle(html);
  } catch {
    return null;
  }
}
