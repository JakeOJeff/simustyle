"use client";

import { loadFont as loadSans } from "@remotion/google-fonts/Jost";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  mixOklch,
  resolveFont,
  type SnapCnTheme,
  useSnapCnTheme,
} from "@/lib/snap-cn-ui";

/**
 * A column of words that spins like a reel and stops on one of them.
 *
 * A fixed lead-in — "snapcn for" — holds the left of the line, and the word
 * that finishes the sentence lives in a slot to its right. The slot is one row
 * of a taller column: the words above and below it are visible, smaller and
 * grey, fading out toward the top and bottom of the frame. The column rolls,
 * decelerates over about a second and three quarters, and comes to rest with
 * one word at full size and in ink.
 *
 * ## Everything here was measured off a recording, frame by frame
 *
 * The numbers below are not taste. They were recovered from a 2.1 second,
 * 638 × 354 screen capture by thresholding the ink in each of its 80 frames:
 *
 *   - the row pitch is exactly **34px**, and every row's baseline — including
 *     the oversized selected one — sits on that grid to the pixel. That is the
 *     tell that the scale pivots on the baseline, which is also the only pivot
 *     that does not make scaled type climb the pixel grid (see below).
 *   - the selected word is **1.665×** the others. Measured on the same word in
 *     both states, twice: "Growth" 97.15/58.28 = 1.6671, "Educators"
 *     128.55/77.35 = 1.6618.
 *   - the reel travels **9 rows**, and the whole curve is in `ROLL` — it is not
 *     a bezier and not a spring. The best cubic-bezier fit is 1.8px RMS and
 *     5.5px off at worst, the best spring 4.3px RMS. A fifth of a row is a
 *     visibly different frame, so the measurement ships instead of a curve.
 *
 * ## The selection lags the slot, and that is the whole feel of it
 *
 * A row becomes the selected one when it is nearest the slot — when its
 * baseline is within half a pitch. But it does not *arrive* at full size the
 * instant it crosses: the reference shows the same row at |d| = 17px reading
 * 0.30 on the way in and 0.685 on the way out. That hysteresis is a transition
 * lagging a class change, and it is why the fast part of the roll never looks
 * like a row of identical pops — each word is still growing when the next one
 * takes over. `SWAP` is that lag.
 *
 * ## The face is Jost, and that was measured too
 *
 * The reference is set in a licensed brand face, so the question was which
 * available one has its *proportions*. Fingerprinted on two space-free words at
 * matched cap height — "Framer" and "Growth", in cap units — the reference reads
 * 4.025 and 4.353. Jost reads 4.153 and 4.265; Outfit 4.491 and 4.529; Poppins
 * 5.201 and 5.180. Jost is within 3%, everything else is 10% or worse, and a
 * word 10% wide is a word that no longer ends where the sentence needs it to.
 *
 * ## Two fixed left edges
 *
 * The selected word's ink starts 30.5px left of everyone else's, so it butts up
 * against the lead-in and completes the sentence while the column itself stays
 * indented and out of the way. Both edges are constant across every word and
 * every frame — the reel is left-aligned twice over, not centred once.
 */

