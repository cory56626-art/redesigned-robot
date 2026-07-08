// Minimal, safe-ish Markdown renderer with highlighted, copyable code blocks.
import { esc } from './util.js';
import { highlight } from './highlight.js';

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

export function renderMarkdown(src = '') {
  const parts = src.split(/(```[\s\S]*?```)/g);
  let html = '';
  for (const part of parts) {
    if (part.startsWith('```')) {
      const m = part.match(/^```([\w+-]*)\n?([\s\S]*?)```$/);
      const lang = (m?.[1] || 'text').toLowerCase();
      const code = m?.[2] || '';
      // Never surface raw tool-call blocks to the user.
      if (lang === 'action' || lang === 'aurel') { html += '<div style="font-size:11px;color:var(--faint);font-style:italic;margin:4px 0">⚙ tool call executed</div>'; continue; }
      const b64 = btoa(unescape(encodeURIComponent(code)));
      html += `<div class="codeblock"><div class="cb-head"><span>${esc(lang)}</span><button class="copy-btn" data-copy="${b64}">Copy</button></div><pre><code>${highlight(code.replace(/\n$/, ''), lang)}</code></pre></div>`;
      continue;
    }
    html += renderBlocks(part);
  }
  return html;
}

function renderBlocks(text) {
  const lines = text.split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#{1,6})/)[1].length;
      out += `<h${level}>${inline(line.replace(/^#{1,6}\s/, ''))}</h${level}>`; i++; continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { out += '<hr/>'; i++; continue; }
    if (/^\s*>/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue;
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      let buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) { buf.push(inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s/, ''))); i++; }
      out += `<${ordered ? 'ol' : 'ul'}>${buf.map((b) => `<li>${b}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (line.includes('|') && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(lines[i]); i++; }
      out += renderTable(rows); continue;
    }
    let buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) { buf.push(lines[i]); i++; }
    out += `<p>${inline(buf.join('\n')).replace(/\n/g, '<br/>')}</p>`;
  }
  return out;
}

function renderTable(rows) {
  const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
