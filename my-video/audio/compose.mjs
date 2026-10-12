// Composes the product video's music bed from scratch, so there is no licensing to track.
// Writes a WAV and encodes public/music.mp3 with Remotion's bundled ffmpeg:
//
//   node audio/compose.mjs
//
// 100 BPM, Fmaj7 - Am7 - Cmaj7 - G6, laid out against the cut (bar = 2.4 s):
//   bars 0-1   pad and plucks under the hook and title
//   bars 2-17  kick and sub enter for the features; hats from bar 4; full groove through the footage
//   bars 18-19 drums drop for the wordmark and end card; the last chord rings out
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 20;
const LENGTH = 1460 / 29.92 + 0.2; // composition length in seconds, plus a hair
const N = Math.ceil(LENGTH * SR);

const L = new Float32Array(N);
const R = new Float32Array(N);
const padL = new Float32Array(N);
const padR = new Float32Array(N);
const send = new Float32Array(N); // reverb send (mono)
const duck = new Float32Array(N).fill(1); // sidechain gain written by the kick

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Deterministic noise so every run writes the same file.
let seed = 0x2f6b1d;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};

// Fmaj7, Am7, Cmaj7, G6 voiced close around middle C.
const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] },
  { root: 45, notes: [52, 57, 60, 64] },
  { root: 48, notes: [52, 55, 59, 60] },
  { root: 43, notes: [50, 55, 59, 64] },
];
const chordAt = (bar) => CHORDS[bar % 4];

// --- Pad: detuned saws through a slowly opening low-pass, one chord per bar -----------------
function pad(bar) {
  const start = bar * BAR;
  const dur = bar === BARS - 1 ? BAR + 2.5 : BAR + 0.35; // overlap into the next chord; last one rings
  const s0 = Math.floor(start * SR);
  const len = Math.min(Math.floor(dur * SR), N - s0);
  const { notes } = chordAt(bar);
  const level = bar < 2 ? 0.085 : 0.065;
  for (const note of notes) {
    for (const [detune, pan] of [
      [-0.07, 0.25],
      [0.07, 0.75],
    ]) {
      const f = midi(note + detune);
      let phase = rand() * 0.5 + 0.5;
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        phase += f / SR;
        phase -= Math.floor(phase);
        const saw = phase * 2 - 1;
        const cutoff = 700 + 900 * Math.min(1, (start + t) / 20) + 250 * Math.sin((start + t) * 0.6);
        lp += (1 - Math.exp((-2 * Math.PI * cutoff) / SR)) * (saw - lp);
        const env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.5);
        const v = lp * env * level;
        padL[s0 + i] += v * (1 - pan);
        padR[s0 + i] += v * pan;
      }
    }
  }
}

// --- Pluck: bright decaying tone with a stereo ping-pong delay ------------------------------
function pluck(time, note, gain, pan) {
  const s0 = Math.floor(time * SR);
  const len = Math.min(Math.floor(0.9 * SR), N - s0);
  const f = midi(note);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 7) * Math.min(1, t / 0.003);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 14)) * env * gain;
    L[s0 + i] += v * (1 - pan);
    R[s0 + i] += v * pan;
    send[s0 + i] += v * 0.6;
    // Dotted-eighth echoes, alternating sides.
    for (let k = 1; k <= 3; k++) {
      const j = s0 + i + Math.floor(k * BEAT * 0.75 * SR);
      if (j >= N) break;
      const e = v * 0.45 ** k;
      if (k % 2) R[j] += e;
      else L[j] += e;
    }
  }
}

// --- Kick: sine sweep with a click, and it ducks the pad ---------------------------------------
function kick(time, gain = 0.9) {
  const s0 = Math.floor(time * SR);
  const len = Math.min(Math.floor(0.45 * SR), N - s0);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 45 + 85 * Math.exp(-t * 30);
    phase += (2 * Math.PI * f) / SR;
    const v = Math.sin(phase) * Math.exp(-t * 8) * gain + rand() * Math.exp(-t * 400) * 0.08;
    L[s0 + i] += v;
    R[s0 + i] += v;
  }
  const duckLen = Math.min(Math.floor(BEAT * SR), N - s0);
  for (let i = 0; i < duckLen; i++) {
    const t = i / SR;
    duck[s0 + i] = Math.min(duck[s0 + i], 1 - 0.55 * Math.exp(-t * 9));
  }
}

// --- Hat: high-passed noise tick --------------------------------------------------------------
function hat(time, gain, pan) {
  const s0 = Math.floor(time * SR);
  const len = Math.min(Math.floor(0.08 * SR), N - s0);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const n = rand();
    const hp = n - prev;
    prev = n;
    const v = hp * Math.exp(-t * 60) * gain;
    L[s0 + i] += v * (1 - pan);
    R[s0 + i] += v * pan;
    send[s0 + i] += v * 0.3;
  }
}

