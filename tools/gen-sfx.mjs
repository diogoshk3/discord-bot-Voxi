// tools/gen-sfx.mjs
//
// Gera os clips do soundboard (/sound) como tons SINTÉTICOS — sem direitos de terceiros
// (CC0 por autoria própria). Saída: WAV PCM 22050 Hz / mono / 16-bit em assets/sfx/.
// As chaves têm de bater com src/content/sounds.ts (o teste tests/sounds.test.ts falha
// se algum clip registado não tiver ficheiro). Correr:  node tools/gen-sfx.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'sfx');
const SR = 22050; // sample rate (igual ao Piper — seguro no pipeline)
const TAU = Math.PI * 2;

// ── osciladores (fase contínua p/ evitar cliques) ────────────────────────────────
const sine = (ph) => Math.sin(ph);
const square = (ph) => (Math.sin(ph) >= 0 ? 1 : -1);
const saw = (ph) => {
  const t = (ph / TAU) % 1;
  return 2 * t - 1;
};

/** Constrói N samples chamando fn(t) em segundos; devolve Float64Array em [-1,1]. */
function build(seconds, fn) {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR);
  return out;
}

/** Nota: oscilador `osc` à frequência `freq` com decaimento exponencial `tau` (s). */
function note(seconds, freq, osc = sine, tau = 0.25, gain = 0.6) {
  let ph = 0;
  const dphBase = (TAU * freq) / SR;
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = osc(ph) * Math.exp(-(i / SR) / tau) * gain;
    ph += dphBase;
  }
  return out;
}

/** Tom com glissando linear de f0->f1 (para o "womp" do trombone). */
function glide(seconds, f0, f1, osc = saw, gain = 0.5) {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 + (f1 - f0) * (i / n);
    ph += (TAU * f) / SR;
    out[i] = osc(ph) * gain;
  }
  return out;
}

const silence = (seconds) => new Float64Array(Math.floor(seconds * SR));

/** Concatena vários Float64Array. */
function concat(parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float64Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Soma (mistura) arrays alinhados no início; comprimento = o maior. */
function mix(parts) {
  const total = Math.max(...parts.map((p) => p.length));
  const out = new Float64Array(total);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

/** Fade-in/out curto (ms) anti-clique nas extremidades. */
function fade(buf, ms = 5) {
  const k = Math.min(Math.floor((ms / 1000) * SR), Math.floor(buf.length / 2));
  for (let i = 0; i < k; i++) {
    const g = i / k;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return buf;
}

/** Normaliza a um pico alvo (evita clipping mantendo volume audível). */
function normalize(buf, peak = 0.85) {
  let max = 0;
  for (const s of buf) max = Math.max(max, Math.abs(s));
  if (max === 0) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Float [-1,1] -> WAV PCM 16-bit mono. */
function toWav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ── os clips (chaves == src/content/sounds.ts) ───────────────────────────────────
const honk = (secs, f) =>
  mix([note(secs, f, saw, secs, 0.5), note(secs, f * 1.01, saw, secs, 0.25)]);

const CLIPS = {
  // Duas buzinadas de sawtooth ricas.
  airhorn: () => concat([fade(honk(0.4, 300)), silence(0.06), fade(honk(0.55, 300))]),
  // Sino: fundamental + harmónico, decaimento longo.
  ding: () => fade(mix([note(0.7, 1180, sine, 0.28, 0.6), note(0.7, 2360, sine, 0.18, 0.2)])),
  // Buzzer de resposta errada: square grave e áspero.
  buzzer: () => fade(note(0.6, 140, square, 0.6, 0.5)),
  // Ta-da!: arpejo C5-E5-G5 rápido + C6 sustido.
  tada: () =>
    concat([
      fade(note(0.1, 523.25, sine, 0.12, 0.5)),
      fade(note(0.1, 659.25, sine, 0.12, 0.5)),
      fade(note(0.1, 783.99, sine, 0.12, 0.5)),
      fade(mix([note(0.6, 1046.5, sine, 0.5, 0.5), note(0.6, 1568, sine, 0.4, 0.2)])),
    ]),
  // Sad trombone "womp womp womp womp": 4 notas descendentes, glissando na última.
  'sad-trombone': () =>
    concat([
      fade(glide(0.32, 233, 220, saw, 0.5)),
      silence(0.05),
      fade(glide(0.32, 208, 196, saw, 0.5)),
      silence(0.05),
      fade(glide(0.32, 185, 175, saw, 0.5)),
      silence(0.05),
      fade(glide(0.7, 175, 120, saw, 0.5)),
    ]),
  // Beep simples.
  beep: () => fade(note(0.22, 800, sine, 0.5, 0.6)),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [key, make] of Object.entries(CLIPS)) {
  const wav = toWav(normalize(make()));
  const path = join(OUT_DIR, `${key}.wav`);
  writeFileSync(path, wav);
  console.log(`wrote ${key}.wav (${(wav.length / 1024).toFixed(1)} KiB)`);
}
console.log('feito.');
