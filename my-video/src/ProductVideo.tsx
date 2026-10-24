import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { interpolate, staticFile, useVideoConfig } from "remotion";
import commandClip from "./clips/command.json";
import playClip from "./clips/play.json";
import scriptClip from "./clips/script.json";
import { AssistantScene } from "./scenes/AssistantScene";
import { BuildScene } from "./scenes/BuildScene";
import { ColdOpenScene } from "./scenes/ColdOpenScene";
import { EditorScene } from "./scenes/EditorScene";
import { EditorShot } from "./scenes/EditorShot";
import { EndCardScene } from "./scenes/EndCardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { HookScene } from "./scenes/HookScene";
import { IntroTitleScene } from "./scenes/IntroTitleScene";
import { OutroScene } from "./scenes/OutroScene";
import voiceover from "./voiceover.json";

// snapcn motion beats, skinned as SimuStyle UI, cut against real editor footage (capture/capture.mjs),
// over an original music bed composed to the cut (audio/compose.mjs) and an ElevenLabs voiceover
// (audio/voiceover.mjs, which writes voiceover.json).

const MUSIC = 0.5;
const MUSIC_UNDER_VOICE = 0.2;
const DUCK_FRAMES = 6;

/** Music volume at a frame: pulled down under every voiceover line, with short ramps either side. */
function musicVolume(frame: number): number {
  let duck = 0;
  for (const line of voiceover.lines) {
    duck = Math.max(
      duck,
      interpolate(
        frame,
        [line.from - DUCK_FRAMES, line.from, line.from + line.frames, line.from + line.frames + DUCK_FRAMES * 2],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      ),
    );
  }
  return MUSIC + (MUSIC_UNDER_VOICE - MUSIC) * duck;
}

export const ProductVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <>
      <Audio name="Music" src={staticFile("music.mp3")} volume={musicVolume} premountFor={fps} />
      {/* Generated lines, placed by audio/voiceover.mjs; edit the script there, not here. */}
      {voiceover.lines.map((line) => (
        <Audio
          key={line.file}
          name={`VO · ${line.text}`}
          src={staticFile(line.file)}
          from={line.from}
          trimBefore={line.trim}
          volume={1}
          premountFor={fps}
        />
      ))}
      <TransitionSeries>
        <TransitionSeries.Sequence name="Cold open" durationInFrames={60} premountFor={fps}>
          <ColdOpenScene build="Build it." play="Play it." fix="Fix it." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Hook" durationInFrames={120} premountFor={fps}>
          <HookScene headline="Script in" words="C++, JavaScript, C#, GDScript, Lua, Python, Rust, English." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Introducing" durationInFrames={90} premountFor={fps}>
          <IntroTitleScene lead="Introducing" subject="SimuStyle" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="What it is" durationInFrames={180} premountFor={fps}>
          <FeaturesScene
            one="A 3D sandbox"
            oneSub="with real physics."
            two="AI agents"
            twoSub="that build with you."
            three="A script language"
            threeSub="AI can fix."
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Assistant" durationInFrames={120} premountFor={fps}>
          <AssistantScene text="Build a small mini-golf hole I can play, with a windmill that spins forever" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Agent at work" durationInFrames={150} premountFor={fps}>
          <BuildScene
            query="Build a small mini-golf hole I can play, with a windmill that spins forever"
            result="Built a playable mini-golf hole · Undo this change"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Editor · Play" durationInFrames={180} premountFor={fps}>
          <EditorShot
            clip="play"
            meta={playClip}
            camera={[]}
            focus={{ at: 27, duration: 24, rect: { x: 0.278, y: 0.057, w: 0.445, h: 0.537 }, drift: 0.04 }}
            title="Press Play."
            caption="Physics and scripts run live."
            captionAt={40}
            reveal="blur"
            captionReveal="words"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Editor · Commands" durationInFrames={165} premountFor={fps}>
          <EditorShot
            clip="command"
            meta={commandClip}
            camera={[
              { at: 2, duration: 22, zoom: 1.9, x: 0.5, y: 0.86 },
              { at: 46, duration: 24, zoom: 1.35, x: 0.5, y: 0.55 },
              { at: 118, duration: 25, zoom: 1 },
            ]}
            title="Type commands"
            caption="in plain English."
            captionAt={12}
            reveal="track"
            captionReveal="words"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Editor · AI Parse" durationInFrames={240} premountFor={fps}>
          <EditorShot
            clip="script"
            meta={scriptClip}
            camera={[
              { at: 62, duration: 22, zoom: 1.8, x: 0.43, y: 0.3 },
              { at: 134, duration: 22, zoom: 1.5, x: 0.5, y: 0.38 },
              { at: 196, duration: 25, zoom: 1.8, x: 0.43, y: 0.3 },
            ]}
            title="Write it sloppy."
            caption="AI Parse fixes it."
            captionAt={136}
            reveal="spring"
            captionReveal="decode"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Export" durationInFrames={135} premountFor={fps}>
          <EditorScene
            headline="ship it | anywhere."
            capturing="Exporting scene..."
            copied="Exported to GLB, HTML & WebM."
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Wordmark" durationInFrames={45} premountFor={fps}>
          <OutroScene word="simustyle." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="End card" durationInFrames={90} premountFor={fps}>
          <EndCardScene
            wordmark="simustyle"
            url="simustyle.curiousengine.org"
            note="Free forever · No account needed"
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </>
  );
};
