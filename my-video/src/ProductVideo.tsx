import { TransitionSeries } from "@remotion/transitions";
import { useVideoConfig } from "remotion";
import commandClip from "./clips/command.json";
import playClip from "./clips/play.json";
import scriptClip from "./clips/script.json";
import { AssistantScene } from "./scenes/AssistantScene";
import { BuildScene } from "./scenes/BuildScene";
import { EditorScene } from "./scenes/EditorScene";
import { EditorShot } from "./scenes/EditorShot";
import { EndCardScene } from "./scenes/EndCardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { HookScene } from "./scenes/HookScene";
import { IntroTitleScene } from "./scenes/IntroTitleScene";
import { OutroScene } from "./scenes/OutroScene";

// snapcn motion beats, skinned as SimuStyle UI, cut against real editor footage (capture/capture.mjs).
export const ProductVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={75} premountFor={fps}>
        <HookScene headline="Script in" words="C++, JavaScript, C#, GDScript, Lua, Python, Rust, English." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Introducing" durationInFrames={100} premountFor={fps}>
        <IntroTitleScene lead="Introducing" subject="SimuStyle" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="What it is" durationInFrames={140} premountFor={fps}>
        <FeaturesScene script="A 3D sandbox / with real physics. | AI agents / that build with you. | A script language / AI can fix." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Assistant" durationInFrames={140} premountFor={fps}>
        <AssistantScene text="Build a small mini-golf hole I can play, with a windmill that spins forever" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Agent at work" durationInFrames={140} premountFor={fps}>
        <BuildScene
          query="Build a small mini-golf hole I can play, with a windmill that spins forever"
          result="Built a playable mini-golf hole · Undo this change"
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Editor · Play" durationInFrames={175} premountFor={fps}>
        <EditorShot
          clip="play"
          meta={playClip}
          camera={[{ at: 30, duration: 30, zoom: 1.7, x: 0.56, y: 0.36 }]}
          caption="Press Play. Physics and scripts run live."
          captionAt={44}
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Editor · Commands" durationInFrames={145} premountFor={fps}>
        <EditorShot
          clip="command"
          meta={commandClip}
          camera={[
            { at: 2, duration: 22, zoom: 1.9, x: 0.5, y: 0.86 },
            { at: 46, duration: 24, zoom: 1.35, x: 0.5, y: 0.55 },
            { at: 118, duration: 25, zoom: 1 },
          ]}
          caption="Or type commands in plain English."
          captionAt={10}
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Editor · AI Parse" durationInFrames={226} premountFor={fps}>
        <EditorShot
          clip="script"
          meta={scriptClip}
          camera={[
            { at: 62, duration: 22, zoom: 1.8, x: 0.43, y: 0.3 },
            { at: 134, duration: 22, zoom: 1.5, x: 0.5, y: 0.38 },
            { at: 196, duration: 25, zoom: 1.8, x: 0.43, y: 0.3 },
          ]}
          caption="Write it sloppy. AI Parse fixes it."
          captionAt={140}
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Export" durationInFrames={130} premountFor={fps}>
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
  );
};
