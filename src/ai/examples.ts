/** Compact modeling guidance; every character is sent on every call. */
export const MODELING_RULES = `## Modeling well
- Real-world sizes in meters (door 2 m tall, chair seat 0.45 m high, car 4.2×1.8×1.4 m, adult 1.7 m). Default box is 1 m, so box scale = its size.
- Build the 3–6 most recognizable features first, then details; 6–20 parts per object.
- Every part touches or overlaps a neighbor by ~0.02 m; no floating parts. Position is the center: put the group's lowest point at y=0.
- Shape with rotation/scale. Cylinders stand along Y: wheels of a car whose length runs along X use rotation [90,0,0] (axle along Z); along Z use [0,0,90]. Cones for roofs, capsules for limbs, squashed spheres (scale [1,0.6,1]) for domes/hair.
- Mirror symmetric parts exactly: same y/z, negated x (or negated z for left/right of a car along X).
- 2–4 related colors per object.
- Material: metal metalness 0.8 roughness 0.3; glass opacity 0.4 roughness 0.1; lamps emissive color + emissiveIntensity 1–3; gloss paint roughness 0.35; wood/cloth metalness 0, roughness 0.6–0.9.
- Write "plan" first: parts with sizes and local positions, then build exactly that.`;

export interface FewShotExample {
  request: string;
  reply: { plan: string; summary: string; ops: unknown[] };
}

type Vec = [number, number, number];
type Fields = Record<string, unknown>;
/** Compact part builder: omits default rotation/scale so the prompt stays short. */
const part = (id: string, name: string, mesh: Fields, position: Vec, material: Fields, scale?: Vec, rotation?: Vec) => ({
  id, name, components: { Transform: { position, ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) }, Mesh: mesh, Material: material }
});
const box = {};

const paint = { color: "#b3261e", roughness: 0.35 };
const tire = { color: "#1f1f1f" };
const lamp = { color: "#fff4d6", emissive: "#fff4d6", emissiveIntensity: 2 };
const wheel = { shape: "cylinder", radius: 0.35, height: 0.25 };
const axle: Vec = [90, 0, 0];
const wood = { color: "#8b5a2b" };
const leg: Vec = [0.04, 0.45, 0.04];
const skin = { color: "#e0b48a" };
const shirt = { color: "#3b6ea5" };
const pants = { color: "#2b3a55" };
const dark = { color: "#2a1d14" };
const limb = (radius: number, height: number) => ({ shape: "capsule", radius, height });
const eye = { shape: "sphere", radius: 0.02 };

export const FEW_SHOT_EXAMPLES: readonly FewShotExample[] = [
  {
    request: "a red car",
    reply: {
      plan: "Along X: body 4.2x0.6x1.8 y0.65; cabin 2.2x0.55x1.6 x-0.2 y1.2; windshield x0.9; wheels r0.35 rot [90,0,0] x±1.35 y0.35 z±0.8; metal bumper; glowing lamps.",
      summary: "Built a red car with glass, wheels and headlights.",
      ops: [{ op: "assemble", id: "car", name: "Car", parent: null, parts: [
        part("car_body", "Body", box, [0, 0.65, 0], paint, [4.2, 0.6, 1.8]),
        part("car_cabin", "Cabin", box, [-0.2, 1.2, 0], paint, [2.2, 0.55, 1.6]),
        part("car_glass", "Glass", box, [0.9, 1.2, 0], { color: "#b8b8b8", opacity: 0.4, roughness: 0.1 }, [0.06, 0.45, 1.5]),
        part("car_w1", "Wheel FL", wheel, [1.35, 0.35, 0.8], tire, undefined, axle),
        part("car_w2", "Wheel FR", wheel, [1.35, 0.35, -0.8], tire, undefined, axle),
        part("car_w3", "Wheel RL", wheel, [-1.35, 0.35, 0.8], tire, undefined, axle),
        part("car_w4", "Wheel RR", wheel, [-1.35, 0.35, -0.8], tire, undefined, axle),
        part("car_bumper", "Bumper", box, [2.12, 0.45, 0], { color: "#b8b8b8", metalness: 0.8, roughness: 0.3 }, [0.1, 0.15, 1.8]),
        part("car_lamp1", "Lamp L", box, [2.11, 0.75, 0.6], lamp, [0.06, 0.15, 0.35]),
        part("car_lamp2", "Lamp R", box, [2.11, 0.75, -0.6], lamp, [0.06, 0.15, 0.35])
      ] }]
    }
  },
  {
    request: "a wooden chair",
    reply: {
      plan: "seat 0.46x0.05x0.46 y0.455; legs 0.04x0.45x0.04 x±0.2 z±0.2 y0.225; backrest 0.44x0.46x0.04 z-0.21 y0.69; cushion on seat.",
      summary: "Built a wooden chair with a green cushion.",
      ops: [{ op: "assemble", id: "chair", name: "Chair", parent: null, parts: [
        part("chair_seat", "Seat", box, [0, 0.455, 0], wood, [0.46, 0.05, 0.46]),
        part("chair_leg1", "Leg FL", box, [-0.2, 0.225, 0.2], wood, leg),
        part("chair_leg2", "Leg FR", box, [0.2, 0.225, 0.2], wood, leg),
        part("chair_leg3", "Leg BL", box, [-0.2, 0.225, -0.2], wood, leg),
        part("chair_leg4", "Leg BR", box, [0.2, 0.225, -0.2], wood, leg),
        part("chair_back", "Back", box, [0, 0.69, -0.21], wood, [0.44, 0.46, 0.04]),
        part("chair_pad", "Cushion", box, [0, 0.48, 0.01], { color: "#2f5d50" }, [0.42, 0.04, 0.42])
      ] }]
    }
  },
  {
    request: "a simple character",
    reply: {
      plan: "1.65 m, faces +Z: legs r0.08 h0.8 x±0.1 y0.4; torso 0.4x0.6x0.22 y1.08; arms r0.06 h0.65 x±0.24 y1.05; head r0.13 y1.5; squashed hair; eyes.",
      summary: "Built a simple character with capsule limbs.",
      ops: [{ op: "assemble", id: "char", name: "Character", parent: null, parts: [
        part("char_leg1", "Leg L", limb(0.08, 0.8), [-0.1, 0.4, 0], pants),
        part("char_leg2", "Leg R", limb(0.08, 0.8), [0.1, 0.4, 0], pants),
        part("char_torso", "Torso", box, [0, 1.08, 0], shirt, [0.4, 0.6, 0.22]),
        part("char_arm1", "Arm L", limb(0.06, 0.65), [-0.24, 1.05, 0], shirt),
        part("char_arm2", "Arm R", limb(0.06, 0.65), [0.24, 1.05, 0], shirt),
        part("char_head", "Head", { shape: "sphere", radius: 0.13 }, [0, 1.5, 0], skin),
        part("char_hair", "Hair", { shape: "sphere", radius: 0.135 }, [0, 1.57, 0], dark, [1, 0.6, 1]),
        part("char_eye1", "Eye L", eye, [-0.045, 1.53, 0.12], dark),
        part("char_eye2", "Eye R", eye, [0.045, 1.53, 0.12], dark)
      ] }]
    }
  }
];

/** The examples formatted for the system prompt, one compact JSON response per request. */
export function fewShotText(): string {
  return ["## Examples", ...FEW_SHOT_EXAMPLES.map((example) => `Request: "${example.request}"\nResponse: ${JSON.stringify(example.reply)}`)].join("\n");
}
