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

const code = [
  { indent: 0, text: "when game starts" },
  { indent: 1, text: "set score to 0" },
  { indent: 1, text: "paint blue" },
  { indent: 1, text: "forever" },
  { indent: 2, text: "if key left is pressed" },
  { indent: 3, text: "move left 0.1" },
  { indent: 0, text: "when I touch a coin" },
  { indent: 1, text: "destroy it" },
  { indent: 1, text: "change score by 1" },
  { indent: 1, text: 'say "Coins:" score' },
];

const keywords = new Set(["when", "forever", "if", "set", "change", "paint", "move", "destroy", "say"]);

const tokenColor = (token: string) => {
  if (keywords.has(token)) return colors.accent;
  if (token.startsWith('"')) return colors.green;
  if (/^[\d.]+$/.test(token)) return colors.amber;
  return colors.text;
};

const coinXs = [380, 260, 140];

type ScriptProps = {
  readonly eyebrow: string;
  readonly title: string;
};

const ScriptInner: React.FC<ScriptProps> = ({ eyebrow, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The player slides left through the coins once the script is on screen.
  const playerX = interpolate(frame, [2.2 * fps, 4.4 * fps], [480, 40], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const score = coinXs.filter((x) => playerX <= x + 10).length;

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
          paddingTop: 100,
          gap: 60,
        }}
      >
        <SceneHeading
          eyebrow={eyebrow}
          title={title}
          subtitle="Respond to clicks, keys, and collisions. It reads like instructions to a friend."
        />
        <div style={{ display: "flex", gap: 40, alignItems: "stretch" }}>
          <Interactive.Div
            name="Script card"
            style={{
              width: 700,
              padding: "28px 36px",
              borderRadius: 22,
              border: `1px solid ${colors.lineStrong}`,
              backgroundColor: colors.card,
              boxShadow: "0 40px 100px #00000080",
              fontFamily: mono,
              fontSize: 28,
              lineHeight: "46px",
              opacity: interpolate(frame, [0.3 * fps, 0.8 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              translate: interpolate(frame, [0.3 * fps, 1.1 * fps], ["0px 50px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ fontFamily: sans, fontSize: 22, color: colors.text3, marginBottom: 10 }}>
              Player.simu
            </div>
            {code.map((line, i) => (
              <div
                key={line.text}
                style={{
                  paddingLeft: line.indent * 36,
                  opacity: interpolate(frame, [(0.7 + i * 0.12) * fps, (0.95 + i * 0.12) * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                {line.text.split(/( )/).map((token, j) => (
                  <span key={j} style={{ color: tokenColor(token) }}>
                    {token}
                  </span>
                ))}
              </div>
            ))}
          </Interactive.Div>

          <Interactive.Div
            name="Preview card"
            style={{
              position: "relative",
              width: 600,
              borderRadius: 22,
              border: `1px solid ${colors.accent}44`,
              backgroundColor: colors.bgRaised,
              boxShadow: "0 40px 100px #00000080",
              overflow: "hidden",
              opacity: interpolate(frame, [0.9 * fps, 1.4 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              translate: interpolate(frame, [0.9 * fps, 1.7 * fps], ["0px 50px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 24,
                left: 28,
                fontFamily: sans,
                fontSize: 22,
                color: colors.text3,
              }}
            >
              ▶ Playing
            </div>
            <div
              style={{
                position: "absolute",
                top: 18,
                right: 24,
                padding: "6px 16px",
                borderRadius: 10,
                backgroundColor: colors.card,
                border: `1px solid ${colors.lineStrong}`,
                fontFamily: mono,
                fontSize: 24,
                color: colors.text,
              }}
            >
              Coins: <span style={{ color: colors.amber }}>{score}</span>
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 330,
                height: 2,
                backgroundColor: colors.lineStrong,
              }}
            />
            {coinXs.map((x) => (
              <div
                key={x}
                style={{
                  position: "absolute",
                  left: x + 20,
                  top: 262,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.amber,
                  boxShadow: `0 0 24px ${colors.amber}88`,
                  opacity: playerX <= x + 10 ? 0 : 1,
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: playerX,
                top: 250,
                width: 80,
                height: 80,
                borderRadius: 14,
                backgroundColor: "#4f7cff",
                boxShadow: "0 0 40px #4f7cff88",
              }}
            />
          </Interactive.Div>
        </div>
      </div>
    </>
  );
};

const scriptSchema = {
  eyebrow: { type: "string", default: "Scripting", description: "Eyebrow" },
  title: { type: "string", default: "Logic you can read out loud.", description: "Title" },
} as const satisfies InteractivitySchema;

export const ScriptScene = Interactive.withSchema({
  Component: ScriptInner,
  componentName: "ScriptScene",
  schema: scriptSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
