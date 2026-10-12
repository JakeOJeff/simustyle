import { Composition, Folder } from "remotion";
import { ProductVideo } from "./ProductVideo";
import { AssistantScene } from "./scenes/AssistantScene";
import { CtaScene } from "./scenes/CtaScene";
import { EditorScene } from "./scenes/EditorScene";
import { HookScene } from "./scenes/HookScene";
import { IntroScene } from "./scenes/IntroScene";
import { ParseScene } from "./scenes/ParseScene";
import { ScriptScene } from "./scenes/ScriptScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Scenes">
        <Composition
          id="Intro"
          component={IntroScene}
          durationInFrames={105}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ tagline: "Plain-English 3D worlds, powered by AI" }}
        />
        <Composition
          id="Hook"
          component={HookScene}
          durationInFrames={90}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ lineOne: "You describe it.", lineTwo: "We make it real." }}
        />
        <Composition
          id="AIParse"
          component={ParseScene}
          durationInFrames={210}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            eyebrow: "✦ AI Parse",
            title: "Type it how you'd say it. SimuStyle makes it run.",
          }}
        />
        <Composition
          id="SceneAssistant"
          component={AssistantScene}
          durationInFrames={180}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            eyebrow: "Scene assistant",
            title: "Describe a whole scene. Get a playable one.",
            prompt:
              'Build a small mini-golf hole I can play. A white ball that rolls with physics, a windmill whose red blades spin forever, and a hole with a flag. When the ball reaches the hole, say "Hole in one!"',
          }}
        />
        <Composition
          id="Editor"
          component={EditorScene}
          durationInFrames={195}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            eyebrow: "Everything in one editor",
            title: "From empty scene to playable demo.",
          }}
        />
        <Composition
          id="Scripting"
          component={ScriptScene}
          durationInFrames={165}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ eyebrow: "Scripting", title: "Logic you can read out loud." }}
        />
        <Composition
          id="CallToAction"
          component={CtaScene}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            headline: "Build your first world today.",
            url: "simustyle.curiousengine.org",
          }}
        />
      </Folder>
      {/* 1095 frames of scenes minus six 15-frame transitions. */}
      <Composition
        id="SimuStyleProduct"
        component={ProductVideo}
        durationInFrames={1005}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
