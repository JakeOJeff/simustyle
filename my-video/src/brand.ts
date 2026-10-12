import { loadFont as loadDmMono } from "@remotion/google-fonts/DMMono";
import { loadFont as loadDmSans } from "@remotion/google-fonts/DMSans";
import type { SnapCnTheme } from "./lib/snap-cn-ui";

// The editor's own faces (src/editor/*.svelte use DM Sans for UI and DM Mono for labels and code).
export const dmSans = loadDmSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const dmMono = loadDmMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

/** Colors lifted from the editor and landing CSS, so snapcn scenes read as SimuStyle UI. */
export const editor = {
  page: "#0e0e11", // landing --bg
  window: "#1c1c1f", // panel --window-bg
  field: "#161618", // composer --field-bg
  fieldBorder: "#ffffff14",
  line: "#ffffff0d",
  text: "#ebebec",
  textSoft: "#c7c7cc",
  muted: "#74747f",
  roleAssistant: "#8e87bd",
  progress: "#b0a6e8",
  accent: "#a99bff",
  accentFill: "#7c6cf0",
};

// Passed to every snapcn scene with mode="dark".
export const brand: Partial<SnapCnTheme> = {
  background: editor.page,
  foreground: editor.text,
  card: editor.field,
  cardForeground: editor.text,
  mutedForeground: editor.muted,
  border: editor.fieldBorder,
  input: editor.fieldBorder,
  primary: editor.accentFill,
  ring: editor.accentFill,
  radius: 9,
  fontFamily: dmSans,
};

export const accent = editor.accent;
