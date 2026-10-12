import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, sans } from "./theme";

type SceneHeadingProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle?: string;
};

// Eyebrow, title and optional subtitle used at the top of each feature scene.
export const SceneHeading: React.FC<SceneHeadingProps> = ({ eyebrow, title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Interactive.Div
      name="Heading"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        textAlign: "center",
        fontFamily: sans,
        opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: interpolate(frame, [0, 0.7 * fps], ["0px 30px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      <div
        style={{
          padding: "8px 20px",
          borderRadius: 999,
          border: `1px solid ${colors.accent}55`,
          backgroundColor: `${colors.accentFill}22`,
          color: colors.accent,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: 1,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          color: colors.text,
          fontSize: 76,
          fontWeight: 700,
          letterSpacing: -2.5,
          lineHeight: 1.05,
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div style={{ color: colors.text2, fontSize: 32, fontWeight: 400, maxWidth: 1300 }}>
          {subtitle}
        </div>
      ) : null}
    </Interactive.Div>
  );
};
