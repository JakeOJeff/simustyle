import { TransitionSeries } from "@remotion/transitions";
import { useVideoConfig } from "remotion";
import { BuildScene } from "./scenes/BuildScene";
import { EditorScene } from "./scenes/EditorScene";
import { EndCardScene } from "./scenes/EndCardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { HookScene } from "./scenes/HookScene";
import { OutroScene } from "./scenes/OutroScene";
import { ParseScene } from "./scenes/ParseScene";
import { PromptScene } from "./scenes/PromptScene";

// Hard cuts between scenes; each snapcn scene carries its own camera motion.
export const ProductVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={75} premountFor={fps}>
        <HookScene
          headline="Make games in"
          words="C++, JavaScript, C#, GDScript, Lua, Python, Rust, English."
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Prompt" durationInFrames={105} premountFor={fps}>
        <PromptScene greeting="What should we build?" text="A mini-golf hole with a spinning windmill" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Build" durationInFrames={140} premountFor={fps}>
        <BuildScene query="A mini-golf hole with a spinning windmill" result="Scene built · 1 undoable edit" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="AI Parse" durationInFrames={165} premountFor={fps}>
        <ParseScene intro="*type it* how you'd *say it.*" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Editor" durationInFrames={130} premountFor={fps}>
        <EditorScene
          headline="ship it | anywhere."
          capturing="Exporting scene..."
          copied="Exported to GLB, HTML & WebM."
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Features" durationInFrames={135} premountFor={fps}>
        <FeaturesScene script="Real physics. / Keyframe animation. | Runs in your browser. / Or on Windows. | Free." />
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
