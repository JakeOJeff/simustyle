import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { FONTS } from "@/lib/snap-cn-ui";
import { accent } from "../brand";

type EndCardProps = {
  readonly wordmark: string;
  readonly url: string;
  readonly note: string;
};

const EndCardInner: React.FC<EndCardProps> = ({ wordmark, url, note }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0b",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONTS.Inter,
      }}
    >
      <Interactive.Div
        name="Wordmark"
        style={{
          display: "flex",
          alignItems: "baseline",
          color: "#fafafa",
          fontSize: 168,
          fontWeight: 600,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          scale: interpolate(frame, [0, 0.8 * fps], [1.08, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          filter: `blur(${interpolate(frame, [0, 0.4 * fps], [12, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px)`,
          opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {wordmark}
        <span
          style={{
            display: "inline-block",
            width: 34,
            height: 34,
            marginLeft: 10,
            borderRadius: 17,
            background: `linear-gradient(180deg, ${accent}, #7c6cf0)`,
          }}
        />
      </Interactive.Div>
      <Interactive.Div
        name="URL"
        style={{
          marginTop: 44,
          color: "#fafafa",
          fontSize: 38,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          opacity: interpolate(frame, [0.5 * fps, 0.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.5 * fps, 1.1 * fps], ["0px 14px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {url}
      </Interactive.Div>
      <Interactive.Div
        name="Note"
        style={{
          marginTop: 16,
          color: "#a1a1aa",
          fontSize: 28,
          fontWeight: 400,
          opacity: interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {note}
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const endCardSchema = {
  wordmark: { type: "string", default: "simustyle", description: "Wordmark" },
  url: { type: "string", default: "simustyle.curiousengine.org", description: "Website" },
  note: { type: "string", default: "Free forever · No account needed", description: "Fine print" },
} as const satisfies InteractivitySchema;

export const EndCardScene = Interactive.withSchema({
  Component: EndCardInner,
  componentName: "EndCardScene",
  schema: endCardSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
