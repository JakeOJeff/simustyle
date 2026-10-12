"use client";

import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  mixOklch,
  resolveFont,
  type SnapCnTheme,
  useSnapCnTheme,
} from "@/lib/snap-cn-ui";

/**
 * A wordmark twice the width of the frame, cooling from a lit gradient to ink,
 * cut closer onto its last letters and the dot.
 *
 * Two shots and a hard cut between them. The wide one holds the front of the
 * word, rides an exponential settle up into place while the light on the type
 * cools out, and then starts drifting left — accelerating, so the cut
 * lands on a frame that is already moving. The close one is 1.71× nearer, holds
 * the *end* of the word, springs into place, waits, and pushes in. The dot never
 * cools: it is the one thing in the piece that keeps the gradient, and the close
 * shot is framed on it.
 *
 * Beat by beat, measured off the reference at 30fps:
 *
 * | beat | seconds | what moves |
 * | --- | --- | --- |
 * | settle | 0 – 0.8 | the word rises 50px, exponentially |
 * | cool | 0.36 – 1.03 | the light on the type goes to ink, linearly |
 * | drift | 0.66 – 1.20 | the word slides 21px left, accelerating |
 * | **cut** | 1.20 | 245px type → 419px type, front of the word → end of it |
 * | spring | 1.20 – 1.45 | the close shot lands, overshooting 5px |
 * | hold | 1.45 – 1.63 | nothing moves |
 * | push | 1.63 – 2.20 | 1 → 1.30, still accelerating at the last frame |
 *
 * The two shots are not one continuous move with a jump in it — the wide one is
 * *accelerating* left when it ends and the close one is *decelerating* when it
 * begins. It is the same camera on the same word, twice, and the cut is what
 * makes the second one read as closer rather than as bigger.
 *
 * The wide shot has no depth of field and the close one does — sharp in the
 * middle of the frame, six pixels of blur by the corners. That is not a mistake
 * to be tidied away: it is the only thing in the piece that says the second shot
 * is *nearer* rather than the same shot at a larger point size, and it was
 * measured, one edge at a time, before it was believed. A 't' stem 1px sharp at
 * mid-frame and 15px soft at its own ascender tip is not something a font does.
 */

const { fontFamily: SANS } = loadSans("normal", {
  weights: ["500"],
  subsets: ["latin"],
});

/* ─────────────────────────────────────────────────────────────────────────
   Geometry, in the reference's own 712×398 pixels
   ───────────────────────────────────────────────────────────────────────── */

export const REF_W = 712;
export const REF_H = 398;

/** When the wide shot becomes the close one. */
export const CUT = 1.2;

/**
 * The two framings.
 *
 * `size` is a point size and `baseline` is where the baseline sits, both in
 * reference px. The wide shot anchors the word's **left** edge 42px off the
 * frame — its first letter is cut, which is what makes the type read as bigger
 * than the frame rather than merely large. The close shot anchors the **dot**,
 * because the dot is what it is framed on and because anchoring the right-hand
 * end is the only way to place a line of unknown width without measuring it.
 *
 * 419 / 245 = 1.71, read off the stem widths: 25.5px of stem in the wide shot
 * and 41 in the close one. Cap heights would have been easier and are not
 * available — the wide shot's baseline is 10px below the bottom of the frame.
 */
export const WIDE = { size: 245, inkTop: 224, left: -42 };
export const CLOSE = { size: 419, dot: { x: 418.5, y: 259.2 } };

/**
 * How tall the word's ink is, as a fraction of the point size — and therefore
 * how far the point size has to open up.
 *
 * The reference's word is "Product.": a cap, two ascenders, letters that reach
 * 0.75em above the baseline. A wordmark that is all x-height reaches 0.546em,
 * and set at the same point size it sits in the frame like a caption. So the
 * *ink* is what the two framings are measured against and the point size follows
 * from it — which is what a designer does when the word changes, and the only
 * rule that survives not knowing the word.
 *
 * At 0.75 this returns the reference's own 245 and 419 unchanged.
 */
export function inkRatio(word: string): number {
  // 0.556, not the 0.546 x-height: round lowercase overshoots it by 0.01em, and
  // three pixels of overshoot is three pixels of framing.
  return /[A-Z0-9bdfhiklt]/.test(word) ? 0.75 : 0.556;
}

export function sizeFor(shot: "wide" | "close"): number {
  return shot === "wide" ? WIDE.size : CLOSE.size;
}

