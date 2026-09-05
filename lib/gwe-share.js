/* Gameweek Edge share cards — the theme and the three adapters.
 *
 * vendor/share.js (PLDShare, from the Bookings Desk, verbatim) is the
 * renderer: the 1080×1350 canvas, the theme registry and the drawing
 * primitives. This file is what Gameweek Edge adds on top, and only that:
 *
 *   THEME     two gradient stops, the strap across the band, the wordmark in
 *             the corner — registered into PLDShare.THEMES under 'GWE' so
 *             theme('GWE') answers like any desk.
 *   ADAPTERS  three plain-object builders: the model Team of the Week, the
 *             captain pick, and the squad rating from onboarding. Each turns
 *             what the app already computed into a spec; nothing here knows
 *             how an expected-points figure was arrived at.
 *   CARD      one composer that draws a spec with PLDShare's exported
 *             primitives (roundRect, fit, textOn, W, H, PAD). It does NOT
 *             call the desk cards: their shared footer draws the 18+ /
 *             BeGambleAware line, which a Gameweek Edge card must never
 *             carry, and the renderer stays unchanged. scripts/check-share.mjs
 *             asserts both halves of that.
 *
 * NO NETWORK, NO DEPENDENCIES beyond PLDShare. Renders from data already on
 * the page and hands back a Blob; PLDSave.file() takes it to the native
 * share sheet where there is one and to an anchor everywhere else.
 */
