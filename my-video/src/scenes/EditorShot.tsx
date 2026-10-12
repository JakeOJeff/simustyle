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
import { BlurOutUp } from "../components/remocn/blur-out-up";
import { MatrixDecode } from "../components/remocn/matrix-decode";
import { SoftBlurIn } from "../components/remocn/soft-blur-in";
import { SpringScaleIn } from "../components/remocn/spring-scale-in";
import { TrackingIn } from "../components/remocn/tracking-in";
import { CursorTrack, type CursorWaypoint } from "../components/snap-cn/cursor-track";
import { cameraPoseAt, clampFocus, ScreenRecording, type CameraMove } from "../components/snap-cn/screen-recording";
import { accent, brand, dmMono, dmSans, editor } from "../brand";

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

/** Frames the title holds alone, full size, before the footage rises in under it. */
export const EDITOR_INTRO = 18;

const LIFT = 26; // title rising to the header while the window comes up
const OUTRO = 12; // everything settles back into the page
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.64, 0, 0.78, 0);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Final window rect: 75% of the frame, under a one-line header.
const WIN = { left: 240, top: 214, width: 1440, height: 810 };
const TITLE_SIZE = 108;
const HEADER_SCALE = 0.56;
const HEADER_Y = 112;

type Reveal = "blur" | "spring" | "track";
type CaptionReveal = "words" | "decode";

/** Rendered width of the caption, so the title can slide aside for it instead of jumping. */
function captionWidth(text: string, fontSize: number, family: string, weight: number): number {
  if (typeof document === "undefined") return text.length * fontSize * 0.5;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * fontSize * 0.5;
  ctx.font = `${weight} ${fontSize}px "${family}"`;
  return ctx.measureText(text).width;
}

const Title: React.FC<{ text: string; reveal: Reveal }> = ({ text, reveal }) => {
  const common = { text, fontSize: TITLE_SIZE, fontWeight: 600, color: editor.text } as const;
  if (reveal === "spring") return <SpringScaleIn {...common} staggerDelay={4} scaleFrom={0.6} />;
  if (reveal === "track") return <TrackingIn {...common} startTracking={0.55} endTracking={-0.035} />;
  return <SoftBlurIn {...common} blur={14} />;
};

type EditorShotProps = {
  readonly clip: string;
  readonly meta: ClipMeta;
  readonly camera: CameraMove[];
  readonly title: string;
  readonly caption: string;
  readonly captionAt: number;
  readonly reveal: Reveal;
  readonly captionReveal: CaptionReveal;
};