const { fontFamily: SANS } = loadSans("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

/* ─────────────────────────────────────────────────────────────────────────
   The scene, in the reference's own 638 × 354 pixels
   ───────────────────────────────────────────────────────────────────────── */

export const REF_W = 638;
export const REF_H = 354;

/** Row-to-row distance. Measured on eight consecutive baselines: 34.0 each. */
export const PITCH = 34;
/** The slot's baseline — where the sentence sits. */
export const BASE_Y = 183.8;
/** Left of the line's box. The reference's lead-in ink starts at 203.55. */
export const LINE_X = 201.98;
/**
 * The space between the end of the lead-in and the selected word.
 *
 * Measured as a gap rather than as the word's x, and that distinction is the
 * whole reason this scene survives having its copy changed: the reference's word
 * sits at 345.29 only because "Framer for" happens to end at 336.56. Pin the
 * word to 345 and a shorter lead-in leaves a hole, a longer one runs the two
 * together — which is exactly what "snapcn forLaunches" did before this was a
 * gap.
 */
export const GAP = 8.01;
/**
 * How far right the column sits from the word that completes the sentence.
 *
 * The reel is indented and the selected word is not: it steps left out of the
 * column to finish the line, and steps back when it loses the slot. Both edges
 * are constant across every word and every frame of the reference — the reel is
 * left-aligned twice over, not centred once.
 */
export const INDENT = 30.87;

/** Type size of the selected word. Cap height measured at 22.32px. */
export const SIZE = 30.63;
/** Box top → baseline, at `lineHeight: 1`. A face metric, measured, not guessed. */
export const ASC = 25.43;
/** Unselected scale. The reciprocal of the measured 1.665. */
export const SMALL = 1 / 1.665;

/** Rows travelled. The reel comes back round to the word it started on. */
export const SPIN = 9;

/**
 * How long a row takes to grow into the slot, in seconds, and its curve.
 *
 * Measured from the frame a row crosses half a pitch: 0.90 at 38ms, and inside
 * the noise floor of a width measurement thereafter. A settle worth one frame
 * is a settle; this one is worth two.
 */
export const SWAP = 0.07;

/**
 * The reel's own deceleration, as (seconds, share of the travel).
 *
 * Recovered from the recording by taking the phase of the 34px row grid in each
 * frame's vertical ink profile — which reads the offset to a hundredth of a
 * pixel off all eleven visible rows at once, rather than tracking one word and
 * inheriting its glyphs. Frames the capture sampled twice are dropped: they are
 * the recorder's duplicates, not the page's, and keeping them would freeze the
 * render for a frame in exactly the places the reference is moving fastest.
 */
export const ROLL: readonly (readonly [number, number])[] = [
  [0.1583, 0.00033],
  [0.175, 0.02175],
  [0.2083, 0.05298],
  [0.2417, 0.08995],
  [0.275, 0.13203],
  [0.3083, 0.18194],
  [0.3417, 0.23034],
  [0.3833, 0.28119],
  [0.4167, 0.32889],
  [0.45, 0.37627],
  [0.4833, 0.42203],
  [0.5167, 0.46322],
  [0.5583, 0.50415],
  [0.575, 0.54044],
  [0.6083, 0.57445],
  [0.6417, 0.6073],
  [0.675, 0.63751],
  [0.7083, 0.66516],
  [0.7417, 0.69074],
  [0.775, 0.71485],
  [0.8083, 0.73897],
  [0.8417, 0.75963],
  [0.875, 0.77896],
  [0.9083, 0.79751],
  [0.9417, 0.81422],
  [0.975, 0.83177],
  [1.0167, 0.84767],
  [1.05, 0.86162],
  [1.0833, 0.87394],
  [1.1167, 0.88608],
  [1.1417, 0.89735],
  [1.175, 0.9077],
  [1.2083, 0.91734],
  [1.2417, 0.92633],
  [1.275, 0.93528],
  [1.3083, 0.94438],
  [1.35, 0.95087],
  [1.3833, 0.95819],
  [1.4417, 0.96961],
  [1.475, 0.97442],
  [1.5083, 0.97863],
  [1.5417, 0.98239],
  [1.575, 0.98571],
  [1.6083, 0.98903],
  [1.6417, 0.99161],
  [1.6833, 0.99381],
  [1.7167, 0.99569],
  [1.75, 0.99732],
  [1.7833, 0.99858],
  [1.8083, 0.99926],
  [1.8417, 1],
];

/**
 * How far a row is faded, by its distance from the slot as a share of the frame.
 *
 * Read as an envelope: the brightest any pixel of an unselected row ever got at
 * each height, across all 80 frames. Taking the maximum over the whole reel is
 * what makes it a property of the *position* rather than of whichever word
 * happened to be sitting there — a word with no ascenders is dimmer at the same
 * height, and one sample would have read that as a dip in the fade.
 *
 * It does not reach zero: the column is cut off by the frame, not by the fade.
 */
export const FADE: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.085, 0.97],
  [0.155, 0.89],
  [0.22, 0.744],
  [0.288, 0.518],
  [0.356, 0.357],
  [0.424, 0.25],
  [0.492, 0.185],
];

type Table = readonly (readonly [number, number])[];

/**
 * Linear read of a rising table, in either direction.
 *
 * `at = 0` reads y from x — the reel's travel at a second. `at = 1` reads x from
 * y — the second the reel reaches a share of its travel, which is what tells a
 * row when it takes the slot. Both tables here are sorted and monotone in both
 * columns, so one walk serves both and there is no second function to keep in
 * step with the first.
 */
export function read(table: Table, v: number, at: 0 | 1 = 0): number {
  const to = at === 0 ? 1 : 0;
  const first = table[0];
  const last = table[table.length - 1];
  if (!first || !last) return 0;
  if (v <= first[at]) return first[to];
  if (v >= last[at]) return last[to];
  for (let i = 1; i < table.length; i++) {
    const hi = table[i];
    const lo = table[i - 1];
    if (hi && lo && v <= hi[at]) {
      return lo[to] + ((hi[to] - lo[to]) * (v - lo[at])) / (hi[at] - lo[at]);
    }
  }
  return last[to];
}