/**
 * Where each shot puts the baseline, in reference px.
 *
 * Neither shot has a fixed one, and they are anchored on opposite things. The
 * wide shot is framed on the **top of the ink** — 224, a little over half way
 * down — so a word with no ascenders sits where "Product."'s cap sits rather
 * than 50px lower, floating in the page. The close shot is framed on the
 * **dot**, because that is what it is a shot of; the baseline is then wherever
 * the dot's own radius puts it.
 *
 * For "Product." both come out at the reference's own numbers, 408 and 308.
 */
export function baselineFor(shot: "wide" | "close", word: string): number {
  return shot === "wide"
    ? WIDE.inkTop + inkRatio(word) * WIDE.size
    : CLOSE.dot.y + (DOT.size * CLOSE.size) / 2;
}

/**
 * The dot, as a fraction of the point size.
 *
 * 0.234em — two and a half times a real period, and round rather than square.
 * It sits *on* the baseline (centre one radius above it) and follows the word
 * after a 0.06em gap.
 */
export const DOT = { size: 0.2348, gap: 0.06 };

/**
 * Where the baseline sits inside a `line-height: 1` box, as a fraction of the
 * point size.
 *
 * Inter's ascent and descent are 0.9688 and 0.2422, so a 1em line box carries
 * half-leading of −0.1055em and puts the baseline 0.8633em down. Everything here
 * is positioned from a baseline, because that is the only line in a piece of
 * type that a camera can be aimed at.
 */
export const BASELINE_IN_BOX = 0.8633;

/* ─────────────────────────────────────────────────────────────────────────
   Curves — every number below was read off the reference's own frames
   ───────────────────────────────────────────────────────────────────────── */

