"use client";

// remocn Tracking In (https://remocn.dev/docs/typography/tracking-in), made inline and font-agnostic.
// Letter-spacing springs from wide to tight while the blur clears.
import type { CSSProperties } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { dmSans } from "../../brand";

export interface TrackingInProps {
  text: string;
  startTracking?: number;
  endTracking?: number;
  startBlur?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  speed?: number;
  style?: CSSProperties;
}

export function TrackingIn({
  text,
  startTracking = 0.5,
  endTracking = -0.03,
  startBlur = 12,
  fontSize = 96,
  color = "#171717",
  fontWeight = 700,
  fontFamily = dmSans,
  speed = 1,
  style,
}: TrackingInProps) {
  const frame = useCurrentFrame() * speed;
  const { fps } = useVideoConfig();

  const t = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });

  return (
    <span
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily,
        whiteSpace: "nowrap",
        letterSpacing: `${interpolate(t, [0, 1], [startTracking, endTracking])}em`,
        opacity: interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        filter: `blur(${interpolate(t, [0, 1], [startBlur, 0])}px)`,
        ...style,
      }}
    >
      {text}
    </span>
  );
}
