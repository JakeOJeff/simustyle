// Composes the product video's music from scratch, so there is no licensing to track, and
// locks it to the edit. Writes a WAV and encodes public/music.mp3 with Remotion's bundled ffmpeg:
//
//   node audio/compose.mjs
//
// One beat is exactly 15 video frames (119.68 BPM at 29.92 fps), and every scene in
// src/ProductVideo.tsx is a whole number of beats, so every cut lands on a beat. The cut list is
// read from that file, and each cut gets a hit: a sub boom and a crash, bigger where the section
// changes. Re-run this after retiming a scene.
//
// Am - F - C - G, one chord a bar. Sections follow the scenes:
//   Cold open           full drums at once, a chord stab on every shot
//   Hook, Introducing   kick, hats and rolling bass under the arp, filtered down; riser into...
//   Features .. Parse   everything: clap, open hats, 16th hats, pumping pad
//   Export              riser into it, then full again
//   Wordmark, End card  drums out on a big hit; the last chord rings
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- The edit -------------------------------------------------------------------------------------
const FPS = Number(
  /id="SimuStyleProduct"[\s\S]*?fps=\{([\d.]+)\}/.exec(readFileSync(join(root, "src/Root.tsx"), "utf8"))[1],
);
const FRAMES_PER_BEAT = 15;
const scenes = [];
{
  const src = readFileSync(join(root, "src/ProductVideo.tsx"), "utf8");
  let at = 0;
  for (const m of src.matchAll(/<TransitionSeries\.Sequence\s+name="([^"]+)"\s+durationInFrames=\{(\d+)\}/g)) {
    const frames = Number(m[2]);
    if (frames % FRAMES_PER_BEAT) throw new Error(`${m[1]} is ${frames} frames, not a whole number of beats`);
    scenes.push({ name: m[1], beat: at / FRAMES_PER_BEAT, beats: frames / FRAMES_PER_BEAT });
    at += frames;
  }
}
const scene = (name) => {
  const s = scenes.find((x) => x.name === name);
  if (!s) throw new Error(`no scene "${name}" in ProductVideo.tsx`);
  return s;
};
const TOTAL_BEATS = scenes.reduce((n, s) => n + s.beats, 0);

const SR = 44100;
const BEAT = FRAMES_PER_BEAT / FPS;
const LENGTH = TOTAL_BEATS * BEAT;
const N = Math.ceil(LENGTH * SR);
const bt = (beat) => beat * BEAT; // beat -> seconds

// Section boundaries, in beats.
const HOOK = scene("Hook").beat;
const FULL = scene("What it is").beat;
const EXPORT = scene("Export").beat;
const OUTRO = scene("Wordmark").beat;

// --- Buffers --------------------------------------------------------------------------------------
const L = new Float32Array(N);
const R = new Float32Array(N);
const padL = new Float32Array(N);
const padR = new Float32Array(N);
const send = new Float32Array(N); // reverb send
const duck = new Float32Array(N).fill(1); // sidechain gain written by the kick

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
let seed = 0x2f6b1d; // deterministic noise: every run writes the same file
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};
const span = (time, seconds) => {
  const s0 = Math.max(0, Math.floor(time * SR));
  return [s0, Math.max(0, Math.min(Math.floor(seconds * SR), N - s0))];
};
const put = (i, v, pan, rev = 0) => {
  L[i] += v * (1 - pan);
  R[i] += v * pan;
  if (rev) send[i] += v * rev;
};

// Am, F, C, G, close voicings around middle C.
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 67] },
  { root: 41, notes: [57, 60, 65, 69] },
  { root: 48, notes: [55, 60, 64, 67] },
  { root: 43, notes: [55, 59, 62, 67] },
];
const chordAt = (beat) => CHORDS[Math.floor(beat / 4) % 4];

// --- Voices ---------------------------------------------------------------------------------------
function pad(beat, beats, level) {
  const [s0, len] = span(bt(beat), bt(beats) + 0.3);
  const dur = len / SR;
  for (const note of chordAt(beat).notes) {
    for (const [detune, pan] of [
      [-0.08, 0.2],
      [0.08, 0.8],
    ]) {
      const f = midi(note + detune);
      let phase = Math.abs(rand());
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        phase += f / SR;
        phase -= Math.floor(phase);
        lp += (1 - Math.exp((-2 * Math.PI * 1600) / SR)) * (phase * 2 - 1 - lp);
        const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.25);
        const v = lp * env * level;
        padL[s0 + i] += v * (1 - pan);
        padR[s0 + i] += v * pan;
      }
    }
  }
}

