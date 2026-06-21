/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — Native bridge (Capacitor)
   Bundled by esbuild into www/native.js as an IIFE that attaches
   a single global: window.GENative.

   The web UI calls these helpers behind capability checks. On the
   web (non-native) build every method is a safe no-op, so callers
   never need to branch — they just call GENative.x().

   Phase M1 scope: status-bar theming, splash control, haptics,
   app lifecycle + network awareness, keyboard. Push notifications
   are deliberately left to Phase M2 (they need APNs credentials).
   ═══════════════════════════════════════════════════════════ */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { Keyboard } from '@capacitor/keyboard';

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

/* Helper: swallow rejections so a missing/!available plugin never
   breaks the UI thread. */
const safe = (p) => { try { const r = p(); if (r && r.catch) r.catch(() => {}); } catch (_) {} };

/* Dispatch a DOM event the page can listen for without importing
   anything native. */
const emit = (name, detail) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

const GENative = {
  isNative,
  platform,

  /* ── Status bar follows the app theme ──────────────────── */
  /* Capacitor's Style names are inverted from intuition:
     Style.Dark  = dark glyphs (use on a LIGHT background)
     Style.Light = light glyphs (use on a DARK background)   */
  setTheme(theme) {
    if (!isNative) return;
    const dark = theme === 'dark';
    safe(() => StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }));
    if (platform === 'android') {
      safe(() => StatusBar.setBackgroundColor({ color: dark ? '#0f161d' : '#f4f6f8' }));
    }
  },

  /* ── Haptics ───────────────────────────────────────────── */
  hapticSelection() { if (isNative) safe(() => Haptics.selectionStart()); },
  hapticLight()     { if (isNative) safe(() => Haptics.impact({ style: ImpactStyle.Light })); },
  hapticMedium()    { if (isNative) safe(() => Haptics.impact({ style: ImpactStyle.Medium })); },
  hapticSuccess()   { if (isNative) safe(() => Haptics.notification({ type: NotificationType.Success })); },
  hapticWarning()   { if (isNative) safe(() => Haptics.notification({ type: NotificationType.Warning })); },

  /* ── Splash ────────────────────────────────────────────── */
  hideSplash() { if (isNative) safe(() => SplashScreen.hide({ fadeOutDuration: 220 })); },

  /* ── Network state ─────────────────────────────────────── */
  online: true,
  async getStatus() {
    if (!isNative) return { connected: navigator.onLine };
    try { return await Network.getStatus(); } catch (_) { return { connected: true }; }
  },

  /* ── Lifecycle wiring (called once from init) ──────────── */
  init() {
    if (!isNative) return;
    document.documentElement.classList.add('native', 'native-' + platform);

    /* Network → fire ge:network so panels can show an offline state */
    safe(async () => {
      const status = await Network.getStatus();
      this.online = status.connected;
      emit('ge:network', status);
      Network.addListener('networkStatusChange', (s) => {
        this.online = s.connected;
        emit('ge:network', s);
      });
    });

    /* App returns to foreground → fire ge:resume so live panels refresh */
    safe(() => App.addListener('resume', () => emit('ge:resume', {})));
    safe(() => App.addListener('appStateChange', (s) => {
      if (s.isActive) emit('ge:resume', {});
    }));

    /* Hardware back (Android): close drawer or exit. Harmless on iOS. */
    safe(() => App.addListener('backButton', ({ canGoBack }) => {
      const drawerOpen = document.getElementById('sidebar')?.classList.contains('open');
      if (drawerOpen) { emit('ge:back', {}); return; }
      if (window.history.length > 1 && canGoBack) window.history.back();
      else App.exitApp();
    }));

    /* Keyboard: toggle a class so we can lift sticky bars if needed */
    safe(() => Keyboard.addListener('keyboardWillShow', () =>
      document.documentElement.classList.add('kb-open')));
    safe(() => Keyboard.addListener('keyboardWillHide', () =>
      document.documentElement.classList.remove('kb-open')));
  }
};

window.GENative = GENative;
GENative.init();
