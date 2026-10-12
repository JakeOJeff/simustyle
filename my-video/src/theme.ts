import { loadFont as loadSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/DMMono";

// Matches the landing page tokens in src/landing/landing.css.
export const colors = {
  bg: "#0e0e11",
  bgRaised: "#16161a",
  card: "#18181c",
  line: "#ffffff12",
  lineStrong: "#ffffff22",
  text: "#ececed",
  text2: "#b4b4bc",
  text3: "#7c7c88",
  accent: "#a99bff",
  accentFill: "#7c6cf0",
  green: "#6ee7a8",
  amber: "#f5c46b",
};

export const { fontFamily: sans } = loadSans("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const { fontFamily: mono } = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});