// A title card that becomes the header of real editor footage: the title opens alone in the
// same type as the motion-graphic scenes, lifts into a one-line header, and the editor window
// rises in under it with its camera pushes and recorded cursor. The caption then joins the
// title on the same line, set in the muted second color, so it reads as one sentence.
const EditorShotInner: React.FC<EditorShotProps> = ({
  clip,
  meta,
  camera,
  title,
  caption,
  captionAt,
  reveal,
  captionReveal,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Camera and cursor run on the footage's clock, which starts when the window does.
  const footageFrame = frame - EDITOR_INTRO;
  const pose = cameraPoseAt(footageFrame, camera);
  const tx = (0.5 - clampFocus(pose.x, pose.zoom) * pose.zoom) * 100;
  const ty = (0.5 - clampFocus(pose.y, pose.zoom) * pose.zoom) * 100;

  const captionFrom = EDITOR_INTRO + captionAt;
  const captionSize = TITLE_SIZE * 0.92;
  const captionGap = TITLE_SIZE * 0.28;
  const captionFull =
    captionReveal === "decode"
      ? captionWidth(caption, captionSize, dmMono, 500) - caption.length * 0.01 * captionSize
      : captionWidth(caption, captionSize, dmSans, 500) - caption.length * 0.03 * captionSize;

  const exitStart = durationInFrames - OUTRO;

  return (
    <AbsoluteFill style={{ backgroundColor: editor.page, perspective: 2200 }}>
      <AbsoluteFill
        style={{
          opacity: interpolate(frame, [exitStart, durationInFrames], [1, 0], { ...clamp, easing: EASE_IN }),
          scale: interpolate(frame, [exitStart, durationInFrames], [1, 0.965], { ...clamp, easing: EASE_IN }),
          filter: `blur(${interpolate(frame, [exitStart, durationInFrames], [0, 10], { ...clamp, easing: EASE_IN })}px)`,
        }}
      >
        {/* A low accent glow that comes up with the window and drifts while it plays. */}
        <div
          style={{
            position: "absolute",
            left: WIN.left - 160,
            top: WIN.top + 120,
            width: WIN.width + 320,
            height: WIN.height,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${editor.accentFill}40, transparent)`,
            filter: "blur(60px)",
            opacity: interpolate(frame, [EDITOR_INTRO, EDITOR_INTRO + 40], [0, 1], clamp),
            translate: interpolate(frame, [0, durationInFrames], ["-60px 0px", "60px 0px"], clamp),
          }}
        />

        <Interactive.Div
          name="Window"
          style={{
            position: "absolute",
            left: WIN.left,
            top: WIN.top,
            width: WIN.width,
            height: WIN.height,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: editor.window,
            boxShadow: "0 0 0 1px #ffffff1a, 0 50px 140px #000000cc",
            transformOrigin: "50% 0%",
            opacity: interpolate(frame, [EDITOR_INTRO - 2, EDITOR_INTRO + 12], [0, 1], clamp),
            translate: interpolate(frame, [EDITOR_INTRO - 2, EDITOR_INTRO + LIFT + 4], ["0px 320px", "0px 0px"], {
              ...clamp,
              easing: EASE_OUT,
            }),
            rotate: interpolate(frame, [EDITOR_INTRO - 2, EDITOR_INTRO + LIFT + 8], ["1 0 0 16deg", "1 0 0 0deg"], {
              ...clamp,
              easing: EASE_OUT,
            }),
            scale: interpolate(frame, [EDITOR_INTRO - 2, EDITOR_INTRO + LIFT + 8], [0.9, 1], {
              ...clamp,
              easing: EASE_OUT,
              output: "perceptual-scale",
            }),
            filter: `blur(${interpolate(frame, [EDITOR_INTRO - 2, EDITOR_INTRO + 16], [12, 0], clamp)}px)`,
          }}
        >
          <Sequence name="Footage" from={EDITOR_INTRO} premountFor={fps}>
            <ScreenRecording
              src={staticFile(`clips/${clip}.mp4`)}
              sourceAspect={16 / 9}
              camera={camera}
              entrance="none"
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
              {/* CursorTrack places itself in full-frame pixels; the window is 0.75 of the frame. */}
              <div style={{ position: "absolute", width: 1920, height: 1080, scale: "0.75", transformOrigin: "0 0" }}>
                <CursorTrack path={cursorPath(meta)} mode="dark" ringColor={accent} />
              </div>
            </div>
          </Sequence>
        </Interactive.Div>

        <Interactive.Div
          name="Header"
          style={{
            position: "absolute",
            left: 0,
            top: 460,
            width: 1920,
            height: 160,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            whiteSpace: "nowrap",
            translate: interpolate(frame, [EDITOR_INTRO, EDITOR_INTRO + LIFT], ["0px 0px", `0px ${HEADER_Y - 540}px`], {
              ...clamp,
              easing: EASE_OUT,
            }),
            scale: interpolate(frame, [EDITOR_INTRO, EDITOR_INTRO + LIFT], [1, HEADER_SCALE], {
              ...clamp,
              easing: EASE_OUT,
              output: "perceptual-scale",
            }),
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <Title text={title} reveal={reveal} />
            {/* Grows to the caption's width so the title glides aside rather than jumping. */}
            <div
              style={{
                width: interpolate(frame, [captionFrom, captionFrom + 16], [0, captionGap + captionFull], {
                  ...clamp,
                  easing: EASE_OUT,
                }),
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Sequence name="Caption" from={captionFrom} layout="none">
                {captionReveal === "decode" ? (
                  <MatrixDecode
                    text={caption}
                    fontSize={captionSize}
                    fontWeight={500}
                    letterSpacing="-0.01em"
                    color={editor.accent}
                    scrambleColor={editor.muted}
                    revealDuration={20}
                    charset="{}[]()<>;:=+-*/#$_"
                    style={{ opacity: interpolate(frame, [captionFrom, captionFrom + 4], [0, 1], clamp) }}
                  />
                ) : (
                  <BlurOutUp
                    text={caption}
                    exit={false}
                    staggerDelay={2}
                    fontSize={captionSize}
                    fontWeight={500}
                    color={editor.muted}
                  />
                )}
              </Sequence>
            </div>
          </div>
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const editorShotSchema = {
  clip: { type: "string", default: "play", description: "Clip name in public/clips" },
  title: { type: "string", default: "Press Play.", description: "Title; opens full size, then becomes the header" },
  caption: { type: "string", default: "", description: "Joins the title on the header line" },
  captionAt: { type: "number", default: 20, description: "Caption entrance, in footage frames", hiddenFromList: false },
  reveal: {
    type: "enum",
    default: "blur",
    description: "Title entrance",
    variants: { blur: {}, spring: {}, track: {} },
  },
  captionReveal: {
    type: "enum",
    default: "words",
    description: "Caption entrance",
    variants: { words: {}, decode: {} },
  },
} as const satisfies InteractivitySchema;

export const EditorShot = Interactive.withSchema({
  Component: EditorShotInner,
  componentName: "EditorShot",
  schema: editorShotSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
