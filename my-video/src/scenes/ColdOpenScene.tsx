import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { SpringScaleIn } from "../components/remocn/spring-scale-in";
import { editor } from "../brand";

type Rect = { x: number; y: number; w: number; h: number };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One full-bleed beat of real footage: a region of a clip, cover-fitted to the frame, pushing in
 * while a word springs up over it. Each cut lands on a beat of the music.
 */
const Shot: React.FC<{ clip: string; at: number; rect: Rect; word: string }> = ({ clip, at, rect, word }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Cover-fit the region: scale the 1920x1080 source until the region fills the frame.
  const s = Math.max(1 / rect.w, 1 / rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: editor.page }}>
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, durationInFrames], [1.12, 1], {
            ...clamp,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          filter: `blur(${interpolate(frame, [0, 4], [10, 0], clamp)}px)`,
        }}
      >
        <Video
          src={staticFile(`clips/${clip}.mp4`)}
          trimBefore={at}
          muted
          objectFit="fill"
          style={{
            position: "absolute",
            width: 1920 * s,
            height: 1080 * s,
            left: 960 - cx * 1920 * s,
            top: 540 - cy * 1080 * s,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${editor.page}b3 0%, ${editor.page}40 55%, transparent 80%)`,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <SpringScaleIn
          text={word}
          staggerDelay={2}
          scaleFrom={0.5}
          fontSize={190}
          fontWeight={700}
          color="#ffffff"
          style={{ textShadow: "0 8px 60px #000000cc", letterSpacing: "-0.05em" }}
        />
      </AbsoluteFill>
      {/* A flash on the cut, so each beat lands. */}
      <AbsoluteFill
        style={{
          backgroundColor: "#ffffff",
          opacity: interpolate(frame, [0, 3], [0.18, 0], clamp),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

type ColdOpenProps = {
  readonly build: string;
  readonly play: string;
  readonly fix: string;
};

// Three beats of the real editor before a word of explanation: making something, playing it,
// and AI Parse fixing a script.
const ColdOpenInner: React.FC<ColdOpenProps> = ({ build, play, fix }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: editor.page }}>
      <Sequence name="Build" durationInFrames={15} premountFor={fps}>
        <Shot clip="command" at={135} rect={{ x: 0.28, y: 0.05, w: 0.44, h: 0.55 }} word={build} />
      </Sequence>
      <Sequence name="Play" from={15} durationInFrames={15} premountFor={fps}>
        <Shot clip="play" at={60} rect={{ x: 0.3, y: 0.1, w: 0.42, h: 0.48 }} word={play} />
      </Sequence>
      <Sequence name="Fix" from={30} durationInFrames={30} premountFor={fps}>
        <Shot clip="script" at={150} rect={{ x: 0.285, y: 0.18, w: 0.435, h: 0.345 }} word={fix} />
      </Sequence>
    </AbsoluteFill>
  );
};

const coldOpenSchema = {
  build: { type: "string", default: "Build it.", description: "Word over the first shot" },
  play: { type: "string", default: "Play it.", description: "Word over the second shot" },
  fix: { type: "string", default: "Fix it.", description: "Word over the third shot" },
} as const satisfies InteractivitySchema;

export const ColdOpenScene = Interactive.withSchema({
  Component: ColdOpenInner,
  componentName: "ColdOpenScene",
  schema: coldOpenSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
