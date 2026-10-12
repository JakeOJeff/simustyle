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
import { colors, sans } from "../theme";

type IntroProps = {
  readonly tagline: string;
};

const IntroInner: React.FC<IntroProps> = ({ tagline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Backdrop />
      <Interactive.Div
        name="Lockup"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          fontFamily: sans,
          color: colors.text,
        }}
      >
        <CanvasImage
          name="Logo"
          src={staticFile("logo.png")}
          premountFor={fps}
          style={{
            width: 220,
            height: 220,
            borderRadius: 48,
            scale: interpolate(frame, [0, 0.9 * fps], [0.4, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 12 }),
              output: "perceptual-scale",
            }),
            rotate: interpolate(frame, [0, 0.9 * fps], ["-90deg", "0deg"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            boxShadow: `0 30px 120px ${colors.accentFill}66`,
          }}
        />
        <Interactive.Div
          name="Wordmark"
          style={{
            fontSize: 150,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 1,
            opacity: interpolate(frame, [0.5 * fps, 1.1 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.5 * fps, 1.3 * fps], ["0px 40px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          SimuStyle
        </Interactive.Div>
        <Interactive.Div
          name="Tagline"
          style={{
            fontSize: 46,
            fontWeight: 500,
            color: colors.text2,
            opacity: interpolate(frame, [1.1 * fps, 1.7 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [1.1 * fps, 1.9 * fps], ["0px 24px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {tagline}
        </Interactive.Div>
      </Interactive.Div>
    </>
  );
};

const introSchema = {
  tagline: {
    type: "string",
    default: "Plain-English 3D worlds, powered by AI",
    description: "Tagline",
  },
} as const satisfies InteractivitySchema;

export const IntroScene = Interactive.withSchema({
  Component: IntroInner,
  componentName: "IntroScene",
  schema: introSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
