/* Fantasy EFL — availability admin.

   Edits the team news document and hands it back as a file. There is no
   server write here on purpose: the site is static and stores nothing
   about anyone, and a page that could change what every reader sees would
   need an account to guard it. So the draft lives in this browser, and the
   change goes live the honest way, as a commit someone can read.

   Every write goes through normaliseManualDoc(), the same reader the site
   uses, so the admin page cannot produce a file the site would reject. */

import { loadSnapshot, readConfig } from './provider.js';
import { POSITION_NAMES, AVAILABILITY_LABELS } from './model.js';
import {
  normaliseManualDoc, normaliseEntry, serialiseManualDoc, isActive, ago, NOTE_MAX
} from './availability.js';
import { esc, mount, initTheme, errorState, flagBadge } from './ui.js';

initTheme();

const DRAFT_KEY = 'ge-efl-availability-draft';
let snapshot = null;
let players = [];
let byId = new Map();
let clubById = {};
let doc = { entries: [] };
let editing = null;     // player being edited

start();

async function start() {
  try {
    const cfg = readConfig();
    /* The committed file, read raw rather than through the snapshot, so
       expired and unmatched entries are still here to edit or remove. */
    const [snap, committed] = await Promise.all([
      loadSnapshot(),
      fetch(cfg.availabilityUrl, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : { entries: [] }))
        .catch(() => ({ entries: [] }))
    ]);
    snapshot = snap;
    players = snap.players;
    byId = new Map(players.map((p) => [p.id, p]));
    clubById = Object.fromEntries(snap.clubs.map((c) => [c.id, c]));

    const draft = readDraft();
    doc = normaliseManualDoc(draft ? draft.doc : committed);
    mount('draft-note', draft
      ? `<p class="note note-sample" style="margin-bottom:14px">Working from your draft, saved
          ${esc(ago(draft.savedAt))}. It is not live until you download it and commit it.</p>`
      : '<p class="note note-method" style="margin-bottom:14px">Working from the file the site is '
        + 'serving now. Changes save here as a draft as you go.</p>');

    const search = document.getElementById('a-search');
    search.disabled = false;
    search.addEventListener('input', () => renderResults(search.value));
    document.getElementById('a-form').addEventListener('submit', (e) => { e.preventDefault(); saveEntry(); });
    document.getElementById('a-cancel').addEventListener('click', closeForm);
    document.getElementById('a-note').addEventListener('input', countNote);
    document.getElementById('a-prune').addEventListener('click', prune);
    document.getElementById('a-download').addEventListener('click', download);
    document.getElementById('a-copy').addEventListener('click', copy);
    document.getElementById('a-discard').addEventListener('click', discard);
    renderList();
  } catch (err) {
    mount('a-list', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* ── Draft storage ───────────────────────────────────────── */

function readDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return raw && raw.doc && raw.savedAt ? raw : null;
  } catch (_) { return null; }
}
function writeDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc, savedAt: new Date().toISOString() })); }
  catch (_) { note('This browser is not saving drafts (private mode?). Download before you leave.'); }
}

/* ── Search and form ─────────────────────────────────────── */

function clubName(id) { return clubById[id] ? clubById[id].name : 'Unknown club'; }

function feedWords(p) {
  const a = p.availability || {};
  const status = a.manual ? a.feedStatus : a.status;
  const words = AVAILABILITY_LABELS[status] || status;
  const text = a.manual ? a.feedNote : a.note;
  return status && status !== 'available' ? `${words}${text ? ': ' + text : ''}` : 'No feed issue';
}

function renderResults(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) { mount('a-results', ''); return; }
  const hits = players
    .filter((p) => `${p.name} ${clubName(p.clubId)}`.toLowerCase().includes(q))
    .slice(0, 8);
  mount('a-results', hits.length
    ? hits.map((p) => `<li><button type="button" class="btn btn-ghost btn-sm" data-id="${esc(p.id)}">
        ${esc(p.name)} · ${esc(clubName(p.clubId))} · ${esc(p.position)}
        <span class="t-sub">Feed: ${esc(feedWords(p))}</span></button></li>`).join('')
    : '<li class="sec-note">No player matches that.</li>');
  document.querySelectorAll('#a-results button[data-id]').forEach((b) => {
    b.addEventListener('click', () => openForm(b.getAttribute('data-id')));
  });
}

