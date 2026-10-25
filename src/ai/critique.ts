// Visual critique: a vision model looks at two renders of a finished build (see snapshot.ts) with the scene text
// and scores it against a fixed rubric. Issues it finds feed one fix pass (see runSceneAgent).
import type { ChatContentPart, VisionChatMessage } from "./client";
import { AI_TASK_LIMITS } from "./tasks";

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

/** Two renders of the build: from the front-right above, and from straight above. */
export interface CritiqueImages {
  threeQuarter: string;
  topDown: string;
}

export const MAX_CRITIQUE_ISSUES = 8;
/** A build scoring below this gets one fix pass. */
export const CRITIQUE_PASS_SCORE = 8;

export const CRITIQUE_SYSTEM_PROMPT = `You are a harsh art director checking a 3D scene a player asked an AI to build. You get the player's request, the scene as text (entities with ids, names, parents, transforms, meshes, materials, lights), and two renders: a 3/4 view from the front-right and above, and a top-down view (front of the scene at the bottom).

Check in this order:
a. Every object and setting the player named is present.
b. Each object is recognizable as what was asked; famous things show their signature features.
c. Shape choice matches the real object (round things aren't boxes).
d. Nothing floating, clipping, poking through, or stray.
e. Moving parts have clearance (slides, swings, doors).
f. Density: no empty shelves, floors, rooms or bare settings.
g. Lighting and colors match the mood words.
h. Scale and proportions are believable.

Be harsh: a 10 means you would ship it as is; anything a player would notice costs points. Report only issues visible in the images or the scene text, never guesses. At most ${MAX_CRITIQUE_ISSUES} issues, most important first. Each issue names the entity id it is on (null for a missing object or a scene-wide problem), the problem, and a concrete fix in meters, shapes, colors or ids that a builder can apply.

Return only JSON: {"score": 1-10, "issues": [{"entityId": string|null, "problem": string, "fix": string}]}`;

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

/** The critique call's messages; the scene text is cut so the request stays within the task's input cap. */
export function critiqueMessages(request: string, sceneText: string, images: CritiqueImages): VisionChatMessage[] {
  const head = `## Player's request\n${request.slice(0, 2_000)}\n\n## Scene\n`;
  const room = AI_TASK_LIMITS.scene_critique.maxInputChars - CRITIQUE_SYSTEM_PROMPT.length - head.length - 200;
  const scene = sceneText.length > room ? `${sceneText.slice(0, room)}\n[Scene text truncated.]` : sceneText;
  const content: ChatContentPart[] = [
    { type: "text", text: `${head}${scene}\n\nImage 1: 3/4 view. Image 2: top-down view.` },
    { type: "image_url", image_url: { url: images.threeQuarter } },
    { type: "image_url", image_url: { url: images.topDown } }
  ];
  return [{ role: "system", content: CRITIQUE_SYSTEM_PROMPT }, { role: "user", content }];
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
    const problem = text(entry.problem, 300);
    const fix = text(entry.fix, 300);
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
