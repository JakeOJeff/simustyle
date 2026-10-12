import "./index.css";
import { Composition, Folder } from "remotion";
import { ProductVideo } from "./ProductVideo";
import { BuildScene } from "./scenes/BuildScene";
import commandClip from "./clips/command.json";
import playClip from "./clips/play.json";
import scriptClip from "./clips/script.json";
import { EditorScene } from "./scenes/EditorScene";
import { EditorShot } from "./scenes/EditorShot";
import { IntroTitleScene } from "./scenes/IntroTitleScene";
import { EndCardScene } from "./scenes/EndCardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { HookScene } from "./scenes/HookScene";
import { OutroScene } from "./scenes/OutroScene";
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
          id="Introducing"
          component={IntroTitleScene}
          durationInFrames={100}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ lead: "Introducing", subject: "SimuStyle" }}
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
          id="EditorPlay"
          component={EditorShot}
          durationInFrames={175}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            clip: "play",
            meta: playClip,
            camera: [{ at: 30, duration: 30, zoom: 1.7, x: 0.56, y: 0.36 }],
            caption: "Press Play. It's already a game.",
            captionAt: 44,
          }}
        />
        <Composition
          id="EditorCommands"
          component={EditorShot}
          durationInFrames={145}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            clip: "command",
            meta: commandClip,
            camera: [
              { at: 2, duration: 22, zoom: 1.9, x: 0.5, y: 0.86 },
              { at: 46, duration: 24, zoom: 1.35, x: 0.5, y: 0.55 },
              { at: 118, duration: 25, zoom: 1 },
            ],
            caption: "Or just type what you want.",
            captionAt: 10,
          }}
        />
        <Composition
          id="EditorParse"
          component={EditorShot}
          durationInFrames={226}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            clip: "script",
            meta: scriptClip,
            camera: [
              { at: 62, duration: 22, zoom: 1.8, x: 0.43, y: 0.3 },
              { at: 134, duration: 22, zoom: 1.5, x: 0.5, y: 0.38 },
              { at: 196, duration: 25, zoom: 1.8, x: 0.43, y: 0.3 },
            ],
            caption: "Typos? Fixed on your machine.",
            captionAt: 140,
          }}
        />
        <Composition
          id="Export"
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
        durationInFrames={1376}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
