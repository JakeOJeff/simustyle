import "./index.css";
import { Composition, Folder } from "remotion";
import { ProductVideo } from "./ProductVideo";
import { BuildScene } from "./scenes/BuildScene";
import { EditorScene } from "./scenes/EditorScene";
import { EndCardScene } from "./scenes/EndCardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { HookScene } from "./scenes/HookScene";
import { OutroScene } from "./scenes/OutroScene";
import { ParseScene } from "./scenes/ParseScene";
import { PromptScene } from "./scenes/PromptScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Scenes">
        <Composition
          id="Hook"
          component={HookScene}
          durationInFrames={75}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            headline: "Make games in",
            words: "C++, JavaScript, C#, GDScript, Lua, Python, Rust, English.",
          }}
        />
        <Composition
          id="Prompt"
          component={PromptScene}
          durationInFrames={105}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            greeting: "What should we build?",
            text: "A mini-golf hole with a spinning windmill",
          }}
        />
        <Composition
          id="Build"
          component={BuildScene}
          durationInFrames={140}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            query: "A mini-golf hole with a spinning windmill",
            result: "Scene built · 1 undoable edit",
          }}
        />
        <Composition
          id="AIParse"
          component={ParseScene}
          durationInFrames={165}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ intro: "*type it* how you'd *say it.*" }}
        />
        <Composition
          id="Editor"
          component={EditorScene}
          durationInFrames={130}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            headline: "ship it | anywhere.",
            capturing: "Exporting scene...",
            copied: "Exported to GLB, HTML & WebM.",
          }}
        />
        <Composition
          id="Features"
          component={FeaturesScene}
          durationInFrames={135}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            script: "Real physics. / Keyframe animation. | Runs in your browser. / Or on Windows. | Free.",
          }}
        />
        <Composition
          id="Wordmark"
          component={OutroScene}
          durationInFrames={45}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ word: "simustyle." }}
        />
        <Composition
          id="EndCard"
          component={EndCardScene}
          durationInFrames={90}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            wordmark: "simustyle",
            url: "simustyle.curiousengine.org",
            note: "Free forever · No account needed",
          }}
        />
      </Folder>
      {/* Sum of the scene durations above; hard cuts, so nothing overlaps. */}
      <Composition
        id="SimuStyleProduct"
        component={ProductVideo}
        durationInFrames={885}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
