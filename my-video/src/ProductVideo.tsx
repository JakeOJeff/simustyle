import { linearTiming, springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { useVideoConfig } from "remotion";
import { AssistantScene } from "./scenes/AssistantScene";
import { CtaScene } from "./scenes/CtaScene";
import { EditorScene } from "./scenes/EditorScene";
import { HookScene } from "./scenes/HookScene";
import { IntroScene } from "./scenes/IntroScene";
import { ParseScene } from "./scenes/ParseScene";
import { ScriptScene } from "./scenes/ScriptScene";

export const ProductVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={105} premountFor={fps}>
        <IntroScene tagline="Plain-English 3D worlds, powered by AI" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="Hook" durationInFrames={90} premountFor={fps}>
        <HookScene lineOne="You describe it." lineTwo="We make it real." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="AI Parse" durationInFrames={210} premountFor={fps}>
        <ParseScene eyebrow="✦ AI Parse" title="Type it how you'd say it. SimuStyle makes it run." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="Scene assistant" durationInFrames={180} premountFor={fps}>
        <AssistantScene
          eyebrow="Scene assistant"
          title="Describe a whole scene. Get a playable one."
          prompt={
            'Build a small mini-golf hole I can play. A white ball that rolls with physics, a windmill whose red blades spin forever, and a hole with a flag. When the ball reaches the hole, say "Hole in one!"'
          }
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="Editor" durationInFrames={195} premountFor={fps}>
        <EditorScene eyebrow="Everything in one editor" title="From empty scene to playable demo." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="Scripting" durationInFrames={165} premountFor={fps}>
        <ScriptScene eyebrow="Scripting" title="Logic you can read out loud." />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="Call to action" durationInFrames={150} premountFor={fps}>
        <CtaScene headline="Build your first world today." url="simustyle.curiousengine.org" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
