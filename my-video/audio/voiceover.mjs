// Generates the product video's voiceover with ElevenLabs, one line per scene:
//
//   node audio/voiceover.mjs        (reads ELEVENLABS_API_KEY from my-video/.env)
//
// Writes public/voiceover/<scene>.mp3 and src/voiceover.json, which ProductVideo reads to place
// each line LEAD frames into its scene and to duck the music under it. A line is only
// regenerated when its text or the voice changes, so re-running is free. Every line must fit
// inside its scene; scenes are whole beats of the music (audio/compose.mjs), so lengthen one
// by 15 frames at a time if a line runs over.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Jessica: a young, upbeat, conversational American female voice from the ElevenLabs library,
// matched to the music's 120 BPM launch-video energy.
const VOICE = "cgSgspJ2msm6clMCkdW9";
// multilingual_v2 rather than v3: v3's expressive modes improvise breaths, laughs and stray voices
// between words, and can't take the neighbouring lines that keep a dozen takes sounding like one
// read. Style is pushed up for energy; speed a touch quick to sit on the beat.
const MODEL = "eleven_multilingual_v2";
const SETTINGS = { stability: 0.4, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true, speed: 1.08 };
const LEAD = 6; // frames between a cut and the line starting

// Keyed by the scene's name in ProductVideo.tsx; a list places several lines, each `at` frames into
// the scene (Features reads one line per card). Scenes without a line play over music alone.
//
// A small story told like a person talking: you can picture it, building it in 3D is the hard
// part, so SimuStyle; then one sentence becomes function calls on the scene, you play it, tweak
// it, fix the script and ship it. SimuStyle is a 3D sandbox, not a game engine. Lines are short so
// there is air between them; Wordmark and the cold open are music only.
const LINES = {
  Hook: "You can picture it. Building it in 3D? That's the hard part.",
  Introducing: "So, meet SimuStyle.",
  "What it is": [
    { at: 0, text: "A 3D sandbox, with physics." },
    { at: 60, text: "AI agents that build with you." },
    { at: 120, text: "And scripts AI can fix." },
  ],
  Assistant: "Just describe it.",
  "Agent at work": "The agent calls functions, create, update, delete, right on your scene.",
  "Editor · Play": "Hit play. It's live.",
  "Editor · Commands": "Tweak it in plain English.",
  "Editor · AI Parse": "Write it messy. AI Parse tidies it up.",
  Export: "Then ship it, anywhere.",
  "End card": "Your idea, made real.",
};

// --- Env and the edit ------------------------------------------------------------------------------
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("Set ELEVENLABS_API_KEY in my-video/.env");

const FPS = Number(
  /id="SimuStyleProduct"[\s\S]*?fps=\{([\d.]+)\}/.exec(readFileSync(join(root, "src/Root.tsx"), "utf8"))[1],
);
const scenes = [];
{
  let at = 0;
  const src = readFileSync(join(root, "src/ProductVideo.tsx"), "utf8");
  for (const m of src.matchAll(/<TransitionSeries\.Sequence\s+name="([^"]+)"\s+durationInFrames=\{(\d+)\}/g)) {
    scenes.push({ name: m[1], from: at, frames: Number(m[2]) });
    at += Number(m[2]);
  }
}

// --- Generate -------------------------------------------------------------------------------------
const manifestFile = join(root, "src/voiceover.json");
const outDir = join(root, "public/voiceover");
mkdirSync(outDir, { recursive: true });

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Flatten to one entry per line, in script order, each with the frames it has before the next
// line (or the end of its scene).
const script = Object.entries(LINES).flatMap(([name, value]) => {
  const scene = scenes.find((s) => s.name === name);
  if (!scene) throw new Error(`no scene "${name}" in ProductVideo.tsx`);
  const list = typeof value === "string" ? [{ at: 0, text: value }] : value;
  return list.map((l, k) => ({
    scene,
    at: l.at,
    text: l.text,
    settings: { ...SETTINGS, ...(l.speed ? { speed: l.speed } : {}) },
    room: (list[k + 1]?.at ?? scene.frames) - l.at - LEAD - 3,
    base: `${slug(name)}${list.length > 1 ? `-${k + 1}` : ""}`,
  }));
});

