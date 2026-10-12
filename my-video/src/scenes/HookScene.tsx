import {
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { Backdrop } from "../Backdrop";
import { colors, sans } from "../theme";

type HookProps = {
  readonly lineOne: string;
  readonly lineTwo: string;
};

const HookInner: React.FC<HookProps> = ({ lineOne, lineTwo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Backdrop />
      <Interactive.Div
        name="Headline"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          fontFamily: sans,
          fontSize: 140,
          fontWeight: 700,
          letterSpacing: -5,
          lineHeight: 1.05,
        }}
      >
        <Interactive.Div
          name="Line one"
          style={{
            color: colors.text,
            opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0, 0.8 * fps], ["0px 50px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {lineOne}
        </Interactive.Div>
        <Interactive.Div
          name="Line two"
          style={{
            backgroundImage: `linear-gradient(90deg, ${colors.accent}, #e3dcff, ${colors.accent})`,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            opacity: interpolate(frame, [0.7 * fps, 1.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.7 * fps, 1.5 * fps], ["0px 50px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {lineTwo}
        </Interactive.Div>
      </Interactive.Div>
    </>
  );
};

const hookSchema = {
  lineOne: { type: "string", default: "You describe it.", description: "First line" },
  lineTwo: { type: "string", default: "We make it real.", description: "Second line" },
} as const satisfies InteractivitySchema;

export const HookScene = Interactive.withSchema({
  Component: HookInner,
  componentName: "HookScene",
  schema: hookSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
