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

const TAU = Math.PI * 2;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12); // MIDI note → frequency

export function synthBed(outPath) {
  // Upbeat, driving bed: 120 BPM, four-on-the-floor kick, plucky bass and a
  // bright arpeggio over a major I–V–vi–IV loop. Energetic, not ambient.
  const beat = 0.5, eighth = 0.25, chordDur = 2.0; // 120 BPM, chord every 4 beats
  const chords = [
    { tones: [60, 64, 67], bass: 36 }, // C
    { tones: [67, 71, 74], bass: 43 }, // G
    { tones: [69, 72, 76], bass: 45 }, // Am
    { tones: [65, 69, 72], bass: 41 }  // F
  ];
  const arpPattern = [0, 1, 2, 3, 2, 1, 0, 1]; // eighth-note steps into the chord tones
  const total = 20.2;
  const N = Math.floor(total * SR);
  const buf = Buffer.alloc(44 + N * 4);

  // WAV header (PCM, 2ch, 16-bit).
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);

  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const ch = chords[Math.floor(t / chordDur) % chords.length];
    const ct = t - Math.floor(t / chordDur) * chordDur;
    const bt = t - Math.floor(t / beat) * beat;   // time within the beat
    const et = t - Math.floor(t / eighth) * eighth; // time within the eighth

    // Warm sustained pad (quiet, underneath).
    let pad = 0;
    for (const m of ch.tones) pad += Math.sin(TAU * mtof(m) * t);
    pad = pad / ch.tones.length * clamp(ct / 0.25, 0, 1) * clamp((chordDur - ct) / 0.35, 0, 1) * 0.10;

    // Plucky bass on every beat.
    const bf = mtof(ch.bass);
    const bass = (Math.sin(TAU * bf * t) + 0.3 * Math.sin(TAU * 2 * bf * t))
      * Math.exp(-bt / 0.14) * clamp(bt / 0.004, 0, 1) * 0.17;

    // Four-on-the-floor kick.
    const kick = Math.sin(TAU * (45 + 80 * Math.exp(-bt / 0.028)) * bt) * Math.exp(-bt / 0.11) * 0.26;

    // Bright arpeggio (eighth notes).
    const arpTones = [ch.tones[0], ch.tones[1], ch.tones[2], ch.tones[0] + 12];
    const af = mtof(arpTones[arpPattern[Math.floor(t / eighth) % arpPattern.length]]);
    const arp = (Math.sin(TAU * af * t) + 0.25 * Math.sin(TAU * 2 * af * t))
      * Math.exp(-et / 0.10) * clamp(et / 0.003, 0, 1) * 0.19;

    const fadeIn = clamp(t / 0.15, 0, 1);
    const fadeOut = clamp((total - t) / 1.2, 0, 1);
    const s = clamp((pad + bass + kick + arp) * fadeIn * fadeOut * 0.82, -1, 1);
    const v = Math.round(s * 32767);
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 44 + i * 4 + 2);
  }
  writeFileSync(outPath, buf);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || new URL('./music.wav', import.meta.url).pathname;
  synthBed(out);
  console.error('Wrote ' + out);
}
