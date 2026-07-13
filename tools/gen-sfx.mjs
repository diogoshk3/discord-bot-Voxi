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

// PRNG determinístico (mulberry32): ruído REPRODUTÍVEL — o gen-sfx tem de dar sempre o
// mesmo WAV (Math.random tornaria a geração não-determinística).
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Ruído branco (semente fixa -> determinístico). Base de whoosh/percussão. */
function noise(seconds, gain = 0.5, seed = 1) {
  const n = Math.floor(seconds * SR);
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() * 2 - 1) * gain;
  return out;
}
/** Passa-baixo de 1 pólo: suaviza o ruído (chiado -> "whoosh"/"sh"). */
function lowpass(buf, alpha = 0.05) {
  const out = new Float64Array(buf.length);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += alpha * (buf[i] - y);
    out[i] = y;
  }
  return out;
}
/** Envelope em meia-onda (sobe e desce) — swells como o whoosh. */
function swell(buf) {
  const n = buf.length;
  for (let i = 0; i < n; i++) buf[i] *= Math.sin((Math.PI * i) / n);
  return buf;
}

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
  // Coin estilo plataformas: B5 curto -> E6 sustido.
  coin: () =>
    concat([
      fade(note(0.07, 987.77, sine, 0.08, 0.5), 3),
      fade(note(0.5, 1318.51, sine, 0.35, 0.5)),
    ]),
  // Pop: blip com queda rápida de tom.
  pop: () => fade(glide(0.08, 1400, 400, sine, 0.7), 3),
  // Laser "pew": glissando descendente em square.
  laser: () => fade(glide(0.4, 2000, 180, square, 0.4)),
  // Success: corridinha ascendente C5-D5-E5-G5 + C6 sustido (level-up).
  success: () =>
    concat([
      fade(note(0.08, 523.25, sine, 0.1, 0.5), 3),
      fade(note(0.08, 587.33, sine, 0.1, 0.5), 3),
      fade(note(0.08, 659.25, sine, 0.1, 0.5), 3),
      fade(note(0.08, 783.99, sine, 0.1, 0.5), 3),
      fade(mix([note(0.5, 1046.5, sine, 0.4, 0.5), note(0.5, 1568, sine, 0.3, 0.15)])),
    ]),
  // Error "uh-oh": duas notas graves descendentes em square.
  error: () =>
    concat([
      fade(note(0.22, 196, square, 0.25, 0.45)),
      silence(0.05),
      fade(note(0.4, 155.56, square, 0.4, 0.45)),
    ]),
  // Boing: mola — sobe e volta a descer (glissando saw).
  boing: () =>
    concat([fade(glide(0.12, 180, 520, saw, 0.5), 3), fade(glide(0.4, 520, 150, saw, 0.5))]),
  // Sparkle: brilho mágico — 4 notas altas rápidas + a última a ressoar.
  sparkle: () =>
    concat([
      fade(note(0.08, 1046.5, sine, 0.1, 0.4), 3),
      fade(note(0.08, 1318.51, sine, 0.1, 0.4), 3),
      fade(note(0.08, 1567.98, sine, 0.1, 0.4), 3),
      fade(note(0.45, 2093, sine, 0.35, 0.4)),
    ]),
  // Whoosh: ruído passa-baixo com envelope em swell.
  whoosh: () => fade(swell(lowpass(noise(0.45, 0.9, 7), 0.06))),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [key, make] of Object.entries(CLIPS)) {
  const wav = toWav(normalize(make()));
  const path = join(OUT_DIR, `${key}.wav`);
  writeFileSync(path, wav);
  console.log(`wrote ${key}.wav (${(wav.length / 1024).toFixed(1)} KiB)`);
}
console.log('feito.');
