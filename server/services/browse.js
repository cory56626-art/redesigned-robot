// Real web browsing used by the Research agent and the Browser panel.
import { logger } from '../utils/logger.js';
import { cached } from '../utils/cache.js';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) : '';
}

export async function webFetch(url, { maxChars = 8000 } = {}) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  logger.agent('browse', `fetch ${url}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AurelResearch/1.0)', Accept: 'text/html,application/xhtml+xml,application/json' },
    });
    const ct = res.headers.get('content-type') || '';
    const raw = await res.text();
    let text, title = '';
    if (ct.includes('application/json')) { text = raw.slice(0, maxChars); }
    else { title = titleOf(raw); text = stripHtml(raw).slice(0, maxChars); }
    return { url: res.url || url, status: res.status, title, contentType: ct, text, truncated: raw.length > maxChars };
  } catch (e) {
    return { url, status: 0, title: '', text: `Failed to fetch: ${e.message}`, error: true };
  } finally { clearTimeout(timer); }
}

// Lightweight search via DuckDuckGo's HTML endpoint.
export async function webSearch(query, { limit = 6 } = {}) {
  return cached('search:' + query, 5 * 60 * 1000, async () => {
    logger.agent('browse', `search "${query}"`);
    try {
      const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AurelResearch/1.0)' },
      });
      const html = await res.text();
      const results = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && results.length < limit) {
        let href = m[1];
        const um = href.match(/uddg=([^&]+)/);
        if (um) href = decodeURIComponent(um[1]);
        results.push({ title: stripHtml(m[2]).slice(0, 160), url: href });
      }
      if (!results.length) return { query, results: [], note: 'No results parsed (search may be rate-limited).' };
      return { query, results };
    } catch (e) {
      return { query, results: [], error: e.message };
    }
  });
}
