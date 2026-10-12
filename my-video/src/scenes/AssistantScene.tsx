import {
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { Backdrop } from "../Backdrop";
import { SceneHeading } from "../SceneHeading";
import { colors, mono, sans } from "../theme";

const builtItems = [
  "⚪ Ball · physics",
  "🌀 Windmill · spins forever",
  "⛳ Hole + flag",
  "📜 Script · \"Hole in one!\"",
];

type AssistantProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly prompt: string;
};

const AssistantInner: React.FC<AssistantProps> = ({ eyebrow, title, prompt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Type the prompt out between 0.8s and 3.6s.
  const typedChars = Math.round(
    interpolate(frame, [0.8 * fps, 3.6 * fps], [0, prompt.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const cursorVisible = typedChars < prompt.length || Math.floor(frame / 15) % 2 === 0;

  return (
    <>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 110,
          gap: 64,
        }}
      >
        <SceneHeading
          eyebrow={eyebrow}
          title={title}
          subtitle="One prompt builds objects, lights, physics, and scripts, then test-runs them."
        />
        <Interactive.Div
          name="Prompt card"
          style={{
            width: 1300,
            borderRadius: 24,
            border: `1px solid ${colors.accent}44`,
            backgroundColor: colors.card,
            boxShadow: `0 40px 120px #00000080, 0 0 80px ${colors.accentFill}22`,
            overflow: "hidden",
            opacity: interpolate(frame, [0.3 * fps, 0.8 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.3 * fps, 1.1 * fps], ["0px 60px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <div
            style={{
              padding: "20px 34px",
              borderBottom: `1px solid ${colors.line}`,
              fontFamily: sans,
              fontSize: 24,
              color: colors.text3,
            }}
          >
            ✦ Assistant prompt
          </div>
          <div
            style={{
              padding: "30px 34px",
              minHeight: 200,
              fontFamily: sans,
              fontSize: 34,
              lineHeight: 1.45,
              color: colors.text,
            }}
          >
            {prompt.slice(0, typedChars)}
            <span style={{ color: colors.accent, opacity: cursorVisible ? 1 : 0 }}>▍</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 34px",
              borderTop: `1px solid ${colors.line}`,
              fontFamily: sans,
              fontSize: 24,
              opacity: interpolate(frame, [3.9 * fps, 4.3 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span style={{ color: colors.green, fontWeight: 600 }}>✓ Scene built · scripts test-run</span>
            <span
              style={{
                marginLeft: "auto",
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${colors.lineStrong}`,
                color: colors.text2,
                fontFamily: mono,
                fontSize: 20,
              }}
            >
              1 undoable edit
            </span>
          </div>
        </Interactive.Div>
        <div style={{ display: "flex", gap: 20 }}>
          {builtItems.map((item, i) => (
            <div
              key={item}
              style={{
                padding: "14px 24px",
                borderRadius: 14,
                border: `1px solid ${colors.lineStrong}`,
                backgroundColor: colors.bgRaised,
                color: colors.text,
                fontFamily: sans,
                fontSize: 26,
                fontWeight: 500,
                opacity: interpolate(frame, [(4.2 + i * 0.15) * fps, (4.5 + i * 0.15) * fps], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                scale: interpolate(frame, [(4.2 + i * 0.15) * fps, (4.7 + i * 0.15) * fps], [0.6, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.spring({ damping: 14 }),
                  output: "perceptual-scale",
                }),
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

const assistantSchema = {
  eyebrow: { type: "string", default: "Scene assistant", description: "Eyebrow" },
  title: {
    type: "string",
    default: "Describe a whole scene. Get a playable one.",
    description: "Title",
  },
  prompt: {
    type: "string",
    default:
      "Build a small mini-golf hole I can play. A white ball that rolls with physics, a windmill whose red blades spin forever, and a hole with a flag. When the ball reaches the hole, say \"Hole in one!\"",
    description: "Typed prompt",
  },
} as const satisfies InteractivitySchema;

export const AssistantScene = Interactive.withSchema({
  Component: AssistantInner,
  componentName: "AssistantScene",
  schema: assistantSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