// Saw pluck with a closing filter: the 16th-note engine of the track.
function pluck(time, note, gain, pan, bright) {
  const [s0, len] = span(time, 0.35);
  const f = midi(note);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += f / SR;
    phase -= Math.floor(phase);
    const cutoff = 300 + bright * Math.exp(-t * 18);
    lp += (1 - Math.exp((-2 * Math.PI * cutoff) / SR)) * (phase * 2 - 1 - lp);
    put(s0 + i, lp * Math.exp(-t * 9) * Math.min(1, t / 0.002) * gain * 2, pan, 0.4);
  }
}

// Short chord stab, for the cold open's cuts.
function stab(time, gain) {
  for (const note of chordAt(time / BEAT).notes) pluck(time, note + 12, gain, 0.5, 5000);
  for (const note of chordAt(time / BEAT).notes) pluck(time, note, gain * 0.8, 0.5, 3000);
}

function kick(time, gain) {
  const [s0, len] = span(time, 0.4);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (48 + 110 * Math.exp(-t * 35))) / SR;
    const v = Math.tanh(Math.sin(phase) * Math.exp(-t * 7) * 1.6) * gain + rand() * Math.exp(-t * 500) * 0.12 * gain;
    L[s0 + i] += v;
    R[s0 + i] += v;
  }
  const [d0, dlen] = span(time, BEAT);
  for (let i = 0; i < dlen; i++) duck[d0 + i] = Math.min(duck[d0 + i], 1 - 0.7 * Math.exp(-(i / SR) * 8));
}

function clap(time, gain) {
  const [s0, len] = span(time, 0.25);
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Three quick bursts, then a tail: the shape of a hand clap.
    const burst = t < 0.03 ? Math.exp(-((t * 1000) % 10) * 0.35) : Math.exp(-(t - 0.03) * 22);
    const n = rand();
    bp1 += 0.35 * (n - bp1);
    bp2 += 0.08 * (bp1 - bp2);
    put(s0 + i, (bp1 - bp2) * burst * gain * 4.4, 0.5, 0.5);
  }
}

function hat(time, gain, pan, open = false) {
  const [s0, len] = span(time, open ? 0.25 : 0.05);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const n = rand();
    const hp = n - prev;
    prev = n;
    put(s0 + i, hp * Math.exp(-t * (open ? 14 : 70)) * gain * 2, pan, 0.15);
  }
}

function bass(time, note, dur, gain) {
  const [s0, len] = span(time, dur);
  const f = midi(note);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += f / SR;
    phase -= Math.floor(phase);
    lp += (1 - Math.exp((-2 * Math.PI * (180 + 900 * Math.exp(-t * 20))) / SR)) * (phase * 2 - 1 - lp);
    const sub = Math.sin(2 * Math.PI * f * t);
    const env = Math.min(1, t / 0.004) * Math.min(1, (dur - t) / 0.02);
    const v = (sub * 0.8 + lp * 0.6) * env * gain;
    L[s0 + i] += v;
    R[s0 + i] += v;
  }
}

// The hit on a cut: a sub boom and a crash of filtered noise into the reverb.
function impact(time, size) {
  const [s0, len] = span(time, 1.6 * size);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (38 + 60 * Math.exp(-t * 12))) / SR;
    const boom = Math.sin(phase) * Math.exp(-t * 3.2) * 0.55 * size;
    lp += 0.25 * (rand() - lp);
    const crash = (rand() - lp) * Math.exp(-t * (4.5 / size)) * 0.16 * size;
    L[s0 + i] += boom + crash * 0.9;
    R[s0 + i] += boom + crash * 1.1;
    send[s0 + i] += crash * 1.2;
  }
}

// Noise swelling up into a downbeat.
function riser(endTime, seconds, gain) {
  const [s0, len] = span(endTime - seconds, seconds);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const cutoff = 400 + 9000 * p * p;
    lp += (1 - Math.exp((-2 * Math.PI * cutoff) / SR)) * (rand() - lp);
    put(s0 + i, lp * p ** 2.5 * gain * 2, 0.5 + 0.3 * Math.sin(p * 20), 0.6);
  }
}

// --- Arrangement ----------------------------------------------------------------------------------
const ARP = [0, 2, 3, 1, 2, 3, 0, 2, 3, 1, 2, 3, 0, 3, 2, 1]; // chord tone per 16th of a bar