// --- Sub bass: rounded sine on the root, eighth-note pulse --------------------------------------
function bass(time, note, dur, gain) {
  const s0 = Math.floor(time * SR);
  const len = Math.min(Math.floor(dur * SR), N - s0);
  const f = midi(note);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.03);
    const x = Math.sin(2 * Math.PI * f * t);
    const v = Math.tanh(x * 1.6) * env * gain;
    L[s0 + i] += v;
    R[s0 + i] += v;
  }
}

// --- Arrangement ------------------------------------------------------------------------------
const ARP = [0, 2, 1, 3, 2, 1, 3, 2]; // index into the chord, one per eighth
for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR;
  const { root, notes } = chordAt(bar);
  pad(bar);

  const grooving = bar >= 2 && bar < 18;
  const plucksOn = bar < 18 || bar === 18;
  if (plucksOn) {
    for (let e = 0; e < 8; e++) {
      const note = notes[ARP[e]] + 12;
      const accent = e % 2 === 0 ? 1 : 0.7;
      pluck(t0 + e * (BEAT / 2), note, 0.085 * accent * (bar < 2 ? 1.4 : 1), e % 2 ? 0.65 : 0.35);
    }
  }
  if (bar === BARS - 1) pluck(t0, notes[3] + 12, 0.1, 0.5);

  if (grooving) {
    const fourOnFloor = bar >= 4;
    for (let b = 0; b < 4; b++) {
      if (fourOnFloor || b % 2 === 0) kick(t0 + b * BEAT, b === 0 ? 0.75 : 0.65);
    }
    for (let e = 0; e < 8; e++) {
      if (e % 2 === 1) bass(t0 + e * (BEAT / 2), root - 12, BEAT / 2 - 0.02, 0.28);
      else bass(t0 + e * (BEAT / 2), root - 12, BEAT / 2 - 0.02, 0.2);
    }
    if (bar >= 4) {
      for (let s = 0; s < 16; s++) {
        const offbeat = s % 4 === 2;
        if (offbeat) hat(t0 + s * (BEAT / 4), 0.16, 0.6);
        else if (s % 2 === 1 && bar >= 8) hat(t0 + s * (BEAT / 4), 0.05, 0.4);
      }
    }
  }
  // A soft lift into the groove and into the last section.
  if (bar === 1 || bar === 17) {
    for (let s = 0; s < 8; s++) hat(t0 + BAR / 2 + s * (BEAT / 4), 0.02 + s * 0.012, s % 2 ? 0.3 : 0.7);
  }
}
// The final downbeat: one low root under the ringing chord.
bass(BARS * BAR - BAR, chordAt(BARS - 1).root - 12, 2.2, 0.22);

// --- Mix: duck the pad, Schroeder reverb on pad + sends, soft clip -----------------------------
for (let i = 0; i < N; i++) {
  padL[i] *= duck[i];
  padR[i] *= duck[i];
  L[i] += padL[i];
  R[i] += padR[i];
  send[i] += (padL[i] + padR[i]) * 0.35;
}

function reverb(input, combs, allpasses) {
  const out = new Float32Array(N);
  for (const [delay, fb] of combs) {
    const buf = new Float32Array(delay);
    let idx = 0;
    let damp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      damp = y * 0.6 + damp * 0.4;
      buf[idx] = input[i] + damp * fb;
      idx = (idx + 1) % delay;
      out[i] += y / combs.length;
    }
  }
  for (const delay of allpasses) {
    const buf = new Float32Array(delay);
    let idx = 0;
    for (let i = 0; i < N; i++) {
      const b = buf[idx];
      const y = -out[i] + b;
      buf[idx] = out[i] + b * 0.5;
      idx = (idx + 1) % delay;
      out[i] = y;
    }
  }
  return out;
}
const revL = reverb(
  send,
  [
    [1557, 0.86],
    [1617, 0.86],
    [1491, 0.86],
    [1422, 0.86],
  ],
  [225, 556],
);
const revR = reverb(
  send,
  [
    [1577, 0.86],
    [1637, 0.86],
    [1511, 0.86],
    [1442, 0.86],
  ],
  [245, 576],
);

let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.4) * Math.min(1, (LENGTH - t) / 1.6);
  L[i] = Math.tanh((L[i] + revL[i] * 0.55) * 1.1) * fade;
  R[i] = Math.tanh((R[i] + revR[i] * 0.55) * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}

// --- Write 16-bit WAV, then MP3 -----------------------------------------------------------------
const gain = 0.89 / peak; // -1 dBFS
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
}
const wav = join(root, "audio", "music.wav");
const mp3 = join(root, "public", "music.mp3");
mkdirSync(dirname(mp3), { recursive: true });
writeFileSync(wav, pcm);
// Relative paths: on Windows the call goes through a shell, which would split a path with spaces.
execFileSync(
  "npx",
  ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", "audio/music.wav", "-b:a", "192k", "public/music.mp3"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
console.log(`wrote ${mp3} (${LENGTH.toFixed(1)} s)`);
