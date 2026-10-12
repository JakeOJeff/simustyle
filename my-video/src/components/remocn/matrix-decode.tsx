"use client";

// remocn Matrix Decode (https://remocn.dev/docs/typography/matrix-decode), made inline and font-agnostic.
// Each character scrambles until its turn, then resolves into the target string.
import type { CSSProperties } from "react";
import { random, useCurrentFrame } from "remotion";
import { dmMono } from "../../brand";

export interface MatrixDecodeProps {
  text: string;
  charset?: string;
  fontSize?: number;
  color?: string;
  /** Color of the characters still scrambling. */
  scrambleColor?: string;
  fontWeight?: number;
  fontFamily?: string;
  letterSpacing?: string;
  revealDuration?: number;
  speed?: number;
  style?: CSSProperties;
}

export function MatrixDecode({
  text,
  charset = "!@#$%^&*()_+-=<>?/\\|",
  fontSize = 72,
  color = "#22c55e",
  scrambleColor,
  fontWeight = 600,
  fontFamily = dmMono,
  letterSpacing = "0.05em",
  revealDuration = 60,
  speed = 1,
  style,
}: MatrixDecodeProps) {
  const frame = useCurrentFrame() * speed;

  return (
    <span style={{ fontSize, fontWeight, color, letterSpacing, whiteSpace: "pre", fontFamily, ...style }}>
      {Array.from(text).map((ch, i) => {
        const revealFrame = (i / Math.max(text.length, 1)) * revealDuration;
        if (ch === " " || frame >= revealFrame) return <span key={i}>{ch}</span>;
        const r = random(`${i}-${Math.floor(frame / 2)}`);
        return (
          <span key={i} style={{ color: scrambleColor ?? color }}>
            {charset[Math.floor(r * charset.length)]}
          </span>
        );
      })}
    </span>
  );
}
