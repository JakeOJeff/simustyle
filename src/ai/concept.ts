// Reference images for complex requests. Before a build, the concept step (task scene_concept) rates how complex
// what the request creates is and writes an image prompt; at REFERENCE_MIN_COMPLEXITY or more the image model draws
// a concept image (task scene_image), and the vision model turns it into a written build spec (task
// scene_reference) that every builder pass reads. The image itself goes to the visual critiques, which compare the
// build against it.
import type { ChatContentPart, VisionChatMessage } from "./client";
import { AI_TASK_LIMITS } from "./tasks";

/** Requests rated at least this complex get a reference image. */
export const REFERENCE_MIN_COMPLEXITY = 5;
const MAX_SPEC_CHARS = 5_000;

export interface ConceptPlan {
  /** True when the request asks to create something visible (not only recolor, move, delete or tweak). */
  creates: boolean;
  /** 1 (a single simple shape) to 10 (a famous design, a character, a full scene of many objects). */
  complexity: number;
  /** What the image shows, in a few words. */
  subject: string;
  imagePrompt: string;
}

export const CONCEPT_SYSTEM_PROMPT = `You prepare reference images for a 3D scene builder. A player typed a request into a 3D editor; the builder models what it creates out of primitive shapes (boxes, spheres, cylinders, cones, tori, wedges, bevelled boxes). For complex subjects, the builder first gets a concept image to model from.

Decide:
- creates: true when the request asks to build or add something visible (objects, furniture, buildings, vehicles, characters, landscapes, whole scenes); false when it only edits what exists (recolor, move, resize, delete, rename, change lighting or settings).
- complexity of what it creates, 1-10: 1-2 a single simple shape (a cube, a ball); 3-4 a simple object (a table, a mug, a lamp); 5-6 a detailed object or a small arrangement (an office chair, a bicycle, a desk with things on it); 7-8 a specific or famous design, a vehicle, a character or creature, a building, a room or scene with several objects; 9-10 a large scene with many detailed objects, or a recognizable landmark or fictional place.
- subject: what the image shows, in a few words.
- imagePrompt: one prompt for an image model. Show exactly what the builder must make, with every object the request names and the setting it implies, resolving "this"/"it" from the scene outline and earlier requests. Describe a clean 3D render: a 3/4 view from the front-right and slightly above, the whole subject in frame and not cropped, plain neutral light-grey background unless the request is a full scene or landscape, soft even studio lighting, clear readable shapes and proportions, true-to-life or requested colors, no text, labels, people or extra objects not asked for. For famous or fictional subjects, name them and their signature features. For a scene, describe the layout (what stands where). Under 900 characters.

Return only JSON: {"creates": boolean, "complexity": 1-10, "subject": string, "imagePrompt": string}`;

export const CONCEPT_JSON_SCHEMA = {
  name: "scene_concept",
  strict: true,
  schema: {
    type: "object",
    properties: {
      creates: { type: "boolean" },
      complexity: { type: "integer", minimum: 1, maximum: 10 },
      subject: { type: "string" },
      imagePrompt: { type: "string" }
    },
    required: ["creates", "complexity", "subject", "imagePrompt"],
    additionalProperties: false
  }
};

/** The concept step's user message: the scene outline (follow-ups only), earlier requests, the resolved references and the request. */
export function conceptUserMessage(request: string, options: { outline?: string; previousRequests?: readonly string[]; resolution?: string } = {}): string {
  const tail = `${options.previousRequests?.length ? `\n\n## Earlier requests\n${options.previousRequests.map((item) => `- ${item}`).join("\n")}` : ""}${options.resolution ? `\n\n${options.resolution}` : ""}\n\n## Request\n${request.slice(0, 4_000)}`;
  const room = AI_TASK_LIMITS.scene_concept.maxInputChars - CONCEPT_SYSTEM_PROMPT.length - tail.length - 100;
  const outline = options.outline ? `## Scene outline\n${options.outline.length > room ? `${options.outline.slice(0, Math.max(0, room - 40))}\n[Outline truncated.]` : options.outline}` : "## Scene\nEmpty: this is the first build.";
  return `${outline}${tail}`;
}

/** The concept plan in a model reply, or null when it is unusable. */
export function parseConcept(value: unknown): ConceptPlan | null {
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply.complexity !== "number" || !Number.isFinite(reply.complexity)) return null;
  const imagePrompt = typeof reply.imagePrompt === "string" ? reply.imagePrompt.trim().slice(0, AI_TASK_LIMITS.scene_image.maxInputChars) : "";
  return {
    creates: reply.creates === true,
    complexity: Math.round(Math.min(10, Math.max(1, reply.complexity))),
    subject: typeof reply.subject === "string" ? reply.subject.trim().slice(0, 120) : "",
    imagePrompt
  };
}

/** True when the plan deserves a reference image. */
export const wantsReference = (plan: ConceptPlan) => plan.creates && plan.complexity >= REFERENCE_MIN_COMPLEXITY && plan.imagePrompt.length > 0;

export const REFERENCE_SPEC_SYSTEM_PROMPT = `You turn a concept image into a written build spec for a 3D builder who cannot see the image. The builder models with primitive shapes (box, sphere, cylinder, cone, torus, wedge, capsule, bevelled box, hollow and arc variants) in meters, Y up, front facing +z.

From the player's request and the image, write the spec:
1. Overall: what it is, its real-world size (width x height x depth in meters) and the style.
2. Components, largest first: for each, its name, the primitive shape(s) to model it with, approximate size in meters, where it sits relative to the whole (left/right, front/back, height above the ground), its color as a hex code, and its material (wood, metal, glass, fabric, plastic, stone...).
3. Repeated parts with their counts and spacing (legs, windows, slats, wheels, balloons).
4. Signature features that make it recognizable; never leave these out.
5. For a scene: every object with its position on the floor plan (x right, z toward the viewer, origin at the center) and what stands on or against what.
Describe only what the image shows that the request needs; the request wins where they disagree. Be concrete and dense; no prose about the image itself. Under ${MAX_SPEC_CHARS} characters.

Return only JSON: {"spec": string}`;

export const REFERENCE_SPEC_JSON_SCHEMA = {
  name: "scene_reference",
  strict: true,
  schema: {
    type: "object",
    properties: { spec: { type: "string" } },
    required: ["spec"],
    additionalProperties: false
  }
};

/** The vision call that writes the build spec from the concept image. */
export function referenceSpecMessages(request: string, subject: string, image: string): VisionChatMessage[] {
  const content: ChatContentPart[] = [
    { type: "text", text: `## Player's request\n${request.slice(0, 4_000)}\n\n## Image subject\n${subject || "(see the request)"}\n\nImage 1: the concept image.` },
    { type: "image_url", image_url: { url: image, detail: "high" } }
  ];
  return [{ role: "system", content: REFERENCE_SPEC_SYSTEM_PROMPT }, { role: "user", content }];
}

/** The spec in a model reply, or null when it is empty. */
export function parseReferenceSpec(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const spec = (value as Record<string, unknown>).spec;
  return typeof spec === "string" && spec.trim() ? spec.trim().slice(0, MAX_SPEC_CHARS) : null;
}

/** The spec as a builder prompt section. */
export function referenceText(spec: string): string {
  return `## Reference concept (a concept image was drawn for this request; model what it shows)\nThe spec below describes the image. Match its components, proportions, colors, counts and signature features with primitive shapes; the request wins where they disagree.\n${spec}`;
}
