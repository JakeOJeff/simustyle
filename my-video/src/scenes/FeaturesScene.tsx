import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import { BlurOutUp } from "../components/remocn/blur-out-up";
import { MarkerHighlight } from "../components/remocn/marker-highlight";
import { MatrixDecode } from "../components/remocn/matrix-decode";
import { SoftBlurIn } from "../components/remocn/soft-blur-in";
import { SpringScaleIn } from "../components/remocn/spring-scale-in";
import { TrackingIn } from "../components/remocn/tracking-in";
import { dmMono, dmSans, editor } from "../brand";

type FeaturesProps = {
  readonly one: string;
  readonly oneSub: string;
  readonly two: string;
  readonly twoSub: string;
  readonly three: string;
  readonly threeSub: string;
};

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.64, 0, 0.78, 0);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const TITLE = 132;
const SUB = 64;

/** A full-frame card: centred column with a slow push for as long as it is on screen. */
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 18,
        scale: interpolate(frame, [0, durationInFrames], [1, 1.045], clamp),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** "with real physics." -> "with " + marked "real physics" + "." */
function splitMark(sub: string): [string, string, string] {
  const space = sub.indexOf(" ");
  const before = space === -1 ? "" : sub.slice(0, space + 1);
  const rest = sub.slice(before.length);
  const tail = /[.!?]$/.test(rest) ? rest.slice(-1) : "";
  return [before, rest.slice(0, rest.length - tail.length), tail];
}

// Three beats, three different moves: characters blur in under a marker sweep, words spring
// up and blow away, and the last line tracks in while its answer decodes out of noise.
const FeaturesInner: React.FC<FeaturesProps> = ({ one, oneSub, two, twoSub, three, threeSub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [before, mark, after] = splitMark(oneSub);

  return (
    <AbsoluteFill style={{ backgroundColor: editor.page, fontFamily: dmSans }}>
      <Sequence name="Sandbox" durationInFrames={48} premountFor={fps}>
        {/* Leaves by sinking back into the page. */}
        <Card
          style={{
            opacity: interpolate(frame, [38, 48], [1, 0], { ...clamp, easing: EASE_IN }),
            filter: `blur(${interpolate(frame, [38, 48], [0, 16], { ...clamp, easing: EASE_IN })}px)`,
            translate: interpolate(frame, [38, 48], ["0px 0px", "0px 40px"], { ...clamp, easing: EASE_IN }),
          }}
        >
          <SoftBlurIn text={one} fontSize={TITLE} fontWeight={600} color={editor.text} />
          <Sequence from={10} layout="none">
            <MarkerHighlight
              before={before}
              highlight={mark}
              after={after}
              delay={8}
              fontSize={SUB}
              fontWeight={500}
              baseColor={editor.muted}
              highlightedTextColor="#ffffff"
              markerColor={editor.accentFill}
              style={{
                opacity: interpolate(frame, [10, 22], [0, 1], { ...clamp, easing: EASE_OUT }),
                translate: interpolate(frame, [10, 26], ["0px 18px", "0px 0px"], { ...clamp, easing: EASE_OUT }),
              }}
            />
          </Sequence>
        </Card>
      </Sequence>

      <Sequence name="Agents" from={46} durationInFrames={48} premountFor={fps}>
        {/* Rises off the top as its subline blows away. */}
        <Card
          style={{
            opacity: interpolate(frame, [86, 94], [1, 0], { ...clamp, easing: EASE_IN }),
            translate: interpolate(frame, [82, 94], ["0px 0px", "0px -70px"], { ...clamp, easing: EASE_IN }),
            filter: `blur(${interpolate(frame, [84, 94], [0, 12], { ...clamp, easing: EASE_IN })}px)`,
          }}
        >
          <SpringScaleIn
            text={two}
            staggerDelay={4}
            scaleFrom={0.55}
            fontSize={TITLE}
            fontWeight={600}
            color={editor.text}
          />
          <Sequence from={9} layout="none">
            <BlurOutUp text={twoSub} staggerDelay={2} fontSize={SUB} fontWeight={500} color={editor.textSoft} />
          </Sequence>
        </Card>
      </Sequence>

      <Sequence name="Script" from={92} durationInFrames={48} premountFor={fps}>
        <Card
          style={{
            gap: 26,
            opacity: interpolate(frame, [134, 140], [1, 0], clamp),
          }}
        >
          <TrackingIn
            text={three}
            fontSize={120}
            fontWeight={600}
            color={editor.text}
            startTracking={0.6}
            endTracking={-0.035}
          />
          <Sequence from={12} layout="none">
            <MatrixDecode
              text={threeSub}
              fontSize={66}
              fontWeight={500}
              fontFamily={dmMono}
              letterSpacing="-0.01em"
              color={editor.accent}
              scrambleColor={editor.muted}
              revealDuration={22}
              charset="{}[]()<>;:=+-*/#$_"
              style={{
                opacity: interpolate(frame, [104, 110], [0, 1], clamp),
              }}
            />
          </Sequence>
        </Card>
      </Sequence>
    </AbsoluteFill>
  );
};

const featuresSchema = {
  one: { type: "string", default: "A 3D sandbox", description: "Card 1 title" },
  oneSub: {
    type: "string",
    default: "with real physics.",
    description: "Card 1 line; all but its first word gets the marker",
  },
  two: { type: "string", default: "AI agents", description: "Card 2 title" },
  twoSub: { type: "string", default: "that build with you.", description: "Card 2 line" },
  three: { type: "string", default: "A script language", description: "Card 3 title" },
  threeSub: { type: "string", default: "AI can fix.", description: "Card 3 line, decoded from noise" },
} as const satisfies InteractivitySchema;

export const FeaturesScene = Interactive.withSchema({
  Component: FeaturesInner,
  componentName: "FeaturesScene",
  schema: featuresSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
