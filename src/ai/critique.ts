// Visual critique: a vision model looks at renders of a finished build with its scene text and scores it against a
// fixed rubric. An overview critique sees the whole scene from four corners and above; a chunk critique sees one
// object or group of the build alone, from its six orthographic faces and one corner (see inspection.ts). Issues
// feed fix passes, and fixed targets are checked again (see runSceneAgent).
import type { ChatContentPart, VisionChatMessage } from "./client";
import { VIEW_LABELS, type ViewName } from "./framing";
import { AI_TASK_LIMITS, MAX_CRITIQUE_IMAGES } from "./tasks";

export interface CritiqueIssue {
  /** The entity the problem is on, when there is one. */
  entityId: string | null;
  problem: string;
  fix: string;
}

export interface SceneCritique {
  /** 1 (unusable) to 10 (nothing to fix). */
  score: number;
  /** Most important first, at most MAX_CRITIQUE_ISSUES. */
  issues: CritiqueIssue[];
}

/** One rendered view as a JPEG data URL. */
export interface RenderedView {
  view: ViewName;
  url: string;
}

export const MAX_CRITIQUE_ISSUES = 10;
/** A target scoring below this is fixed and checked again. */
export const CRITIQUE_PASS_SCORE = 9;

/** The whole scene from its four upper corners and straight above. */
export const OVERVIEW_VIEWS: ViewName[] = ["frontRight", "frontLeft", "backLeft", "backRight", "top"];
/** One chunk alone: its six faces and one corner for depth. */
export const CHUNK_VIEWS: ViewName[] = ["front", "back", "left", "right", "top", "bottom", "frontRight"];

const SCORING = `Be harsh: a 10 means you would ship it as is; anything a player would notice costs points, and a 9 allows only nitpicks. Report only issues visible in the images or the scene text, never guesses. At most ${MAX_CRITIQUE_ISSUES} issues, most important first. Each issue names the entity id it is on (null for a missing object or a scene-wide problem), the problem, and a concrete fix in meters, shapes, colors or ids that a builder can apply without seeing the images.

Return only JSON: {"score": 1-10, "issues": [{"entityId": string|null, "problem": string, "fix": string}]}`;

const STAGING_NOTE = "The renderer adds its own lights, a dark floor (whole-scene views) or a plain grey backdrop (chunk views); judge the build, never that staging.";

const REFERENCE_NOTE = "When a reference image is given (always the first image), it is the concept the build was modeled from: the build should read as the same subject with the same signature features, proportions, colors and layout, simplified into primitive shapes. Differences a player would notice are issues.";

export const CRITIQUE_SYSTEM_PROMPT = `You are a harsh art director checking a 3D scene a player asked an AI to build. You get the player's request, the scene as text (entities with ids, names, parents, transforms, meshes, materials, lights), and renders of the whole scene: four perspective views from its upper corners and one straight down. ${STAGING_NOTE} ${REFERENCE_NOTE}

Check in this order:
a. Every object and setting the player named is present.
b. Each object is recognizable as what was asked; famous things show their signature features.
c. Shape choice matches the real object (round things aren't boxes).
d. Nothing floating, clipping, poking through, or stray.
e. Moving parts have clearance (slides, swings, doors).
f. Density: no empty shelves, floors, rooms or bare settings.
g. Lighting and colors match the mood words.
h. Scale, proportions and placement between objects are believable.

${SCORING}`;

export const CHUNK_CRITIQUE_SYSTEM_PROMPT = `You are a harsh 3D modeling lead checking ONE part (a chunk) of a scene a player asked an AI to build. The chunk is rendered alone, without the rest of the scene, from all six sides as orthographic views (front, back, left, right, top, bottom) plus one perspective corner view, on a plain background. You also get the player's request, what the chunk is, and the chunk's entities as text. ${STAGING_NOTE} ${REFERENCE_NOTE}

Use every view: side views show gaps, floating parts and uneven legs or bases; the top and bottom show missing or open faces, misaligned parts and parts poking through; back views show unfinished backs.
Check in this order:
a. The chunk is recognizable as what it is meant to be, with its signature features.
b. Shape choice matches the real thing (round things aren't boxes; curved things are curved).
c. Every part is attached: no floating or detached parts, no visible gaps where parts should meet, everything that should stand rests on its base.
d. No clipping or parts poking through each other or out of surfaces.
e. Symmetry and alignment: matching parts match (legs equal length, wheels aligned), parts are straight unless meant otherwise.
f. Proportions and scale of parts are believable.
g. Every side is finished: no missing backs, open bottoms or hollow-looking gaps a player could see.
h. Colors and materials fit the request.
i. Detail: enough parts to look modeled, not a few plain blocks.

${SCORING}`;

