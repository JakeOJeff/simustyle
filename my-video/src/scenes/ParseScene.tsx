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

// The landing page's Player.simu example: what you type, and what Parse makes of it.
const lines = [
  { indent: 0, typed: "when game begin", fixed: "when game starts", tag: "typo" },
  { indent: 1, typed: "colour me crimson", fixed: "paint me red", tag: "AI" },
  { indent: 1, typed: "wiat 2 secs", fixed: "wait 2 seconds", tag: "typo" },
  { indent: 0, typed: "when spce is presed", fixed: "when space is pressed", tag: "typo" },
  { indent: 1, typed: "make me jump up kinda high", fixed: "push me up 5", tag: "AI" },
  { indent: 0, typed: "when i bump into the coin", fixed: "when I touch Coin", tag: "AI" },
  {
    indent: 1,
    typed: "the coin should go somewhere random",
    fixed: "move Coin to random -4 to 4, 0.5, random -4 to 4",
    tag: "AI",
  },
  { indent: 1, typed: "give me a point", fixed: "change score by 1", tag: "AI" },
];

type ParseProps = {
  readonly eyebrow: string;
  readonly title: string;
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: 22,
  border: `1px solid ${colors.lineStrong}`,
  backgroundColor: colors.card,
  boxShadow: "0 40px 100px #00000080",
  overflow: "hidden",
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "20px 32px",
  borderBottom: `1px solid ${colors.line}`,
  fontFamily: sans,
  fontSize: 24,
  color: colors.text3,
};

const ParseInner: React.FC<ParseProps> = ({ eyebrow, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
          paddingTop: 80,
          gap: 60,
        }}
      >
        <SceneHeading eyebrow={eyebrow} title={title} />
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Interactive.Div
            name="You write"
            style={{
              ...cardStyle,
              width: 660,
              opacity: interpolate(frame, [0.4 * fps, 0.9 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              translate: interpolate(frame, [0.4 * fps, 1.2 * fps], ["-60px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={cardHeaderStyle}>
              <span>You write</span>
              <span style={{ fontFamily: mono }}>Player.simu</span>
            </div>
            <div style={{ padding: "26px 32px", fontFamily: mono, fontSize: 24, lineHeight: "54px" }}>
              {lines.map((line, i) => (
                <div
                  key={line.typed}
                  style={{
                    paddingLeft: line.indent * 34,
                    color: colors.text2,
                    opacity: interpolate(frame, [(0.8 + i * 0.18) * fps, (1.1 + i * 0.18) * fps], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    }),
                  }}
                >
                  {line.typed}
                </div>
              ))}
            </div>
          </Interactive.Div>

          <Interactive.Div
            name="Parse button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 22px",
              borderRadius: 14,
              backgroundColor: colors.accentFill,
              color: "white",
              fontFamily: sans,
              fontSize: 26,
              fontWeight: 600,
              boxShadow: `0 0 60px ${colors.accentFill}aa`,
              opacity: interpolate(frame, [2.4 * fps, 2.7 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(frame, [2.4 * fps, 2.9 * fps, 3.1 * fps, 3.3 * fps], [0.5, 1, 0.9, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                output: "perceptual-scale",
              }),
            }}
          >
            ✦ Parse
          </Interactive.Div>

          <Interactive.Div
            name="SimuStyle runs"
            style={{
              ...cardStyle,
              width: 900,
              border: `1px solid ${colors.accent}44`,
              opacity: interpolate(frame, [3.0 * fps, 3.5 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              translate: interpolate(frame, [3.0 * fps, 3.8 * fps], ["60px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={cardHeaderStyle}>
              <span>SimuStyle runs</span>
              <span
                style={{
                  color: colors.green,
                  fontWeight: 600,
                  opacity: interpolate(frame, [5.3 * fps, 5.6 * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                ✓ 8 of 8 lines valid
              </span>
            </div>
            <div style={{ padding: "26px 32px", fontFamily: mono, fontSize: 24, lineHeight: "54px" }}>
              {lines.map((line, i) => (
                <div
                  key={line.fixed}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 20,
                    paddingLeft: line.indent * 34,
                    opacity: interpolate(frame, [(3.4 + i * 0.22) * fps, (3.7 + i * 0.22) * fps], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    }),
                    translate: interpolate(
                      frame,
                      [(3.4 + i * 0.22) * fps, (3.9 + i * 0.22) * fps],
                      ["20px 0px", "0px 0px"],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      },
                    ),
                  }}
                >
                  <span style={{ color: colors.text, whiteSpace: "nowrap" }}>{line.fixed}</span>
                  <span
                    style={{
                      flexShrink: 0,
                      padding: "0 12px",
                      lineHeight: "34px",
                      borderRadius: 8,
                      fontFamily: sans,
                      fontSize: 20,
                      fontWeight: 600,
                      color: line.tag === "AI" ? colors.accent : colors.amber,
                      backgroundColor: line.tag === "AI" ? `${colors.accentFill}2a` : `${colors.amber}1f`,
                    }}
                  >
                    {line.tag}
                  </span>
                </div>
              ))}
            </div>
          </Interactive.Div>
        </div>
      </div>
    </>
  );
};

const parseSchema = {
  eyebrow: { type: "string", default: "✦ AI Parse", description: "Eyebrow" },
  title: {
    type: "string",
    default: "Type it how you'd say it. SimuStyle makes it run.",
    description: "Title",
  },
} as const satisfies InteractivitySchema;

export const ParseScene = Interactive.withSchema({
  Component: ParseInner,
  componentName: "ParseScene",
  schema: parseSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