(function (root) {
  'use strict';
  var S = root.PLDShare;
  if (!S) throw new Error('lib/gwe-share.js needs vendor/share.js loaded before it');

  var W = S.W, H = S.H, P = S.PAD;
  var DISP = "'Bricolage Grotesque',sans-serif";
  var BODY = "'Public Sans',sans-serif";
  var MONO = "'IBM Plex Mono',ui-monospace,monospace";
  var URL_TEXT = 'gameweekedge.co.uk';

  /* The identity. Fill green and bright green from BRAND.md §6; the strap is
     the one line of copy every card opens with; the mark is the wordmark. */
  var THEME = {
    from: '#15824a', to: '#1f9d5c', ink: '#147e48',
    strap: 'GAMEWEEK EDGE · PREDICTED POINTS', mark: 'GAMEWEEK EDGE',
    slug: 'gameweek-edge', tag: 'GWE',
    legal: 'Independent · not affiliated with the Premier League or the official Fantasy Premier League game'
  };
  S.THEMES.GWE = THEME;
  function theme() { return S.theme('GWE'); }

  /* ---- the brand mark: the green tile with the white form line ---------- */
  function drawMark(x, cx, cy, h) {
    var r = h * 0.28;
    x.save(); x.translate(cx - h / 2, cy - h / 2);
    x.fillStyle = '#ffffff'; S.roundRect(x, 0, 0, h, h, r); x.fill();
    x.fillStyle = THEME.from; S.roundRect(x, h * 0.06, h * 0.06, h * 0.88, h * 0.88, r * 0.85); x.fill();
    x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(3, h * 0.08); x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(h * 0.24, h * 0.67); x.lineTo(h * 0.42, h * 0.45); x.lineTo(h * 0.58, h * 0.58); x.lineTo(h * 0.79, h * 0.29); x.stroke();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(h * 0.79, h * 0.29, h * 0.09, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function band(x, th, title, subtitle) {
    var g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, th.from); g.addColorStop(1, th.to);
    x.fillStyle = g; x.fillRect(0, 0, W, 168);
    drawMark(x, W - P - 36, 84, 72);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '700 22px ' + BODY;
    x.fillText(th.strap, P, 66);
    x.fillStyle = '#ffffff'; x.font = '800 46px ' + DISP;
    x.fillText(S.fit(x, title, W - P - 160), P, 126);
    x.fillStyle = '#586673'; x.font = '600 22px ' + BODY;
    x.fillText(S.fit(x, String(subtitle || ''), W - 2 * P), P, 210);
  }

  /* The footer: the URL every card carries, the disclaimer, the wordmark.
     No age line, no market, no odds — there is nothing to bet on here. */
  function footer(x, th, note) {
    x.font = '800 20px ' + DISP;
    var markW = x.measureText(th.mark).width;
    x.fillStyle = th.ink; x.font = '800 22px ' + BODY;
    x.fillText(URL_TEXT, P, H - 84);
    x.fillStyle = '#8b94a5'; x.font = '600 16px ' + BODY;
    x.fillText(S.fit(x, note || th.legal, W - 2 * P - markW - 24), P, H - 50);
    x.fillStyle = th.ink; x.font = '800 20px ' + DISP;
    x.textAlign = 'right'; x.fillText(th.mark, W - P, H - 50); x.textAlign = 'left';
  }

  function canvas() {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    return { c: c, x: x };
  }
  function ready() {
    try { if (document.fonts && document.fonts.ready) return document.fonts.ready; } catch (e) { /* draw sooner */ }
    return Promise.resolve();
  }
  function toBlob(c) { return new Promise(function (res) { c.toBlob(res, 'image/png'); }); }

  /* ---- the composer -------------------------------------------------------
   * spec = {
   *   title, subtitle,
   *   hero:     { label, value, sub }            optional, one big figure
   *   sections: [{ label, rows:[{ name, sub, value, valueLabel }] }]
   *   stats:    [{ label, value, sub }]          optional, a 2-up grid
   *   note, filename
   * }
   */
  function card(spec) {
    return ready().then(function () {
      var th = theme(), k = canvas(), x = k.x;
      band(x, th, spec.title, spec.subtitle);
      var y = 262;

      if (spec.hero) {
        x.fillStyle = '#f4f6f8'; S.roundRect(x, P, y, W - 2 * P, 150, 16); x.fill();
        x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
        x.fillText(String(spec.hero.label || '').toUpperCase(), P + 24, y + 38);
        x.fillStyle = th.ink; x.font = '800 74px ' + DISP;
        x.fillText(String(spec.hero.value), P + 24, y + 112);
        if (spec.hero.sub) {
          x.fillStyle = '#586673'; x.font = '600 22px ' + BODY;
          x.textAlign = 'right'; x.fillText(S.fit(x, spec.hero.sub, W / 2), W - P - 24, y + 108); x.textAlign = 'left';
        }
        y += 176;
      }

      if (spec.stats && spec.stats.length) {
        var cols = 2, gap = 16, cw = (W - 2 * P - gap) / cols, ch = 132;
        spec.stats.forEach(function (st, i) {
          var cx = P + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap);
          x.fillStyle = '#f4f6f8'; S.roundRect(x, cx, cy, cw, ch, 14); x.fill();
          x.fillStyle = '#8b94a5'; x.font = '700 15px ' + BODY;
          x.fillText(S.fit(x, String(st.label || '').toUpperCase(), cw - 40), cx + 20, cy + 34);
          x.fillStyle = '#10171e'; x.font = '800 44px ' + DISP;
          x.fillText(S.fit(x, String(st.value), cw - 40), cx + 20, cy + 86);
          if (st.sub) {
            x.fillStyle = '#586673'; x.font = '600 16px ' + BODY;
            x.fillText(S.fit(x, st.sub, cw - 40), cx + 20, cy + 114);
          }
        });
        y += Math.ceil(spec.stats.length / cols) * (ch + gap) + 12;
      }

      var sections = spec.sections || [];
      var rowsTotal = sections.reduce(function (n, s) { return n + (s.rows || []).length; }, 0);
      var room = H - 120 - y - sections.length * 40;
      var rh = Math.max(30, Math.min(56, rowsTotal ? room / rowsTotal : 56));
      sections.forEach(function (sec) {
        x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
        x.fillText(String(sec.label || '').toUpperCase(), P, y + 22);
        if (sec.rows.length && sec.rows[0].valueLabel) {
          x.textAlign = 'right'; x.fillText(String(sec.rows[0].valueLabel).toUpperCase(), W - P, y + 22); x.textAlign = 'left';
        }
        y += 34;
        (sec.rows || []).forEach(function (r, i) {
          var mid = y + rh / 2;
          if (i % 2 === 0) { x.fillStyle = '#f4f6f8'; S.roundRect(x, P - 12, y + 3, W - 2 * (P - 12), rh - 6, 10); x.fill(); }
          x.fillStyle = '#10171e'; x.font = '700 ' + Math.round(rh * 0.42) + 'px ' + DISP;
          x.fillText(S.fit(x, r.name, W - 2 * P - 300), P, mid + rh * 0.15);
          if (r.sub) {
            x.fillStyle = '#586673'; x.font = '600 ' + Math.round(rh * 0.3) + 'px ' + BODY;
            var nw = x.measureText(r.name).width;
            x.fillText(S.fit(x, r.sub, W - 2 * P - 320 - nw), P + Math.min(nw, W - 2 * P - 320) + 14, mid + rh * 0.15);
          }
          if (r.value != null) {
            x.fillStyle = th.ink; x.font = '600 ' + Math.round(rh * 0.44) + 'px ' + MONO;
            x.textAlign = 'right'; x.fillText(String(r.value), W - P, mid + rh * 0.16); x.textAlign = 'left';
          }
          y += rh;
        });
        y += 6;
      });

      footer(x, th, spec.note);
      return toBlob(k.c);
    });
  }

  /* ---- adapters ------------------------------------------------------------
   * Each takes what the app already holds and returns a spec. Names, teams
   * and figures pass through untouched; the only computation is grouping.
   */
  var POS_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];
  var POS_LABEL = { GKP: 'Goalkeeper', DEF: 'Defence', MID: 'Midfield', FWD: 'Attack' };

  /* { gw, formation, total, players:[{ name, team, pos, xp, fixture }] } */
  function totwSpec(d) {
    var byPos = {};
    (d.players || []).forEach(function (p) { (byPos[p.pos] = byPos[p.pos] || []).push(p); });
    var sections = POS_ORDER.filter(function (k) { return byPos[k]; }).map(function (k) {
      return { label: POS_LABEL[k], rows: byPos[k].map(function (p) {
        return { name: p.name, sub: [p.team, p.fixture].filter(Boolean).join(' · '), value: Number(p.xp).toFixed(1), valueLabel: 'xP' };
      }) };
    });
    return {
      title: 'Team of the Week · GW' + d.gw,
      subtitle: 'The model XI · ' + (d.formation || '') + ' · ' + Number(d.total || 0).toFixed(1) + ' expected points',
      sections: sections,
      note: THEME.legal,
      filename: THEME.slug + '-' + S.slug('team-of-the-week-gw' + d.gw) + '.png'
    };
  }

  /* { gw, picks:[{ name, team, xp, eo, fixture }], confidence } */
  function captainSpec(d) {
    var top = (d.picks || [])[0];
    var rest = (d.picks || []).slice(1);
    return {
      title: 'Captain pick · GW' + d.gw,
      subtitle: top ? 'The model’s armband: ' + top.name + (top.fixture ? ' · ' + top.fixture : '') : 'No eligible captain',
      hero: top ? { label: 'Expected points, doubled', value: (Number(top.xp) * 2).toFixed(1),
        sub: (d.confidence != null ? 'Confidence ' + Math.round(d.confidence) + '/100' : '') } : null,
      sections: [{ label: 'Also considered', rows: rest.map(function (p) {
        return { name: p.name, sub: [p.team, p.fixture].filter(Boolean).join(' · '), value: Number(p.xp).toFixed(1), valueLabel: 'xP' };
      }) }],
      note: THEME.legal,
      filename: THEME.slug + '-' + S.slug('captain-gw' + d.gw) + '.png'
    };
  }

  /* { gw, myXP, modelXP, share, overlap, weakest } — the onboarding rating */
  function ratingSpec(d) {
    return {
      title: 'My squad, rated · GW' + d.gw,
      subtitle: 'My starting eleven against the eleven the model would pick',
      hero: { label: 'Against the model XI', value: (d.share != null ? d.share + '%' : '—'),
        sub: Number(d.myXP || 0).toFixed(1) + ' xP vs ' + Number(d.modelXP || 0).toFixed(1) + ' xP' },
      stats: [
        { label: 'My XI', value: Number(d.myXP || 0).toFixed(1), sub: 'expected points' },
        { label: 'Model XI', value: Number(d.modelXP || 0).toFixed(1), sub: 'expected points' },
        { label: 'Shared with the model', value: (d.overlap != null ? d.overlap + ' of 11' : '—'), sub: 'players the model would also pick' },
        { label: 'Weakest position', value: d.weakest || 'none', sub: d.weakest ? 'furthest behind the model' : 'nothing stands out' }
      ],
      sections: [],
      note: THEME.legal,
      filename: THEME.slug + '-' + S.slug('squad-rating-gw' + d.gw) + '.png'
    };
  }

  root.GWEShare = {
    THEME: THEME, theme: theme, card: card,
    totwSpec: totwSpec, captainSpec: captainSpec, ratingSpec: ratingSpec,
    drawMark: drawMark, URL: URL_TEXT
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