function openForm(playerId) {
  const p = byId.get(playerId);
  const existing = doc.entries.find((e) => e.playerId === playerId);
  editing = p ? { id: p.id, name: p.name, clubId: p.clubId }
    : existing ? { id: existing.playerId, name: existing.playerName, clubId: existing.clubId } : null;
  if (!editing) return;
  const form = document.getElementById('a-form');
  form.hidden = false;
  document.getElementById('a-player').innerHTML = `<b>${esc(editing.name)}</b>, ${esc(clubName(editing.clubId))}`
    + (p ? ` · ${esc(POSITION_NAMES[p.position])} · <span class="t-sub">Feed: ${esc(feedWords(p))}</span>` : '');
  document.getElementById('a-status').value = existing ? existing.status : 'out';
  document.getElementById('a-note').value = existing ? existing.note : '';
  document.getElementById('a-source').value = existing ? existing.sourceRef : '';
  document.getElementById('a-return').value = existing && existing.returnRound ? existing.returnRound : '';
  /* One round by default: old news should lapse, not linger. */
  document.getElementById('a-expires').value = existing && existing.expiresAfterRound
    ? existing.expiresAfterRound : snapshot.currentRound;
  countNote();
  document.getElementById('a-status').focus();
}

function closeForm() {
  editing = null;
  document.getElementById('a-form').hidden = true;
}

function countNote() {
  document.getElementById('a-count').textContent = String(document.getElementById('a-note').value.length);
}

function saveEntry() {
  if (!editing) return;
  const entry = normaliseEntry({
    playerId: editing.id,
    playerName: editing.name,
    clubId: editing.clubId,
    status: document.getElementById('a-status').value,
    note: document.getElementById('a-note').value.slice(0, NOTE_MAX),
    returnRound: document.getElementById('a-return').value,
    expiresAfterRound: document.getElementById('a-expires').value || snapshot.currentRound,
    checkedAt: new Date().toISOString(),
    sourceRef: document.getElementById('a-source').value
  });
  if (!entry) { note('That entry could not be saved. Check the status.'); return; }
  doc = normaliseManualDoc({ ...doc, entries: doc.entries.filter((e) => e.playerId !== entry.playerId).concat(entry) });
  writeDraft();
  closeForm();
  document.getElementById('a-search').value = '';
  mount('a-results', '');
  note(`Saved ${entry.playerName}. Download and commit the file to make it live.`);
  renderList();
}

/* ── List ────────────────────────────────────────────────── */

function renderList() {
  const round = snapshot.currentRound;
  const entries = doc.entries.slice().sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  if (!entries.length) {
    mount('a-list', '<p class="sec-note">No team news entries yet. The availability page is '
      + 'showing the feed and the modelled rotation flags only.</p>');
  } else {
    mount('a-list', `<ul class="av-list">${entries.map((e) => {
      const live = isActive(e, round);
      const known = byId.has(e.playerId);
      const p = byId.get(e.playerId);
      const name = e.playerName || (p && p.name) || e.playerId;
      const clubId = e.clubId || (p && p.clubId);
      const state = !known ? 'Not in the current feed' : live ? `In force to round ${e.expiresAfterRound || '?'}`
        : 'Expired';
      return `<li class="av-item">
        <div>
          <span class="t-name">${esc(name)}</span>
          <span class="t-sub">${esc(clubName(clubId))} · ${esc(state)}</span>
          <span class="flag-detail">${e.note ? `<span class="flag-note">${esc(e.note)}</span>` : ''}
            <span class="flag-when">Checked ${esc(ago(e.checkedAt))}${e.sourceRef ? ' · ' + esc(e.sourceRef) : ''}</span></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${flagBadge({ status: e.status, origin: 'manual', note: e.note })}
          <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(e.playerId)}">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(e.playerId)}">Remove</button>
        </div>
      </li>`;
    }).join('')}</ul>`);
  }
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(b.getAttribute('data-edit'))));
  document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    doc = normaliseManualDoc({ ...doc, entries: doc.entries.filter((e) => e.playerId !== b.getAttribute('data-remove')) });
    writeDraft();
    renderList();
  }));
  document.getElementById('a-json').value = serialiseManualDoc(doc);
}

function prune() {
  const before = doc.entries.length;
  doc = normaliseManualDoc({ ...doc, entries: doc.entries.filter((e) => isActive(e, snapshot.currentRound)) });
  writeDraft();
  note(`Removed ${before - doc.entries.length} expired entr${before - doc.entries.length === 1 ? 'y' : 'ies'}.`);
  renderList();
}

/* ── Export ──────────────────────────────────────────────── */

function download() {
  const blob = new Blob([serialiseManualDoc(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'availability.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  note('Downloaded. Replace efl/app/data/availability.json with it and commit.');
}

async function copy() {
  const textArea = document.getElementById('a-json');
  textArea.value = serialiseManualDoc(doc);
  try {
    await navigator.clipboard.writeText(textArea.value);
    note('Copied to the clipboard.');
  } catch (_) {
    textArea.select();
    note('Select the text below and copy it by hand.');
  }
}

function discard() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* private mode */ }
  window.location.reload();
}

function note(text) { document.getElementById('a-export-note').textContent = text; }