/**
 * The second the reel has travelled `p` of its distance.
 *
 * Outside the roll it answers with an infinity rather than an endpoint: a row
 * the reel never reaches must never take the slot, and a row it started past
 * must have held it from the first frame. Clamping instead would hand both of
 * those a real time and make the scene swap words it never touches.
 */
function rollReaches(p: number): number {
  const first = ROLL[0];
  const last = ROLL[ROLL.length - 1];
  if (!first || !last) return Number.POSITIVE_INFINITY;
  if (p <= first[1]) return Number.NEGATIVE_INFINITY;
  if (p > last[1]) return Number.POSITIVE_INFINITY;
  return read(ROLL, p, 1);
}

/** The swap's curve: a moderate decelerate, clamped. */
function swell(t: number): number {
  if (t <= 0) return 0;
  if (t >= SWAP) return 1;
  const u = t / SWAP;
  return 1 - (1 - u) ** 3;
}

export interface WordWheelProps {
  /** The part of the line that never changes. */
  headline?: string;
  /** The reel, in order. It cycles, so the column is never empty. */
  words?: string;
  /** Rows travelled. Left at the list's length the reel comes full circle. */
  spin?: number;
  theme?: Partial<SnapCnTheme>;
  mode?: "light" | "dark";
  fontFamily?: string;
}

export function WordWheel({
  headline = "snapcn for",
  words = "Launches, Founders, Indie hackers, Agencies, Designers, Startups, Dev tools, Solo builders, Changelogs",
  spin,
  theme,
  mode = "light",
  fontFamily = "Default",
}: WordWheelProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useSnapCnTheme(theme, mode);
  const face = resolveFont(fontFamily) ?? SANS;

  const reel = words
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  const rows = reel.length || 1;
  const travel = (spin ?? rows) * PITCH;

  /**
   * One unit of reference pixel, and the offset that centres the layout.
   *
   * The scene is laid out in the recording's own pixels and scaled by height, so
   * a render at the reference's dimensions is the reference's dimensions and
   * nothing is resampled in the middle of a comparison.
   */
  const u = height / REF_H;
  const ox = (width - REF_W * u) / 2;

  const now = frame / fps;
  const s = read(ROLL, now) * travel;

  const first = Math.ceil((s - BASE_Y - PITCH) / PITCH);
  const last = Math.floor((s - BASE_Y + REF_H + PITCH) / PITCH);

  const ink = t.foreground;
  const dim = t.mutedForeground;

  return (
    <AbsoluteFill style={{ backgroundColor: t.background }}>
      <div
        style={{
          position: "absolute",
          left: ox,
          top: 0,
          width: REF_W * u,
          height: REF_H * u,
          fontFamily: face,
          fontWeight: 500,
          // Hinting re-snaps every stem as the scale slides, and the letterforms
          // boil. This turns it off — the type reads a shade softer, which is the
          // outline as it actually is.
          textRendering: "geometricPrecision",
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: LINE_X * u,
            top: (BASE_Y - ASC) * u,
            fontSize: SIZE * u,
            lineHeight: 1,
            color: ink,
          }}
        >
          {headline}
          {/*
            A zero-sized inline-block sits on the baseline at the end of the
            lead-in's own advance, whatever that lead-in says. The reel hangs off
            it, so the sentence stays a sentence when the copy changes — and the
            anchor never needs measuring, because the browser has already done
            the layout by the time it paints.
          */}
          <span
            style={{ position: "relative", display: "inline-block", width: 0 }}
          >
            {Array.from({ length: last - first + 1 }, (_, n) => {
              const i = first + n;
              const y = BASE_Y + PITCH * i - s;
              const d = y - BASE_Y;

              // A row owns the slot while it is nearest to it, and grows into it
              // over SWAP rather than on the frame it crosses.
              const p =
                swell(now - rollReaches((PITCH * (i - 0.5)) / travel)) -
                swell(now - rollReaches((PITCH * (i + 0.5)) / travel));

              const scale = SMALL + (1 - SMALL) * p;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: (GAP + INDENT) * u,
                    top: (y - ASC - BASE_Y) * u,
                    color: p > 0 ? mixOklch(dim, ink, p) : dim,
                    opacity: read(FADE, Math.abs(d) / REF_H),
                    // The baseline is the only pivot a browser will not round:
                    // it quantises a glyph's origin to a whole device pixel
                    // vertically, so a scale that moves the baseline makes the
                    // word climb the grid in jumps. Pivot on it and there is
                    // nothing to snap.
                    transform: `translateX(${-INDENT * p * u}px) scale(${scale})`,
                    transformOrigin: `0px ${ASC * u}px`,
                  }}
                >
                  {reel[((i % rows) + rows) % rows]}
                </div>
              );
            })}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