const lines = [];
let over = false;
const ffmpeg = (args) => {
  const r = spawnSync("npx", ["remotion", "ffmpeg", "-loglevel", "error", "-y", ...args], {
    cwd: root,
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr}`);
};

/** First and last moment of speech in a file, in seconds: samples above -40 dBFS at 8 kHz mono. */
function speechSpan(file) {
  // Remotion's ffmpeg build has no raw muxer, so go through a WAV and read its data chunk.
  ffmpeg(["-i", file, "-ac", "1", "-ar", "8000", "audio/probe.wav"]);
  const wav = readFileSync(join(root, "audio/probe.wav"));
  rmSync(join(root, "audio/probe.wav"));
  const data = wav.indexOf("data");
  const pcm = wav.subarray(data + 8, data + 8 + wav.readUInt32LE(data + 4));
  const count = pcm.length / 2;
  const loud = (i) => Math.abs(pcm.readInt16LE(i * 2)) > 328;
  let first = 0;
  let last = count - 1;
  while (first < count && !loud(first)) first++;
  while (last > first && !loud(last)) last--;
  if (first >= count) throw new Error(`no speech found in ${file}`);
  return [first / 8000, last / 8000];
}

const takesDir = join(root, "audio/takes");
mkdirSync(takesDir, { recursive: true });

for (const [i, line] of script.entries()) {
  const { scene, text } = line;
  const previousText = script[i - 1]?.text;
  const nextText = script[i + 1]?.text;
  const hash = createHash("sha1")
    .update(JSON.stringify([VOICE, MODEL, line.settings, text, previousText, nextText]))
    .digest("hex")
    .slice(0, 12);
  // The untouched ElevenLabs take, kept so trimming and stretching never cost a request.
  const take = `audio/takes/${hash}.mp3`;
  // Named by content, so a preview can never play a stale take under a reused name.
  const file = `voiceover/${line.base}-${hash}.mp3`;

  if (!existsSync(join(root, take))) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: line.settings,
        // The lines either side, so a dozen takes read as one continuous performance.
        previous_text: previousText,
        next_text: nextText,
      }),
    });
    if (!res.ok) throw new Error(`${scene.name}: ElevenLabs ${res.status} ${await res.text()}`);
    writeFileSync(join(root, take), Buffer.from(await res.arrayBuffer()));
    console.log(`generated ${take} (${text})`);
  }

  // Cut the take to its speech, and if it still overruns its slot, speed it up (pitch kept) by up
  // to 1.15x; past that it sounds rushed, so rewrite the line instead.
  const [start, end] = speechSpan(take);
  const spoken = Math.ceil((end - start) * FPS);
  const tempo = Math.min(1.15, Math.max(1, spoken / line.room));
  ffmpeg([
    "-ss",
    start.toFixed(3),
    "-to",
    (end + 0.08).toFixed(3),
    "-i",
    take,
    "-af",
    `atempo=${tempo.toFixed(3)}`,
    "-b:a",
    "160k",
    `public/${file}`,
  ]);
  const frames = Math.ceil(spoken / tempo);
  if (frames > line.room) {
    over = true;
    console.warn(`  ! "${text}" is ${frames} frames even at 1.15x; it has room for ${line.room}`);
  }
  lines.push({
    scene: scene.name,
    file,
    hash,
    from: scene.from + line.at + LEAD,
    trim: 0,
    frames,
    tempo: Number(tempo.toFixed(3)),
    text,
  });
}

writeFileSync(manifestFile, JSON.stringify({ lead: LEAD, lines }, null, 2) + "\n");

// Drop takes and voice files the script no longer uses.
const used = new Set(lines.flatMap((l) => [l.file.replace("voiceover/", ""), `${l.hash}.mp3`]));
for (const dir of [outDir, takesDir])
  for (const name of readdirSync(dir)) if (!used.has(name)) rmSync(join(dir, name));
for (const l of lines)
  console.log(
    `  ${String(l.from).padStart(4)}  +${String(l.frames).padStart(3)}  ${l.tempo > 1 ? `x${l.tempo} ` : ""}${l.scene}: ${l.text}`,
  );
if (over) process.exitCode = 1;
