// Lightweight regex syntax highlighter. Returns HTML with token spans.
import { esc } from './util.js';

const KW = {
  js: 'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import export from default null undefined true false void delete static get set',
  ts: 'const let var function return if else for while switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import export from default null undefined true false void delete interface type enum implements public private protected readonly as satisfies namespace declare abstract static get set',
  py: 'def class return if elif else for while break continue import from as try except finally raise with lambda yield global nonlocal pass assert del in is not and or None True False async await match case self',
  go: 'func package import return if else for range switch case break continue type struct interface map chan go defer var const nil true false select',
  rust: 'fn let mut pub use mod struct enum impl trait match if else for while loop return break continue self Self where async await move ref as dyn const static true false Some None Ok Err',
  java: 'public private protected class interface extends implements return if else for while switch case break continue new static final void int long double float boolean char String this super try catch finally throw throws import package null true false',
  c: 'int char float double void return if else for while switch case break continue struct typedef const static sizeof enum union unsigned signed long short goto',
  sql: 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null distinct count sum avg',
};
KW.cpp = KW.c + ' class namespace template public private protected new delete using virtual override';

const grammar = {
  line: { js: /\/\/[^\n]*/, py: /#[^\n]*/, sh: /#[^\n]*/, sql: /--[^\n]*/ },
  block: { js: /\/\*[\s\S]*?\*\// },
};

function buildRegex(lang) {
  const kw = (KW[lang] || KW.js).trim().split(/\s+/).join('|');
  const line = (grammar.line[lang] || grammar.line.js).source;
  const block = (grammar.block.js).source;
  const str = String.raw`\`(?:\\.|[^\`\\])*\`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
  const num = String.raw`\b0x[\da-fA-F]+\b|\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b`;
  return new RegExp(`(${block})|(${line})|(${str})|(${num})|\\b(${kw})\\b|([A-Za-z_$][\\w$]*)(?=\\s*\\()`, 'g');
}
const cache = {};

export function highlight(code, lang = 'text') {
  if (lang === 'json') return highlightJson(code);
  if (lang === 'html') return highlightHtml(code);
  if (lang === 'css') return highlightCss(code);
  if (lang === 'md') return esc(code);
  if (!/^(js|ts|py|go|rust|java|c|cpp|sql|sh|yaml)$/.test(lang)) return esc(code);
  const rx = cache[lang] || (cache[lang] = buildRegex(lang));
  rx.lastIndex = 0;
  let out = '', last = 0, m;
  while ((m = rx.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="tk-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-com">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-str">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="tk-num">${esc(m[4])}</span>`;
    else if (m[5]) out += `<span class="${/^(true|false|null|None|True|False|nil|undefined)$/.test(m[5]) ? 'tk-bool' : 'tk-key'}">${esc(m[5])}</span>`;
    else if (m[6]) out += `<span class="tk-fn">${esc(m[6])}</span>`;
    last = rx.lastIndex;
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  out += esc(code.slice(last));
  return out;
}

function highlightJson(code) {
  return esc(code)
    .replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)/g, '<span class="tk-key">$1</span>$2')
    .replace(/:\s*(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)/g, ': <span class="tk-str">$1</span>')
    .replace(/\b(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, '<span class="tk-num">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tk-bool">$1</span>');
}
function highlightHtml(code) {
  return esc(code)
    .replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="tk-tag">$2</span>')
    .replace(/([a-zA-Z-]+)(=)(&quot;[^&]*?&quot;)/g, '<span class="tk-attr">$1</span>$2<span class="tk-str">$3</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tk-com">$1</span>');
}
function highlightCss(code) {
  return esc(code)
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tk-com">$1</span>')
    .replace(/([.#]?[\w-]+)(\s*\{)/g, '<span class="tk-tag">$1</span>$2')
    .replace(/([\w-]+)(\s*:)/g, '<span class="tk-attr">$1</span>$2')
    .replace(/(:\s*)([^;{}\n]+)(;)/g, '$1<span class="tk-str">$2</span>$3');
}
