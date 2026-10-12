import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { CursorTrack, type CursorWaypoint } from "../components/snap-cn/cursor-track";
import {
  cameraPoseAt,
  clampFocus,
  ScreenRecording,
  type CameraMove,
} from "../components/snap-cn/screen-recording";
import { accent, brand, dmSans } from "../brand";

/** What capture/capture.mjs writes next to each clip: its length and every real click. */
export type ClipMeta = {
  readonly frames: number;
  readonly clicks: readonly { at: number; x: number; y: number }[];
};

/** Turn the recorded clicks into a cursor path that arrives on each click's frame. */
export function cursorPath(meta: ClipMeta): CursorWaypoint[] {
  const [first] = meta.clicks;
  if (!first) return [];
  return [
    { at: Math.max(0, first.at - 24), x: first.x - 0.06, y: 1.04, duration: 6 },
    ...meta.clicks.map((c) => ({ at: c.at - 12, x: c.x, y: c.y, duration: 12, click: true })),
  ];
}

type EditorShotProps = {
  readonly clip: string;
  readonly meta: ClipMeta;
  readonly camera: CameraMove[];
  readonly caption: string;
  readonly captionAt: number;
};

// Real editor footage in a floating window, with camera pushes, the recorded cursor and a caption.
const EditorShotInner: React.FC<EditorShotProps> = ({ clip, meta, camera, caption, captionAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The cursor sits inside the same camera transform as the footage, so it stays on the
  // pixel it clicked through every push and pull.
  const pose = cameraPoseAt(frame, camera);
  const tx = (0.5 - clampFocus(pose.x, pose.zoom) * pose.zoom) * 100;
  const ty = (0.5 - clampFocus(pose.y, pose.zoom) * pose.zoom) * 100;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0b" }}>
      <Interactive.Div
        name="Window"
        style={{
          position: "absolute",
          left: 96,
          top: 54,
          width: 1728,
          height: 972,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 0 0 1px #ffffff1a, 0 40px 120px #000000",
          scale: interpolate(frame, [0, 0.7 * fps], [0.96, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      >
        <ScreenRecording
          src={staticFile(`clips/${clip}.mp4`)}
          sourceAspect={16 / 9}
          camera={camera}
          theme={brand}
          mode="dark"
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "0 0",
            transform: `translate(${tx}%, ${ty}%) scale(${pose.zoom})`,
          }}
        >
          {/* CursorTrack places itself in full-frame pixels; the window is 0.9 of the frame. */}
          <div style={{ position: "absolute", width: 1920, height: 1080, scale: "0.9", transformOrigin: "0 0" }}>
            <CursorTrack path={cursorPath(meta)} mode="dark" ringColor={accent} />
          </div>
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Caption"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 86,
          translate: interpolate(frame, [captionAt, captionAt + 0.5 * fps], ["-50% 24px", "-50% 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          opacity: interpolate(frame, [captionAt, captionAt + 0.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          padding: "18px 30px",
          borderRadius: 999,
          backgroundColor: "#0a0a0bdd",
          boxShadow: "0 0 0 1px #ffffff1f, 0 20px 60px #00000099",
          backdropFilter: "blur(12px)",
          color: "#fafafa",
          fontFamily: dmSans,
          fontSize: 38,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {caption}
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const editorShotSchema = {
  clip: { type: "string", default: "play", description: "Clip name in public/clips" },
  caption: { type: "string", default: "", description: "Caption" },
  captionAt: { type: "number", default: 20, description: "Caption entrance frame", hiddenFromList: false },
} as const satisfies InteractivitySchema;

export const EditorShot = Interactive.withSchema({
  Component: EditorShotInner,
  componentName: "EditorShot",
  schema: editorShotSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
