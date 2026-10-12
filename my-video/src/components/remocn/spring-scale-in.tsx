"use client";

// remocn Spring Scale In (https://remocn.dev/docs/typography/spring-scale-in), made inline and font-agnostic.
// Words pop in one after another with a small overshoot.
import type { CSSProperties } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { dmSans } from "../../brand";

export interface SpringScaleInProps {
  text: string;
  staggerDelay?: number;
  scaleFrom?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  speed?: number;
  style?: CSSProperties;
}

export function SpringScaleIn({
  text,
  staggerDelay = 3,
  scaleFrom = 0.7,
  fontSize = 72,
  color = "#171717",
  fontWeight = 600,
  fontFamily = dmSans,
  speed = 1,
  style,
}: SpringScaleInProps) {
  const frame = useCurrentFrame() * speed;

  const words = text.split(" ");
  const wordDurationFrames = 11;
  const opts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  return (
    <span style={{ fontSize, fontWeight, color, letterSpacing: "-0.03em", fontFamily, ...style }}>
      {words.map((word, i) => {
        const local = frame - i * staggerDelay;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              marginRight: i < words.length - 1 ? "0.25em" : 0,
              transformOrigin: "50% 60%",
              opacity: interpolate(local, [0, wordDurationFrames], [0, 1], {
                ...opts,
                easing: Easing.out(Easing.quad),
              }),
              scale: `${interpolate(local, [0, wordDurationFrames], [scaleFrom, 1], {
                ...opts,
                easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              })}`,
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}
