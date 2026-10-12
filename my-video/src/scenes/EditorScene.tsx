import {
  CanvasImage,
  Easing,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { Backdrop } from "../Backdrop";
import { colors, mono, sans } from "../theme";

// editor.png is 1600x960; it is shown at SHOT_WIDTH, so boxes are scaled from source pixels.
const SHOT_WIDTH = 1100;
const k = SHOT_WIDTH / 1600;

const features = [
  {
    title: "Scene editor",
    body: "Viewport, hierarchy, and inspector.",
    box: { x: 8, y: 52, w: 426, h: 840 },
  },
  {
    title: "Real physics",
    body: "Rigid bodies and collisions by Rapier.",
    box: { x: 1176, y: 262, w: 404, h: 38 },
  },
  {
    title: "Keyframe animation",
    body: "Timeline, easing curves, one-click presets.",
    box: { x: 1254, y: 6, w: 236, h: 34 },
  },
  {
    title: "Export anywhere",
    body: "GLB model, standalone HTML, or WebM video.",
    box: { x: 1510, y: 6, w: 82, h: 34 },
  },
];

type EditorProps = {
  readonly eyebrow: string;
  readonly title: string;
};

const EditorInner: React.FC<EditorProps> = ({ eyebrow, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Backdrop />
      <Interactive.Div
        name="Copy"
        style={{
          position: "absolute",
          left: 100,
          top: 0,
          bottom: 0,
          width: 580,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 26,
          fontFamily: sans,
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0, 0.7 * fps], ["-40px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div style={{ color: colors.accent, fontSize: 26, fontWeight: 600, letterSpacing: 1 }}>
          {eyebrow}
        </div>
        <div
          style={{
            color: colors.text,
            fontSize: 66,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1.05,
            marginBottom: 20,
          }}
        >
          {title}
        </div>
        {features.map((feature, i) => (
          <div
            key={feature.title}
            style={{
              display: "flex",
              gap: 20,
              alignItems: "flex-start",
              opacity: interpolate(frame, [(1 + i) * fps, (1.3 + i) * fps], [0.25, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              translate: interpolate(frame, [(1 + i) * fps, (1.5 + i) * fps], ["20px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 46,
                height: 46,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${colors.accentFill}33`,
                color: colors.accent,
                fontFamily: mono,
                fontSize: 22,
              }}
            >
              {i + 1}
            </div>
            <div>
              <div style={{ color: colors.text, fontSize: 32, fontWeight: 600 }}>{feature.title}</div>
              <div style={{ color: colors.text2, fontSize: 25, marginTop: 4 }}>{feature.body}</div>
            </div>
          </div>
        ))}
      </Interactive.Div>

      <Interactive.Div
        name="Editor window"
        style={{
          position: "absolute",
          left: 730,
          top: 180,
          width: SHOT_WIDTH,
          borderRadius: 18,
          border: `1px solid ${colors.lineStrong}`,
          backgroundColor: colors.bgRaised,
          boxShadow: `0 50px 140px #000000aa, 0 0 120px ${colors.accentFill}33`,
          overflow: "hidden",
          opacity: interpolate(frame, [0.2 * fps, 0.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.2 * fps, 1.2 * fps], ["80px 30px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0.2 * fps, 7 * fps], [0.96, 1.02], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 52,
            padding: "0 20px",
            borderBottom: `1px solid ${colors.line}`,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#ff5f57" }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#febc2e" }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#28c840" }} />
          <div
            style={{
              marginLeft: 20,
              padding: "6px 18px",
              borderRadius: 8,
              backgroundColor: colors.bg,
              color: colors.text3,
              fontFamily: mono,
              fontSize: 18,
            }}
          >
            simustyle.curiousengine.org/editor
          </div>
        </div>
        <div style={{ position: "relative", width: SHOT_WIDTH, height: 960 * k }}>
          <CanvasImage
            name="Editor screenshot"
            src={staticFile("editor.png")}
            premountFor={fps}
            style={{ width: SHOT_WIDTH, height: 960 * k }}
          />
          {features.map((feature, i) => (
            <div
              key={feature.title}
              style={{
                position: "absolute",
                left: feature.box.x * k - 6,
                top: feature.box.y * k - 6,
                width: feature.box.w * k + 12,
                height: feature.box.h * k + 12,
                borderRadius: 10,
                border: `3px solid ${colors.accent}`,
                boxShadow: `0 0 0 4000px #0e0e1166, 0 0 30px ${colors.accent}`,
                opacity: interpolate(
                  frame,
                  [(1 + i) * fps, (1.25 + i) * fps, (1.8 + i) * fps, (2 + i) * fps],
                  [0, 1, 1, 0],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                ),
              }}
            />
          ))}
        </div>
      </Interactive.Div>
    </>
  );
};

const editorSchema = {
  eyebrow: { type: "string", default: "Everything in one editor", description: "Eyebrow" },
  title: { type: "string", default: "From empty scene to playable demo.", description: "Title" },
} as const satisfies InteractivitySchema;

export const EditorScene = Interactive.withSchema({
  Component: EditorInner,
  componentName: "EditorScene",
  schema: editorSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