export const CRITIQUE_JSON_SCHEMA = {
  name: "scene_critique",
  strict: true,
  schema: {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 1, maximum: 10 },
      issues: {
        type: "array",
        maxItems: MAX_CRITIQUE_ISSUES,
        items: {
          type: "object",
          properties: { entityId: { type: ["string", "null"] }, problem: { type: "string" }, fix: { type: "string" } },
          required: ["entityId", "problem", "fix"],
          additionalProperties: false
        }
      }
    },
    required: ["score", "issues"],
    additionalProperties: false
  }
};

export interface CritiqueInput {
  request: string;
  sceneText: string;
  views: readonly RenderedView[];
  /** The concept image the build was modeled from (see concept.ts). */
  reference?: string | null;
  /** For a chunk: what it is, e.g. 'Chunk "Office Desk" (office_desk), 34 parts, 1.4×0.78×0.7 m'. Absent: an overview. */
  chunk?: string;
  /** Issues found on this target before its last fix pass; the critic checks each is now fixed. */
  previous?: readonly CritiqueIssue[];
}

/** The critique call's messages; the scene text is cut so the request stays within the task's input cap. */
export function critiqueMessages(input: CritiqueInput): VisionChatMessage[] {
  const system = input.chunk ? CHUNK_CRITIQUE_SYSTEM_PROMPT : CRITIQUE_SYSTEM_PROMPT;
  const views = input.views.slice(0, MAX_CRITIQUE_IMAGES - (input.reference ? 1 : 0));
  const images = [...(input.reference ? [{ label: "reference image (the concept the build was modeled from)", url: input.reference }] : []),
    ...views.map((view) => ({ label: VIEW_LABELS[view.view], url: view.url }))];
  const previous = input.previous?.length ? `\n\n## Issues reported before the last fix (check each is now fixed; report any that is not)\n${critiqueCorrections({ score: 0, issues: [...input.previous] }).map((line) => `- ${line}`).join("\n")}`.slice(0, 4_000) : "";
  const head = `## Player's request\n${input.request.slice(0, 2_000)}${input.chunk ? `\n\n## The chunk you check\n${input.chunk.slice(0, 600)}` : ""}${previous}\n\n## ${input.chunk ? "Chunk entities" : "Scene"}\n`;
  const labels = `\n\n${images.map((image, index) => `Image ${index + 1}: ${image.label}.`).join("\n")}`;
  const room = AI_TASK_LIMITS.scene_critique.maxInputChars - system.length - head.length - labels.length - 200;
  const scene = input.sceneText.length > room ? `${input.sceneText.slice(0, Math.max(0, room))}\n[Scene text truncated.]` : input.sceneText;
  const content: ChatContentPart[] = [
    { type: "text", text: `${head}${scene}${labels}` },
    ...images.map((image): ChatContentPart => ({ type: "image_url", image_url: { url: image.url, detail: "high" } }))
  ];
  return [{ role: "system", content: system }, { role: "user", content }];
}

const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** The critique in a model reply, or null when the reply has no usable score. Invalid issues are dropped. */
export function parseCritique(value: unknown): SceneCritique | null {
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  const score = typeof reply.score === "number" && Number.isFinite(reply.score) ? Math.round(Math.min(10, Math.max(1, reply.score))) : null;
  if (score === null) return null;
  const issues: CritiqueIssue[] = [];
  for (const raw of Array.isArray(reply.issues) ? reply.issues : []) {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const problem = text(entry.problem, 400);
    const fix = text(entry.fix, 400);
    if (!problem || !fix) continue;
    issues.push({ entityId: text(entry.entityId, 80), problem, fix });
    if (issues.length === MAX_CRITIQUE_ISSUES) break;
  }
  return { score, issues };
}

/** One correction line per issue, for the fix pass. */
export function critiqueCorrections(critique: SceneCritique): string[] {
  return critique.issues.map((issue) => `${issue.entityId ? `[${issue.entityId}] ` : ""}${issue.problem} Fix: ${issue.fix}`);
}