for (let beat = 0; beat < TOTAL_BEATS; beat++) {
  const t = bt(beat);
  const inBar = beat % 4;
  const { root, notes } = chordAt(beat);
  const cold = beat < HOOK;
  const low = beat >= HOOK && beat < FULL; // filtered groove under the hook and title
  const full = beat >= FULL && beat < OUTRO;
  const outro = beat >= OUTRO;

  if (inBar === 0 || beat === HOOK || beat === FULL || beat === OUTRO) {
    const beats = outro ? TOTAL_BEATS - beat : Math.min(4 - inBar, TOTAL_BEATS - beat);
    pad(beat, beats, outro ? 0.075 : full ? 0.05 : 0.04);
  }

  if (!outro) {
    kick(t, inBar === 0 ? 0.95 : 0.85);
    bass(t, root - 12, BEAT / 2 - 0.03, 0.16);
    bass(t + BEAT / 2, root - (full && inBar === 3 ? 0 : 12), BEAT / 2 - 0.03, 0.3);
    hat(t + BEAT / 2, cold || full ? 0.22 : 0.15, 0.6, full);
    if (full || cold) {
      if (inBar === 1 || inBar === 3) clap(t, 0.5);
      for (let s = 1; s < 4; s += 2) hat(t + s * (BEAT / 4), 0.07, 0.35);
    }
  }

  // The arp: every 16th, opening up as the track builds; it plays one more bar into the outro.
  if (beat < OUTRO + 4) {
    const arpGain = cold ? 0.05 : low ? 0.06 : full ? 0.075 : 0.05;
    const bright = cold ? 4000 : low ? 1500 + 2500 * ((beat - HOOK) / (FULL - HOOK)) : full ? 4500 : 2500;
    for (let s = 0; s < 4; s++) {
      const step = inBar * 4 + s;
      pluck(t + s * (BEAT / 4), notes[ARP[step]] + 12, arpGain * (s === 0 ? 1 : 0.75), step % 2 ? 0.7 : 0.3, bright);
    }
  }
}

// Stabs on the cold open's three shots (cut on beats 0, 1 and 2).
for (const b of [0, 1, 2]) stab(bt(b), 0.07);

// A hit on every cut; bigger where the section changes.
const big = new Set([0, HOOK, FULL, EXPORT, OUTRO]);
for (const s of scenes) impact(bt(s.beat), big.has(s.beat) ? 1.25 : 0.75);

// Risers into the big moments.
riser(bt(FULL), bt(4), 0.5);
riser(bt(EXPORT), bt(4), 0.4);
riser(bt(OUTRO), bt(2), 0.45);

// The last chord: one long low root under the ringing pad.
bass(bt(OUTRO), chordAt(OUTRO).root - 12, bt(TOTAL_BEATS - OUTRO) - 0.1, 0.22);

// --- Mix ------------------------------------------------------------------------------------------
for (let i = 0; i < N; i++) {
  padL[i] *= duck[i];
  padR[i] *= duck[i];
  L[i] += padL[i];
  R[i] += padR[i];
  send[i] += (padL[i] + padR[i]) * 0.3;
}

function reverb(input, combs, allpasses) {
  const out = new Float32Array(N);
  for (const [delay, fb] of combs) {
    const buf = new Float32Array(delay);
    let idx = 0;
    let damp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      damp = y * 0.55 + damp * 0.45;
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
    [1557, 0.84],
    [1617, 0.84],
    [1491, 0.84],
    [1422, 0.84],
  ],
  [225, 556],
);
const revR = reverb(
  send,
  [
    [1577, 0.84],
    [1637, 0.84],
    [1511, 0.84],
    [1442, 0.84],
  ],
  [245, 576],
);

let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.01) * Math.min(1, (LENGTH - t) / 1.2);
  L[i] = Math.tanh((L[i] + revL[i] * 0.5) * 1.25) * fade;
  R[i] = Math.tanh((R[i] + revR[i] * 0.5) * 1.25) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}

// --- Write 16-bit WAV, then MP3 -------------------------------------------------------------------
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
writeFileSync(join(root, "audio", "music.wav"), pcm);
// Relative paths: on Windows the call goes through a shell, which would split a path with spaces.
execFileSync(
  "npx",
  ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", "audio/music.wav", "-b:a", "192k", "public/music.mp3"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
console.log(`wrote public/music.mp3: ${LENGTH.toFixed(2)} s, ${TOTAL_BEATS} beats at ${(60 / BEAT).toFixed(2)} BPM`);
for (const s of scenes) console.log(`  beat ${String(s.beat).padStart(3)}  ${bt(s.beat).toFixed(2).padStart(6)} s  ${s.name}`);
