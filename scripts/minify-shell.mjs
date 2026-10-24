/* Minify the inline <script> and <style> blocks of a built HTML shell.

   index.html is the one source of truth and is written to be read: about a
   quarter of it is comments explaining why the code is the way it is. Every
   visitor used to download those comments too, 467KB of them, on the first
   load of a phone that may be on a train. The build now ships the same code
   without them; the source in the repository keeps every word.

   What it does, and deliberately does not do:
   - JavaScript: whitespace, comments and safe syntax shortening only.
     Identifiers are NOT renamed. The app is a classic script whose top-level
     functions are called by name from inline handlers (onclick="openPanel()")
     and by tests, so renaming them would break the page.
   - CSS: esbuild's CSS minifier.
   - Script blocks of any other type (JSON-LD, templates) and external
     scripts are left exactly as written.
   - Markup is not touched: its comments come to a few KB and some carry
     meaning for the build. */
import { transform } from 'esbuild';

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

export async function minifyShell(html) {
  const jobs = [];
  const out = [];
  let last = 0;
  /* HTML comments are matched first and passed through untouched: the shell
     has comments that mention "<script src>" in prose, and a scanner that
     took one for a tag would swallow everything up to the next real one. */
  const re = /<!--[\s\S]*?-->|<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [whole, tag, attrs = '', body] = m;
    out.push(html.slice(last, m.index));
    last = m.index + whole.length;
    if (!tag) { out.push(whole); continue; }
    const isScript = tag.toLowerCase() === 'script';
    const type = ((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '').toLowerCase();
    const external = isScript && /\bsrc\s*=/i.test(attrs);
    if (!body.trim() || external || (isScript && !JS_TYPES.has(type))) { out.push(whole); continue; }
    const idx = out.length;
    out.push(whole);
    jobs.push(transform(body, isScript
      ? { loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
          legalComments: 'none', format: type === 'module' ? 'esm' : undefined }
      : { loader: 'css', minify: true, legalComments: 'none' })
      .then((r) => {
        /* A closing tag inside a string would end the block early; esbuild
           escapes </script, but never let the output be the thing that adds one. */
        const code = r.code.trim();
        if (new RegExp('</' + tag, 'i').test(code)) return;
        out[idx] = '<' + tag + attrs + '>' + code + '</' + tag + '>';
      }));
  }
  out.push(html.slice(last));
  await Promise.all(jobs);
  return out.join('');
}