function knots(
  ts: readonly number[],
  vs: readonly number[],
  t: number,
): number {
  return interpolate(t, ts as number[], vs as number[], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * The wide shot's rise, in reference px.
 *
 * Read off the top row of ink: 274 down to 224 and then nothing. It is very
 * nearly `50·exp(−t/0.19)` and it is knots anyway, because the first tenth of a
 * second decays faster than the rest and a single exponential is 6px wrong
 * there — which on a settle this small is an eighth of the whole move.
 *
 * 50px is where the reference *was* when the capture starts, not where its
 * entrance began; that happened about 0.2s earlier, off the front of the clip.
 * Extrapolating the exponential backwards would put the word 140px low at t=0,
 * and inventing 90px of entrance nobody has seen is not matching a reference.
 */
export const RISE_T = [0, 0.058, 0.158, 0.258, 0.392, 0.525, 0.825, 1.2];
export const RISE_V = [50, 31, 20, 13, 7, 3, 0, 0];

export function rise(t: number): number {
  return knots(RISE_T, RISE_V, t);
}

/**
 * The wide shot's drift, in reference px.
 *
 * Zero until 0.66 and then a `^3.08` ease-in that has covered 21px by the last
 * frame the recording caught and 27 by the cut — an acceleration, not a slide,
 * so the fastest frame of it is the one the cut takes. Fitted rather than
 * knotted: the power law is inside 2px of all sixteen measured frames, and a
 * curve whose whole job is to be still accelerating when it is interrupted is
 * better written as the thing it is than as a table that stops.
 *
 * The span runs to the cut, not to the end of the measurements. Ending it at
 * 1.16 froze the drift for the last frame before the cut, which is the one frame
 * it must not be still on.
 */
export const DRIFT = {
  start: 0.66,
  span: CUT - 0.66,
  distance: 26.8,
  power: 3.08,
};

export function drift(t: number): number {
  const u = Math.min(1, Math.max(0, (t - DRIFT.start) / DRIFT.span));
  return -DRIFT.distance * u ** DRIFT.power;
}

/**
 * How much light is left on the type, 0…1.
 *
 * Held at 0.455 for a third of a second and then straight down to nothing by
 * 1.03 — measured as the red channel of the glyph cores, which is a clean
 * readout because the gradient holds R at 255 across its whole length and only
 * G moves. So R/255 *is* the strength, at any point along the word.
 *
 * It never reaches full strength inside the clip. Like the rise, the reference
 * is already partway through this beat when the capture starts.
 */
export const WARM_T = [0, 0.358, 0.458, 0.592, 0.858, 1.017, 1.025, 1.2];
export const WARM_V = [0.455, 0.451, 0.404, 0.314, 0.106, 0.016, 0, 0];

export function warmth(t: number): number {
  return knots(WARM_T, WARM_V, t);
}

/**
 * The close shot, tracked on the dot — the one object in it with an edge on
 * every side and a colour nothing else shares.
 *
 * Its area gives the scale to a hundredth of a percent (a 98px disc is 7,600
 * pixels; a centroid on that many is worth a fiftieth of a pixel), which is why
 * the push below is knots off a measurement rather than a spring anybody tuned.
 *
 * Times are from the cut, not from the start of the piece.
 */
export const B_T = [0, 0.333, 0.533, 0.708, 0.808, 0.875, 0.933, 0.967, 1];
export const B_SCALE = [
  0.9995, 0.9989, 1.0159, 1.0556, 1.0986, 1.1398, 1.1994, 1.2402, 1.2971,
];
export const B_DX_T = [0, 0.133, 0.3, 0.775, 0.967, 1];
export const B_DX = [6.46, 1.96, 0.12, -1.43, -4.08, -5.07];
/**
 * The vertical is the one axis with an overshoot in it: down 18px, 5px past the
 * mark, and back. The horizontal has none. Two different settles on one object
 * is not something to average out — it is what stops the landing reading as a
 * slide.
 */
export const B_DY_T = [
  0, 0.108, 0.133, 0.2, 0.267, 0.433, 0.533, 0.775, 0.933, 1,
];
export const B_DY = [
  13.83, 2.7, -1.09, -4.48, -4.53, -0.32, -0.35, -3.27, -5.13, -7.03,
];

export function closeScale(t: number): number {
  return knots(B_T, B_SCALE, Math.max(0, t - CUT));
}
export function closeOffset(t: number): { x: number; y: number } {
  const u = Math.max(0, t - CUT);
  return { x: knots(B_DX_T, B_DX, u), y: knots(B_DY_T, B_DY, u) };
}

/**
 * The close shot's depth of field.
 *
 * Sharp out to about 170px from the middle of the frame and fully soft by 215,
 * with a σ of 6. Measured as the 10–90 width of a glyph edge against its
 * distance from the centre: 1px at 92, 3px at 124, 3px at 165, 7px at 192,
 * 15px at 205 and 16px at 310. It is a late, steep falloff — a wide aperture,
 * not a vignette — and guessing 120 → 230 for it left the letter next to the dot
 * eight pixels soft where the reference has one.
 *
 * The wide shot has none of it, at every edge it has, which is the check that
 * this is a lens and not the encoder.
 */
export const FOCUS = { sigma: 6, inner: 170, outer: 215 };

/* ─────────────────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────────────────── */

export interface WordmarkCutProps {
  /** The wordmark. A trailing "." is dropped — the dot is drawn, not typed. */
  word?: string;
  /**
   * The dot's gradient, and the light the type cools out of. Both ends of one
   * ramp: the dot paints it at full strength and the type at `warm`, so they
   * cannot drift apart.
   *
   * Defaults to the design system's own `primary` lifted to a cyan. The
   * reference's is `#ff6100 → #fff100`, which is its brand and not ours.
   */
  dotFrom?: string;
  dotTo?: string;
  /** How much light the type carries at its hottest, 0…1. */
  warm?: number;
  /** Design-system token overrides. */
  theme?: Partial<SnapCnTheme>;
  mode?: "light" | "dark";
  /**
   * The face this scene paints its word in — a label from `fonts.ts` or a CSS
   * family you have loaded yourself. Overrides `theme.fontFamily`.
   */
  fontFamily?: string;
  /** 1 is the measured speed. */
  speed?: number;
}

export function WordmarkCut({
  word = "snapcn.",
  dotFrom = "#3072db",
  dotTo = "#4fd8f5",
  warm = 1,
  theme,
  mode,
  fontFamily,
  speed = 1,
}: WordmarkCutProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = (frame * speed) / fps;

  const th = useSnapCnTheme(theme, mode);
  const face = resolveFont(fontFamily ?? th.fontFamily) ?? SANS;

  const k = Math.min(width / REF_W, height / REF_H);
  const ox = (width - REF_W * k) / 2;
  const oy = (height - REF_H * k) / 2;

  const text = word.replace(/\.+$/, "");
  const close = t >= CUT;
  const heat = close ? 0 : warmth(t) * warm;
  // The reference cools to a flat black; this cools to the palette's ink, which
  // is #141414 and not #000, so the last few frames of the beat sit a shade
  // short of it. That is the trade the design system asks for, and it is the
  // whole of the difference between the two.
  const from = mixOklch(dotFrom, th.foreground, 1 - heat);
  const to = mixOklch(dotTo, th.foreground, 1 - heat);

  const line = (
    <Line
      dotFrom={dotFrom}
      dotTo={dotTo}
      face={face}
      from={from}
      baseline={baselineFor(close ? "close" : "wide", text)}
      size={sizeFor(close ? "close" : "wide")}
      text={text}
      to={to}
      wide={!close}
    />
  );

  const pivot = CLOSE.dot;
  const offset = closeOffset(t);
  // The *blurred* copy is the one that gets masked, and it sits on top. Mask
  // the sharp copy instead and the blurred one's spill shows all round the
  // letters that are supposed to be in focus — a halo on every glyph, which is
  // not a shallow depth of field, it is a glow.
  const mask = `radial-gradient(circle ${FOCUS.outer}px at ${REF_W / 2}px ${REF_H / 2}px, transparent 0%, transparent ${Math.round((100 * FOCUS.inner) / FOCUS.outer)}%, #000 100%)`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: th.background,
        fontFamily: face,
        // The type is under a moving scale for the whole close shot; hinting
        // would re-snap every stem on every frame and the letterforms boil.
        textRendering: "geometricPrecision",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: ox,
          top: oy,
          width: REF_W,
          height: REF_H,
          overflow: "hidden",
          transform: `scale(${k})`,
          transformOrigin: "0 0",
        }}
      >
        {close ? (
          <>
            {/* Two copies of one line: the sharp one underneath, the soft one
                over it through a radial hole. The mask is on the
                *untransformed* layer, because a depth of field belongs to the
                lens and not to the thing being filmed — masking inside the
                camera transform would drag the focal plane along with the
                push. */}
            <Camera offset={offset} pivot={pivot} scale={closeScale(t)}>
              {line}
            </Camera>
            <div
              style={{
                position: "absolute",
                inset: 0,
                maskImage: mask,
                WebkitMaskImage: mask,
              }}
            >
              <Camera
                blur={FOCUS.sigma}
                offset={offset}
                pivot={pivot}
                scale={closeScale(t)}
              >
                {line}
              </Camera>
            </div>
          </>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${drift(t)}px, ${rise(t)}px)`,
            }}
          >
            {line}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** The close shot's camera: scale about the dot, then put the dot where it goes. */
function Camera({
  blur,
  children,
  offset,
  pivot,
  scale,
}: {
  blur?: number;
  children: React.ReactNode;
  offset: { x: number; y: number };
  pivot: { x: number; y: number };
  scale: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: `${pivot.x}px ${pivot.y}px`,
        filter: blur ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The word and its dot, as one nowrap row.
 *
 * Anchored by the left edge in the wide shot and by the **dot** in the close one
 * — `right` rather than `left`, so a line of unknown width lands with its dot on
 * the mark without anyone having to measure the text first. Measuring it would
 * mean `delayRender`, and a title that cannot draw its first frame until a font
 * has loaded is a worse trade than a layout rule that never needs to know.
 */
function Line({
  baseline,
  dotFrom,
  dotTo,
  face,
  from,
  size,
  text,
  to,
  wide,
}: {
  baseline: number;
  dotFrom: string;
  dotTo: string;
  face: string;
  from: string;
  size: number;
  text: string;
  to: string;
  wide: boolean;
}) {
  const d = DOT.size * size;
  const top = baseline - BASELINE_IN_BOX * size;
  const anchored = wide
    ? { left: WIDE.left }
    : { right: REF_W - (CLOSE.dot.x + d / 2) };
  return (
    <div
      style={{
        position: "absolute",
        top,
        ...anchored,
        display: "flex",
        alignItems: "flex-end",
        whiteSpace: "nowrap",
        fontFamily: face,
      }}
    >
      <span
        style={{
          fontSize: size,
          fontWeight: 500,
          lineHeight: 1,
          // −0.02em. Measured: Inter's own advances put the reference's fifth
          // stem 20px right of where it sits, and the drift is even across the
          // word — which is tracking, not a different face.
          letterSpacing: -0.02 * size,
          // The light runs across the *word*, not across the frame: the
          // reference's ramp covers a shade more than one screen width and the
          // word is a shade wider than one, which is the same thing said twice.
          backgroundImage: `linear-gradient(90deg, ${from}, ${to})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {text}
      </span>
      <span
        style={{
          marginLeft: DOT.gap * size,
          marginBottom: (1 - BASELINE_IN_BOX) * size,
          width: d,
          height: d,
          borderRadius: "50%",
          // 198deg: measured at 18° off vertical, the light end up and to the
          // right. The dot is the one thing in the piece that never cools.
          backgroundImage: `linear-gradient(198deg, ${dotTo}, ${dotFrom})`,
          flexShrink: 0,
        }}
      />
    </div>
  );
}

export default WordmarkCut;
