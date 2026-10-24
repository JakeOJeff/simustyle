"use client";

// remocn Blur Out Up (https://remocn.dev/docs/typography/blur-out-up), made inline and font-agnostic.
// Words arrive clean and leave upward into blur at the end of their Sequence.
import type { CSSProperties } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { dmSans } from "../../brand";

export interface BlurOutUpProps {
  text: string;
  staggerDelay?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  /** Leave at the end of the Sequence; false holds the words on screen. */
  exit?: boolean;
  speed?: number;
  style?: CSSProperties;
}

export function BlurOutUp({
  text,
  staggerDelay = 1,
  fontSize = 72,
  color = "#171717",
  fontWeight = 600,
  fontFamily = dmSans,
  exit = true,
  speed = 1,
  style,
}: BlurOutUpProps) {
  const frame = useCurrentFrame() * speed;
  const { durationInFrames } = useVideoConfig();

  const words = text.split(" ");

  const enterDur = 17;
  const enterTravel = 6;
  const exitDur = 14;
  const exitTravelFrom = 8;

  const inOpts = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  } as const;
  const outOpts = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.64, 0, 0.78, 0),
  } as const;

  const enterEnd = enterDur + (words.length - 1) * staggerDelay;
  const exitStart = exit
    ? Math.max(enterEnd, durationInFrames - exitDur - (words.length - 1) * staggerDelay)
    : Infinity;

  return (
    <span style={{ fontSize, fontWeight, color, letterSpacing: "-0.03em", fontFamily, ...style }}>
      {words.map((word, i) => {
        const enterLocal = frame - i * staggerDelay;
        const exitLocal = frame - exitStart - i * staggerDelay;

        const enterP = interpolate(enterLocal, [0, enterDur], [0, 1], inOpts);
        const exitP = interpolate(exitLocal, [0, exitDur], [0, 1], outOpts);
        const y =
          interpolate(enterLocal, [0, enterTravel], [10, 0], inOpts) +
          interpolate(exitLocal, [exitTravelFrom, exitDur], [0, -14], outOpts);
        const blur =
          interpolate(enterLocal, [0, enterDur], [6, 0], inOpts) +
          interpolate(exitLocal, [0, exitDur], [0, 8], outOpts);

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              marginRight: i < words.length - 1 ? "0.25em" : 0,
              transformOrigin: "50% 55%",
              opacity: enterP * (1 - exitP),
              translate: `0 ${y}px`,
              filter: `blur(${blur}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}
