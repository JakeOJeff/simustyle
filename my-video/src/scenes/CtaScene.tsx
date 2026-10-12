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

type CtaProps = {
  readonly headline: string;
  readonly url: string;
};

const CtaInner: React.FC<CtaProps> = ({ headline, url }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Backdrop />
      <Interactive.Div
        name="Call to action"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          fontFamily: sans,
        }}
      >
        <CanvasImage
          name="Logo"
          src={staticFile("logo.png")}
          premountFor={fps}
          style={{
            width: 150,
            height: 150,
            borderRadius: 34,
            boxShadow: `0 20px 90px ${colors.accentFill}66`,
            scale: interpolate(frame, [0, 0.7 * fps], [0.6, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 14 }),
              output: "perceptual-scale",
            }),
            opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
        <Interactive.Div
          name="Headline"
          style={{
            color: colors.text,
            fontSize: 110,
            fontWeight: 700,
            letterSpacing: -4,
            lineHeight: 1,
            opacity: interpolate(frame, [0.3 * fps, 0.8 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.3 * fps, 1.1 * fps], ["0px 40px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {headline}
        </Interactive.Div>
        <Interactive.Div
          name="Buttons"
          style={{
            display: "flex",
            gap: 24,
            fontSize: 34,
            fontWeight: 600,
            opacity: interpolate(frame, [0.8 * fps, 1.3 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.8 * fps, 1.6 * fps], ["0px 30px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <div
            style={{
              padding: "22px 40px",
              borderRadius: 16,
              backgroundColor: colors.accentFill,
              color: "white",
              boxShadow: `0 0 60px ${colors.accentFill}88`,
            }}
          >
            Open in browser
          </div>
          <div
            style={{
              padding: "22px 40px",
              borderRadius: 16,
              border: `1px solid ${colors.lineStrong}`,
              backgroundColor: colors.card,
              color: colors.text,
            }}
          >
            Download for Windows
          </div>
        </Interactive.Div>
        <Interactive.Div
          name="Fine print"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            opacity: interpolate(frame, [1.4 * fps, 1.9 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <div style={{ color: colors.accent, fontFamily: mono, fontSize: 38 }}>{url}</div>
          <div style={{ color: colors.text3, fontSize: 28 }}>Free forever · No account needed</div>
        </Interactive.Div>
      </Interactive.Div>
    </>
  );
};

const ctaSchema = {
  headline: { type: "string", default: "Build your first world today.", description: "Headline" },
  url: { type: "string", default: "simustyle.curiousengine.org", description: "Website" },
} as const satisfies InteractivitySchema;

export const CtaScene = Interactive.withSchema({
  Component: CtaInner,
  componentName: "CtaScene",
  schema: ctaSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
