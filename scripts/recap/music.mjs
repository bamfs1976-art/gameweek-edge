/*
 * Original, royalty-free ambient music bed for the recap — synthesised
 * from scratch (no samples, no licensing) so it's fully owned and safe
 * to post. A calm I–V–vi–IV pad in C: gentle swells, soft harmonics,
 * fade in/out. 44.1kHz 16-bit stereo WAV.
 *
 * Swap it for your own track by dropping music.mp3 / music.wav next to
 * this file — render.mjs prefers a supplied file over this synth.
 *
 * Run: node scripts/recap/music.mjs [out.wav]
 */
import { writeFileSync } from 'node:fs';

const SR = 44100;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function synthBed(outPath) {
  // Four chords (root + triad, with a low octave for warmth), 5s each.
  const chords = [
    [130.81, 196.00, 261.63, 329.63], // C  (I)
    [98.00, 196.00, 246.94, 293.66],  // G  (V)
    [110.00, 220.00, 261.63, 329.63], // Am (vi)
    [87.31, 174.61, 220.00, 261.63]   // F  (IV)
  ];
  const chordDur = 5.0;
  const total = chords.length * chordDur + 0.3;
  const N = Math.floor(total * SR);
  const buf = Buffer.alloc(44 + N * 4);

  // WAV header (PCM, 2ch, 16-bit).
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);

  const TAU = Math.PI * 2;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let ci = Math.floor(t / chordDur); if (ci >= chords.length) ci = chords.length - 1;
    const ct = t - ci * chordDur;
    const swell = clamp(ct / 0.14, 0, 1) * clamp((chordDur - ct) / 0.35, 0, 1); // click-free gentle swell
    const ch = chords[ci];
    let l = 0, r = 0;
    for (const f of ch) {
      l += Math.sin(TAU * f * t) + 0.14 * Math.sin(TAU * 2 * f * t);
      r += Math.sin(TAU * f * 1.003 * t) + 0.14 * Math.sin(TAU * 2 * f * 1.003 * t); // slight detune = stereo width
    }
    l /= ch.length; r /= ch.length;
    const fadeIn = clamp(t / 0.9, 0, 1);
    const fadeOut = clamp((total - 0.2 - t) / 1.7, 0, 1);
    const g = swell * fadeIn * fadeOut * 0.30; // master level — a bed, not the star
    buf.writeInt16LE(Math.round(clamp(l * g, -1, 1) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(clamp(r * g, -1, 1) * 32767), 44 + i * 4 + 2);
  }
  writeFileSync(outPath, buf);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || new URL('./music.wav', import.meta.url).pathname;
  synthBed(out);
  console.error('Wrote ' + out);
}
