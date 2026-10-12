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
import { AssistantScene } from "./scenes/AssistantScene";

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
            headline: "Script in",
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
          id="Assistant"
          component={AssistantScene}
          durationInFrames={140}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ text: "Build a small mini-golf hole I can play, with a windmill that spins forever" }}
        />
        <Composition
          id="Build"
          component={BuildScene}
          durationInFrames={140}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            query: "Build a small mini-golf hole I can play, with a windmill that spins forever",
            result: "Built a playable mini-golf hole · Undo this change",
          }}
        />
        <Composition
          id="EditorPlay"
          component={EditorShot}
          durationInFrames={193}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            clip: "play",
            meta: playClip,
            camera: [{ at: 30, duration: 30, zoom: 1.7, x: 0.56, y: 0.36 }],
            title: "Press Play.",
            caption: "Physics and scripts run live.",
            captionAt: 44,
            reveal: "blur",
            captionReveal: "words",
          }}
        />
        <Composition
          id="EditorCommands"
          component={EditorShot}
          durationInFrames={163}
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
            title: "Type commands",
            caption: "in plain English.",
            captionAt: 12,
            reveal: "track",
            captionReveal: "words",
          }}
        />
        <Composition
          id="EditorParse"
          component={EditorShot}
          durationInFrames={244}
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
            title: "Write it sloppy.",
            caption: "AI Parse fixes it.",
            captionAt: 136,
            reveal: "spring",
            captionReveal: "decode",
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
          durationInFrames={140}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            one: "A 3D sandbox",
            oneSub: "with real physics.",
            two: "AI agents",
            twoSub: "that build with you.",
            three: "A script language",
            threeSub: "AI can fix.",
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
        durationInFrames={1460}
        fps={29.92}
        width={1920}
        height={1080}
      />
    </>
  );
};
