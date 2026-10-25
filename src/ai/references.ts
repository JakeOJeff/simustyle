// The reference step before a follow-up build (task scene_context, on the strong model when it is on). It reads
// the scene as an outline (top-level objects, groups collapsed to their world boxes, with part names), the earlier
// requests and the selection, then says what the request refers to, which groups the builder must see part by
// part, and restates the request so it stands alone. The build message then carries the outline with only those
// groups expanded (see sceneText's expand option), which keeps it small without hiding what the edit touches.
import type { Scene } from "../scene/types";
import { sceneText } from "./sceneContext";
import { AI_TASK_LIMITS } from "./tasks";

/** The reference step expands at most this many groups. */
export const MAX_EXPANDED = 6;
const MAX_FACTS = 6;

export interface ContextResolution {
  /** Each implicit or explicit reference in the request and the ids it means. */
  references: { phrase: string; ids: string[] }[];
  /** Groups the builder must see part by part (ids that exist; at most MAX_EXPANDED). */
  expand: string[];
  /** The request restated to stand alone, naming referenced objects with their ids. */
  resolvedRequest: string;
  /** Spatial and style facts read from the scene that the build must respect. */
  facts: string[];
}

export const REFERENCE_SYSTEM_PROMPT = `You prepare context for the builder of a 3D scene editor. The player has an existing scene and sends a new request. You see the scene as an outline: top-level objects in full, and groups collapsed to one line with their world bounding box (meters; Y-up, ground y=0, the default camera looks from +x +z toward the origin) and the names of their parts. You also see the player's earlier requests (oldest first) and the current selection.
Work out what the request refers to and what the builder must see:
1. references: resolve every reference to object ids, explicit ("the table") or implicit: pronouns (it, them, that, this one), "another one", "the same color", "next to the window", "the other side", "bigger", "the rest". Use the request, the selection (it usually means "this"), the earlier requests (the latest one built the likeliest "it"), names and positions; objects are listed oldest first, so the newest are last. When the request changes something without naming it and nothing is selected, it usually means what the latest request built.
2. expand: the groups whose parts the builder must see. Expand a group when the request changes something inside it (recolor, resize, move or remove a part, add a part to it, restyle it) or must line up with its parts (a cup "next to the monitor on the desk" needs the desk's parts). Do not expand a group that is only moved, rotated, scaled, deleted or copied whole, or only serves as a landmark or a surface: its box is enough. Expand the fewest that suffice, at most ${MAX_EXPANDED}; an empty list is right for most requests that add new things.
3. resolvedRequest: the request rewritten so it stands alone. Name each referenced object with its id in brackets, e.g. "Make the chair [chair] 20% taller". Keep the player's intent, wording and details; add no objects, styles or changes the player did not ask for or clearly imply. If nothing needs resolving, return the request unchanged.
4. facts: at most ${MAX_FACTS} short facts read from the outline that the build must respect: where something goes ("Desk [desk] top at y 0.76, spans x 0.4..1.9, z -2.3..-1.6"), free room beside an object, sizes to match ("Existing chairs [chair, chair_2] are 0.5×0.9×0.5 m"), the scene's palette or style ("Furniture is dark walnut #5a3a22") or what a vague request implies here ("The room's open side is +z"). Only facts the outline shows; never guess, and leave it empty when nothing applies.
Return only the JSON object.`;

export const REFERENCE_JSON_SCHEMA = {
  name: "scene_context",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["references", "expand", "resolvedRequest", "facts"],
    properties: {
      references: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["phrase", "ids"], properties: { phrase: { type: "string" }, ids: { type: "array", items: { type: "string" } } } }
      },
      expand: { type: "array", items: { type: "string" }, maxItems: MAX_EXPANDED },
      resolvedRequest: { type: "string" },
      facts: { type: "array", items: { type: "string" }, maxItems: MAX_FACTS }
    }
  }
} as const;

export interface ReferenceContext {
  previousRequests?: readonly string[];
  focusIds?: readonly string[];
}

/** The user message: earlier requests, selection and request first (fixed), then as much of the outline as fits. */
export function referenceUserMessage(scene: Scene, request: string, context: ReferenceContext = {}): string {
  const history = (context.previousRequests ?? []).slice(-6).map((entry) => entry.slice(0, 600));
  const focus = (context.focusIds ?? []).slice(0, 40);
  const tail = `\n\n## Earlier requests (oldest first)\n${history.length ? history.map((entry) => `- ${entry}`).join("\n") : "(none)"}\n\n## Selected object ids\n${focus.length ? JSON.stringify(focus) : "(none)"}\n\n## Request\n${request.slice(0, 6_000)}`;
  const head = "## Scene outline\n";
  const budget = AI_TASK_LIMITS.scene_context.maxInputChars - REFERENCE_SYSTEM_PROMPT.length - head.length - tail.length - 200;
  return `${head}${sceneText(scene, { expand: [], partNames: true, maxChars: Math.max(1_000, budget), query: request, focusIds: focus })}${tail}`;
}

/** A usable resolution with unknown ids dropped; null when the reply has no request text. */
export function parseResolution(raw: unknown, scene: Scene, request: string): ContextResolution | null {
  if (!isRecord(raw)) return null;
  const known = new Set(scene.entities.map((entity) => entity.id));
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)))] : [];
  const references = Array.isArray(raw.references) ? raw.references.flatMap((reference) =>
    isRecord(reference) && typeof reference.phrase === "string" ? [{ phrase: reference.phrase.slice(0, 200), ids: ids(reference.ids) }] : []).slice(0, 20) : [];
  const resolved = typeof raw.resolvedRequest === "string" ? raw.resolvedRequest.trim() : "";
  const facts = Array.isArray(raw.facts) ? raw.facts.filter((fact): fact is string => typeof fact === "string" && fact.trim() !== "").map((fact) => fact.trim().slice(0, 300)).slice(0, MAX_FACTS) : [];
  return { references, expand: ids(raw.expand).slice(0, MAX_EXPANDED), resolvedRequest: (resolved || request).slice(0, 6_000), facts };
}

/** The block the build message carries before "## Request"; empty when the resolution adds nothing. */
export function resolutionText(resolution: ContextResolution, request: string): string {
  const restated = resolution.resolvedRequest.trim() !== request.trim();
  const references = resolution.references.filter((reference) => reference.ids.length);
  if (!restated && !references.length && !resolution.facts.length) return "";
  return ["## What the request refers to (resolved from the scene; the request below is what the player wrote)",
    ...(restated ? [`Restated: ${resolution.resolvedRequest}`] : []),
    ...(references.length ? [`References: ${references.map((reference) => `"${reference.phrase}" = ${reference.ids.join(", ")}`).join("; ")}`] : []),
    ...resolution.facts.map((fact) => `- ${fact}`)].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
