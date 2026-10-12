import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { staticFile, useVideoConfig } from "remotion";
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

// snapcn motion beats, skinned as SimuStyle UI, cut against real editor footage (capture/capture.mjs),
// over an original music bed composed to the cut (audio/compose.mjs).
export const ProductVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <>
      <Audio
        name="Music"
        src={staticFile("music.mp3")}
        volume={0.7}
        premountFor={fps}
        from={29}
      />
      <TransitionSeries>
        <TransitionSeries.Sequence name="Hook" durationInFrames={75} premountFor={fps}>
          <HookScene headline="Script in" words="C++, JavaScript, C#, GDScript, Lua, Python, Rust, English." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Introducing" durationInFrames={100} premountFor={fps}>
          <IntroTitleScene lead="Introducing" subject="SimuStyle" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="What it is" durationInFrames={140} premountFor={fps}>
          <FeaturesScene
            one="A 3D sandbox"
            oneSub="with real physics."
            two="AI agents"
            twoSub="that build with you."
            three="A script language"
            threeSub="AI can fix."
          />
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
        <TransitionSeries.Sequence name="Editor · Play" durationInFrames={193} premountFor={fps}>
          <EditorShot
            clip="play"
            meta={playClip}
            camera={[{ at: 30, duration: 30, zoom: 1.7, x: 0.56, y: 0.36 }]}
            title="Press Play."
            caption="Physics and scripts run live."
            captionAt={44}
            reveal="blur"
            captionReveal="words"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Editor · Commands" durationInFrames={163} premountFor={fps}>
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
        <TransitionSeries.Sequence name="Editor · AI Parse" durationInFrames={244} premountFor={fps}>
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
    </>
  );
};
