/** Compact modeling guidance; every character is sent on every call. */
export const MODELING_RULES = `## Modeling well
- Real-world sizes in meters (door 2 m tall, chair seat 0.45 m high, car 4.2×1.8×1.4 m, adult 1.7 m). Default box is 1 m, so box scale = its size.
- Build the 3–6 most recognizable features first, then details; 6–20 parts per object (repeated small items like balloons, books, leaves, bricks: up to 60).
- Every part is recognizable on its own: give it its defining feature (door: knob; fridge: handle + split line; table: legs; bed: pillow + headboard).
- Every part touches or overlaps a neighbor by ~0.02 m; no floating parts. Position is the center: put the group's lowest point at y=0.
- Shape with rotation/scale. Cylinders stand along Y: wheels of a car whose length runs along X use rotation [90,0,0] (axle along Z); along Z use [0,0,90]. Cones for roofs, capsules for limbs, squashed spheres (scale [1,0.6,1]) for domes/hair. Lampshades are truncated cones (radiusTop < radius), wide end down.
- Anything that hangs or floats on purpose (balloons, kites, lamps) is attached with a thin cylinder (radius 0.01) to what holds it.
- Buildings: fill gables with a wedge; multi-floor buildings need stairs or a ladder.
- Shelves, tables and counters are never empty: shelves get rows of 5–8 items varied in height, width and color, some leaning or stacked; tables get 2–4 small props.
- Light sources (lamps, candles, fireplaces, windows) get a Light child at the bulb or flame; the shade/bulb/flame gets emissive with emissiveIntensity 1–3.
- Mood sets lighting: "cozy"/"warm" = light color #ffb070–#ffd6a0, ambientLightIntensity ~0.3, dark background; "bright"/"clean" = white light, higher ambient.
- "Corner", "nook" or "room" means at least two walls meeting; group furniture within 1.5 m of the focal piece instead of spreading it evenly.
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
const skin = { color: "#e0b48a" };
const shirt = { color: "#3b6ea5" };
const pants = { color: "#2b3a55" };
const dark = { color: "#2a1d14" };
const limb = (radius: number, height: number) => ({ shape: "capsule", radius, height });
const eye = { shape: "sphere", radius: 0.02 };
const wall = { color: "#e8dcc4" };
const roof = { color: "#7a2e24", roughness: 0.8 };
const glass = { color: "#b8c4cc", opacity: 0.4, roughness: 0.1 };
const metal = { color: "#b8c4cc", metalness: 0.8, roughness: 0.3 };
const knob = { shape: "sphere", radius: 0.04 };
const sage = { color: "#8fa58a" };
const fabric = { color: "#7d9a78" };
const cream = { color: "#e8dcc4" };
const walnut = { color: "#5a3d26" };
const red = { color: "#9c3b2e" };
const green = { color: "#4f6b4a" };
const iron = { color: "#3a2e26", metalness: 0.8, roughness: 0.3 };

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
    request: "a cozy reading corner",
    reply: {
      plan: "Floor 3x3 top y0; walls 0.1 thick meet at back-left (z-1.45, x-1.45). Focal armchair at x-0.55 z-0.85; shelf on back wall x0.6 with 2 rows of 5 varied books (one leaning, one stack); side table x0.1 z-0.6 with mug+book; floor lamp x-1.15 z-1.1, cone shade wide end down, warm point light inside; dark background, ambient 0.3.",
      summary: "Built a cozy reading corner with an armchair, a filled bookshelf, a side table and a warm floor lamp.",
      ops: [{ op: "settings", settings: { background: "#1d1712", ambientLightIntensity: 0.3 } },
      { op: "assemble", id: "corner", name: "Corner", parent: null, parts: [
        part("floor", "Floor", box, [0, -0.02, 0], { color: "#6b4630" }, [3, 0.04, 3]),
        part("wall_back", "Back Wall", box, [0, 1.2, -1.45], sage, [3, 2.4, 0.1]),
        part("wall_left", "Left Wall", box, [-1.45, 1.2, 0], sage, [0.1, 2.4, 3])
      ] },
      { op: "assemble", id: "armchair", name: "Armchair", parent: null, transform: { position: [-0.55, 0, -0.85] }, parts: [
        part("ac_seat", "Seat", box, [0, 0.225, 0], fabric, [0.8, 0.45, 0.75]),
        part("ac_back", "Back", box, [0, 0.75, -0.3], fabric, [0.8, 0.6, 0.15]),
        part("ac_arm", "Arm", box, [-0.34, 0.575, 0], fabric, [0.12, 0.25, 0.75]),
        part("ac_cushion", "Cushion", box, [0, 0.5, 0.07], cream, [0.56, 0.1, 0.55])
      ] },
      { op: "repeat", source: "ac_arm", idPrefix: "ac_arm", name: "Arm", count: 1, step: [0.68, 0, 0] },
      { op: "assemble", id: "shelf", name: "Bookshelf", parent: null, transform: { position: [0.6, 0, -1.22] }, parts: [
        part("sh_side", "Side", box, [-0.38, 0.8, 0], walnut, [0.04, 1.6, 0.32]),
        part("sh_board", "Board", box, [0, 0.02, 0], walnut, [0.72, 0.04, 0.32]),
        { id: "sh_books", name: "Books", components: { Transform: { position: [0, 0.04, 0] } } },
        ...[[-0.3, 0.06, 0.26, red], [-0.23, 0.07, 0.3, green], [-0.16, 0.05, 0.22, cream],]
          .map(([x, w, h, color], i) => ({ ...part(`sh_b${i + 1}`, "Book", box, [x as number, (h as number) / 2, 0], color as Fields, [w as number, h as number, 0.22]), parent: "sh_books" })),
        { ...part("sh_b4", "Leaning Book", box, [-0.07, 0.125, 0], green, [0.05, 0.26, 0.22], [0, 0, -15]), parent: "sh_books" },
        { ...part("sh_b5", "Book Stack", box, [0.1, 0.025, 0], red, [0.22, 0.05, 0.16]), parent: "sh_books" }
      ] },
      { op: "repeat", source: "sh_side", idPrefix: "sh_side", name: "Side", count: 1, step: [0.76, 0, 0] },
      { op: "repeat", source: "sh_board", idPrefix: "sh_board", name: "Board", count: 2, step: [0, 0.78, 0] },
      { op: "repeat", source: "sh_books", idPrefix: "sh_books", name: "Books", count: 1, step: [0, 0.78, 0] },
      { op: "assemble", id: "side_table", name: "Side Table", parent: null, transform: { position: [0.1, 0, -0.6] }, parts: [
        part("st_top", "Top", { shape: "cylinder", radius: 0.22, height: 0.04 }, [0, 0.56, 0], wood),
        part("st_stem", "Stem", { shape: "cylinder", radius: 0.03, height: 0.52 }, [0, 0.28, 0], wood),
        part("st_foot", "Foot", { shape: "cylinder", radius: 0.15, height: 0.03 }, [0, 0.015, 0], wood),
        part("st_mug", "Mug", { shape: "cylinder", radius: 0.04, height: 0.09 }, [0.09, 0.625, 0.05], cream),
        part("st_book", "Book", box, [-0.07, 0.6, -0.03], red, [0.16, 0.04, 0.12], [0, 20, 0])
      ] },
      { op: "assemble", id: "floor_lamp", name: "Floor Lamp", parent: null, transform: { position: [-1.15, 0, -1.1] }, parts: [
        part("fl_foot", "Foot", { shape: "cylinder", radius: 0.15, height: 0.03 }, [0, 0.015, 0], iron),
        part("fl_pole", "Pole", { shape: "cylinder", radius: 0.015, height: 1.4 }, [0, 0.73, 0], iron),
        part("fl_shade", "Shade", { shape: "cone", radius: 0.2, radiusTop: 0.12, height: 0.25 }, [0, 1.5, 0], { color: "#ffd6a0", emissive: "#ffb070", emissiveIntensity: 1.5 }),
        { id: "fl_light", name: "Bulb Light", components: { Transform: { position: [0, 1.45, 0] }, Light: { color: "#ffb070", intensity: 3 } } }
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
  },
  {
    request: "a small two-story house",
    reply: {
      plan: "4x3 m, 2 floors, front +Z: body 4x5x3 y2.5; gable wedge r1 h1.2 x-1 y5.6, mirrored copy x+1; roof slab rot z31 + mirror; door+knob; 2 upper windows; 5 steps up the +X wall to an upper door+knob.",
      summary: "Built a two-story house with a gabled roof and outside stairs.",
      ops: [{ op: "assemble", id: "house", name: "House", parent: null, parts: [
        part("h_body", "Body", box, [0, 2.5, 0], wall, [4, 5, 3]),
        part("h_gable", "Gable", { shape: "wedge", radius: 1, height: 1.2 }, [-1, 5.6, 0], wall, [1, 1, 1.5]),
        part("h_roof", "Roof", box, [-1.02, 5.64, 0], roof, [2.45, 0.08, 3.3], [0, 0, 31]),
        part("h_door", "Door", box, [-0.8, 1, 1.53], wood, [0.9, 2, 0.06]),
        part("h_knob", "Knob", knob, [-0.45, 1, 1.58], metal),
        part("h_win", "Window", box, [-0.9, 3.9, 1.52], glass, [0.9, 0.8, 0.05]),
        part("h_step", "Step", box, [2.4, 0.25, 1.25], wood, [0.8, 0.5, 0.5]),
        part("h_door2", "Upper Door", box, [2.03, 3.5, -1], wood, [0.06, 2, 0.9]),
        part("h_knob2", "Upper Knob", knob, [2.09, 3.5, -0.65], metal)
      ] },
      { op: "repeat", source: "h_gable", idPrefix: "h_gable", name: "Gable", count: 1, step: [2, 0, 0], rotationStep: [0, 180, 0] },
      { op: "repeat", source: "h_roof", idPrefix: "h_roof", name: "Roof", count: 1, step: [2.04, 0, 0], rotationStep: [0, 0, -62] },
      { op: "repeat", source: "h_win", idPrefix: "h_win", name: "Window", count: 1, step: [1.8, 0, 0] },
      { op: "repeat", source: "h_step", idPrefix: "h_steps", name: "Step", count: 4, step: [0, 0.5, -0.5] }]
    }
  }
];

/** The examples formatted for the system prompt, one compact JSON response per request. */
export function fewShotText(): string {
  return ["## Examples", ...FEW_SHOT_EXAMPLES.map((example) => `Request: "${example.request}"\nResponse: ${JSON.stringify(example.reply)}`)].join("\n");
}
