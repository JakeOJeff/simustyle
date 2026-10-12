"use client";

// remocn Soft Blur In (https://remocn.dev/docs/typography/soft-blur-in), made inline and font-agnostic.
// Each character fades up out of a soft blur, one frame behind the last.
import type { CSSProperties } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { dmSans } from "../../brand";

export interface SoftBlurInProps {
  text: string;
  blur?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  /** Frames between one character and the next. */
  stagger?: number;
  speed?: number;
  style?: CSSProperties;
}

export function SoftBlurIn({
  text,
  blur = 12,
  fontSize = 72,
  color = "#171717",
  fontWeight = 600,
  fontFamily = dmSans,
  stagger = 1,
  speed = 1,
  style,
}: SoftBlurInProps) {
  const frame = useCurrentFrame() * speed;

  const chars = Array.from(text);
  const charDurationFrames = 27;
  const charTravelFrames = 9;
  const easing = Easing.bezier(0.22, 1, 0.36, 1);
  const opts = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing } as const;

  return (
    <span style={{ fontSize, fontWeight, color, letterSpacing: "-0.04em", fontFamily, whiteSpace: "pre", ...style }}>
      {chars.map((char, i) => {
        const local = frame - i * stagger;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              backfaceVisibility: "hidden",
              transformOrigin: "50% 55%",
              opacity: interpolate(local, [0, charDurationFrames], [0, 1], opts),
              translate: `0 ${interpolate(local, [0, charTravelFrames], [16, 0], opts)}px`,
              filter: `blur(${interpolate(local, [0, charDurationFrames], [blur, 0], opts)}px)`,
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
