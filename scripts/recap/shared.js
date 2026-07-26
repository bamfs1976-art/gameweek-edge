/* Shared timeline machinery for every video in the series.
 *
 * Each template supplies its own scenes and its own per-scene animation; this
 * file owns the parts that must behave identically across the series — the
 * easing, the staggered reveal, the deterministic seek(t) contract render.mjs
 * drives, and the live preview loop when the page is opened in a browser.
 *
 * The original recap template keeps its own inline copy of this: it is the
 * proven, already-shipping one and was deliberately left untouched.
 */
(function (w) {
  var STAGGER = 0.22, REVEAL = 0.55;
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function easeOut(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 3); }

  /* Elements marked .rv rise and fade in, ordered by data-i. */
  function applyReveal(scene, elapsed) {
    scene.querySelectorAll('.rv').forEach(function (el) {
      var i = parseInt(el.dataset.i || '0', 10);
      var p = easeOut((elapsed - i * STAGGER) / REVEAL);
      el.style.opacity = p;
      el.style.transform = 'translateY(' + (26 * (1 - p)) + 'px)';
    });
  }
  /* A list of nodes wiping in one after another — the motion that makes a run
     read as a run rather than a table appearing all at once. */
  function stagger(nodes, elapsed, startAt, per, dur) {
    nodes.forEach(function (el, i) {
      var p = easeOut((elapsed - startAt - i * per) / dur);
      el.style.opacity = p;
      el.style.transform = 'translateY(' + (18 * (1 - p)) + 'px)';
    });
  }
  var kids = function (id) { var el = document.getElementById(id); return el ? [].slice.call(el.children) : []; };

  /* Wire a template up. `perScene(id, elapsed)` is the template's own
     animation; everything else is shared. */
  function mount(SCENES, DURATION, perScene) {
    function seek(t) {
      t = clamp(t, 0, DURATION);
      SCENES.forEach(function (s) {
        var el = document.getElementById(s.id);
        if (!el) return;
        var last = s === SCENES[SCENES.length - 1];
        var active = t >= s.t && t < s.t + s.d + (last ? 0.5 : 0);
        if (active) {
          el.classList.add('on'); el.style.opacity = 1;
          var elapsed = t - s.t;
          applyReveal(el, elapsed);
          if (s.id === 'intro') {
            var rule = document.getElementById('introrule');
            if (rule) rule.style.width = (360 * easeOut((elapsed - 0.9) / 0.7)) + 'px';
          }
          if (perScene) perScene(s.id, elapsed);
        } else {
          el.classList.remove('on'); el.style.opacity = 0;
        }
      });
    }
    w.seek = seek; w.RECAP_DURATION = DURATION; w.RECAP_SCENES = SCENES;
    /* render.mjs drives seek() itself; a browser gets a looping preview. */
    if (!w.__RENDER__) {
      var start = null;
      (function loop(ts) {
        if (start == null) start = ts;
        seek(((ts - start) / 1000) % (DURATION + 0.6));
        w.requestAnimationFrame(loop);
      })(0);
    } else { seek(0); }
  }

  w.GWEVid = { clamp: clamp, easeOut: easeOut, applyReveal: applyReveal, stagger: stagger, kids: kids, mount: mount };
})(window);
