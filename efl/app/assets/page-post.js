/* Fantasy EFL — weekly discussion post and image card.

   The text comes from post.js; this page only offers it for copying and
   draws the card. The card is a canvas drawn here, in the browser: no
   upload, no image service, and the file never leaves the device unless
   the reader shares it. */

import { loadSnapshot } from './provider.js';
import { buildContext, playerScore } from './model.js';
import { postModel, postText, cardModel, CARD } from './post.js';
import { esc, mount, initTheme, sourceBanner, errorState, emptyState } from './ui.js';

initTheme();

let model = null;
let cardUrl = null;
let cardFile = null;

start();

async function start() {
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const ctx = buildContext(snapshot);
    const scored = ctx.players.map((p) => playerScore(ctx, p));
    model = postModel(ctx, { scored });
    if (!model) {
      mount('card-body', emptyState('No seven to post yet', 'The model could not build a legal seven from the data available.'));
      return;
    }
    const flavour = document.getElementById('p-flavour');
    const source = document.getElementById('p-source');
    const refresh = () => {
      document.getElementById('p-text').value = postText(model, {
        flavour: flavour.value, sourceLine: source.value === 'on'
      });
      updateCount();
    };
    flavour.addEventListener('change', refresh);
    /* The site address on the card follows the same choice as the post. */
    source.addEventListener('change', () => { refresh(); drawCard(source.value === 'on'); });
    document.getElementById('p-text').addEventListener('input', updateCount);
    document.getElementById('p-copy').disabled = false;
    document.getElementById('p-copy').addEventListener('click', copy);
    refresh();
    setupCardButtons();
    await drawCard(false);
  } catch (err) {
    mount('card-body', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

function updateCount() {
  const text = document.getElementById('p-text').value;
  const discord = document.getElementById('p-flavour').value === 'discord';
  document.getElementById('p-msg').textContent = `${text.length} characters`
    + (discord && text.length > 2000 ? '. Discord allows 2,000 in one message, so trim it or send it in two.' : '.');
}

async function copy() {
  const area = document.getElementById('p-text');
  try {
    await navigator.clipboard.writeText(area.value);
    document.getElementById('p-msg').textContent = 'Copied. Paste it into your post.';
  } catch (_) {
    area.select();
    document.getElementById('p-msg').textContent = 'Select the text and copy it by hand.';
  }
}

/* ── The card ────────────────────────────────────────────── */

const token = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) { return fallback; }
};

function fitText(ctx2d, text, maxWidth) {
  if (ctx2d.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx2d.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function setupCardButtons() {
  const dl = document.getElementById('c-download');
  dl.addEventListener('click', () => {
    if (!cardUrl) return;
    const a = document.createElement('a');
    a.href = cardUrl;
    a.download = `fantasy-efl-round-${model.round}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  const share = document.getElementById('c-share');
  share.addEventListener('click', () => {
    if (cardFile) navigator.share({ files: [cardFile], title: `Fantasy EFL round ${model.round}` }).catch(() => { /* cancelled */ });
  });
}

async function drawCard(withSite) {
  const card = cardModel(model);
  try { await document.fonts.ready; } catch (_) { /* older browsers */ }
  const canvas = document.createElement('canvas');
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const g = canvas.getContext('2d');
  /* Fixed dark colours so the card reads the same wherever it is posted,
     whichever theme the page is in. The accent is the site's own. */
  const BG = '#0F1216'; const PANEL = '#171B21'; const LINE = '#262C34';
  const TEXT = '#F2F4F7'; const MUTED = '#9AA4B0';
  const ACCENT = token('--efl', '#4F5BD5');
  const POS = { GK: '#F5A524', DEF: '#4F8EF7', MID: '#00D26A', FWD: '#FF4D4F' };
  const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

  g.fillStyle = BG; g.fillRect(0, 0, CARD.width, CARD.height);
  g.fillStyle = ACCENT; g.fillRect(0, 0, CARD.width, 12);

  const pad = 72;
  g.fillStyle = MUTED; g.font = `600 30px ${FONT}`;
  g.fillText(card.subtitle.toUpperCase(), pad, 120);
  g.fillStyle = TEXT; g.font = `700 64px ${FONT}`;
  g.fillText(card.title, pad, 200);

  const top = 250; const rowH = 118; const width = CARD.width - pad * 2;
  card.rows.forEach((r, i) => {
    const y = top + i * rowH;
    g.fillStyle = PANEL; g.fillRect(pad, y, width, rowH - 14);
    g.fillStyle = POS[r.position] || ACCENT; g.fillRect(pad, y, 8, rowH - 14);
    g.fillStyle = POS[r.position] || ACCENT; g.font = `700 26px ${FONT}`;
    g.fillText(r.position, pad + 32, y + 44);
    const nameX = pad + 130;
    g.fillStyle = TEXT; g.font = `700 38px ${FONT}`;
    const name = fitText(g, r.name + (r.captain ? '  (C)' : ''), width - 330);
    g.fillText(name, nameX, y + 46);
    g.fillStyle = MUTED; g.font = `500 26px ${FONT}`;
    g.fillText(fitText(g, `${r.club} · ${r.fixture}`, width - 330), nameX, y + 86);
    g.fillStyle = TEXT; g.font = `700 44px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(r.rating, pad + width - 32, y + 66);
    g.textAlign = 'left';
  });

  const after = top + card.rows.length * rowH + 16;
  g.strokeStyle = LINE; g.lineWidth = 2;
  g.beginPath(); g.moveTo(pad, after); g.lineTo(CARD.width - pad, after); g.stroke();
  g.fillStyle = TEXT; g.font = `600 30px ${FONT}`;
  if (card.clubs.length) g.fillText(fitText(g, `Clubs: ${card.clubs.join(' and ')}`, width), pad, after + 52);
  g.fillStyle = MUTED; g.font = `500 26px ${FONT}`;
  g.fillText(`${card.footer} · ratings out of 100`, pad, CARD.height - (withSite ? 92 : 60));
  if (withSite) g.fillText(card.site, pad, CARD.height - 52);

  /* A data: URL, not a blob: one. The site's CSP allows data: images and
     nothing else off-origin, which keeps blob: out of img-src for good. */
  const url = canvas.toDataURL('image/png');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  cardUrl = url;
  const alt = `Image card: ${card.title}, ${card.subtitle.toLowerCase()}. `
    + `${card.rows.map((r) => `${r.position} ${r.name}${r.captain ? ' (captain)' : ''}, ${r.club}, rated ${r.rating}`).join('; ')}.`;
  mount('card-body', `<img src="${url}" alt="${esc(alt)}"`
    + ' style="width:100%;max-width:540px;height:auto;border-radius:12px;display:block">');

  document.getElementById('c-download').disabled = false;
  cardFile = new File([blob], `fantasy-efl-round-${model.round}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [cardFile] })) {
    document.getElementById('c-share').hidden = false;
  }
}
