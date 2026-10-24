"use client";

// remocn Marker Highlight (https://remocn.dev/docs/typography/marker-highlight), made inline and font-agnostic.
// A marker bar springs across one phrase, flipping its text color as it passes.
import type { CSSProperties } from "react";
import { interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { dmSans } from "../../brand";

export interface MarkerHighlightProps {
  before?: string;
  highlight: string;
  after?: string;
  markerColor?: string;
  baseColor?: string;
  highlightedTextColor?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  /** Frame the marker starts its sweep. */
  delay?: number;
  speed?: number;
  style?: CSSProperties;
}

export function MarkerHighlight({
  before = "",
  highlight,
  after = "",
  markerColor = "#facc15",
  baseColor = "#171717",
  highlightedTextColor = "#171717",
  fontSize = 72,
  fontWeight = 600,
  fontFamily = dmSans,
  delay = 15,
  speed = 1,
  style,
}: MarkerHighlightProps) {
  const frame = useCurrentFrame() * speed;
  const { fps } = useVideoConfig();

  const markerScale = spring({ frame: frame - delay, fps, config: { damping: 14 } });

  const textColor = interpolateColors(
    interpolate(markerScale, [0.5, 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    [0, 1],
    [baseColor, highlightedTextColor],
  );

  return (
    <span
      style={{
        fontSize,
        fontWeight,
        color: baseColor,
        letterSpacing: "-0.03em",
        fontFamily,
        whiteSpace: "pre",
        ...style,
      }}
    >
      {before}
      {/* Margins clear the marker's overhang, so it never covers the words around it. */}
      <span style={{ position: "relative", display: "inline-block", margin: "0 0.16em" }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: "0.04em -0.14em",
            borderRadius: "0.14em",
            background: markerColor,
            transformOrigin: "left center",
            scale: `${markerScale} 1`,
            zIndex: 0,
          }}
        />
        <span style={{ position: "relative", zIndex: 1, color: textColor }}>{highlight}</span>
      </span>
      {after}
    </span>
  );
}
