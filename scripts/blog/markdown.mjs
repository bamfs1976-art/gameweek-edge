/* Gameweek Edge — a small markdown renderer for the articles pipeline.

   Deliberately a subset, written here rather than added as a dependency:
   headings, paragraphs, bold, italic, inline code, links, images, bullet
   and numbered lists, block quotes, fenced code and a rule. Everything is
   HTML-escaped before any markup is applied, so a post can never inject
   markup. content/posts/README.md documents the subset. */

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Front matter: a --- block of key: value lines at the top. Values are
   strings; `tags` splits on commas; `draft` reads true/false. */
export function frontMatter(src) {
  const m = String(src).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: String(src) };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (kv[1] === 'tags') v = v.split(',').map((t) => t.trim()).filter(Boolean);
    else if (kv[1] === 'draft') v = /^(true|yes|1)$/i.test(v);
    meta[kv[1]] = v;
  }
  return { meta, body: String(src).slice(m[0].length) };
}

function inline(t) {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => '<img src="' + src + '" alt="' + alt + '" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => '<a href="' + href + '"' + (/^https?:\/\//.test(href) ? ' rel="noopener"' : '') + '>' + txt + '</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

export function renderMarkdown(body) {
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush(); const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const n = h[1].length + 1; out.push('<h' + n + '>' + inline(h[2].trim()) + '</h' + n + '>'); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush(); const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push('<blockquote><p>' + inline(q.join(' ')) + '</p></blockquote>'); continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flush(); const ordered = /^\s*\d+\./.test(line); const items = [];
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>'); continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flush();
  return out.join('\n');
}

/* Plain text from markdown, for a description that was not written. */
export function excerpt(body, max) {
  const t = renderMarkdown(body).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
  const n = max || 160;
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…';
}
