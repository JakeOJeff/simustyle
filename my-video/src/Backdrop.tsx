import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors } from "./theme";

// Dark canvas with a faint grid and a slowly drifting purple glow.
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${colors.line} 1px, transparent 1px), linear-gradient(90deg, ${colors.line} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 20%, transparent 80%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          left: 410,
          top: -10,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colors.accentFill}40 0%, transparent 65%)`,
          translate: interpolate(frame, [0, 300], ["-120px -60px", "120px 60px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
    </AbsoluteFill>
  );
};
