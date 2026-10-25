/** Compact modeling guidance; every character is sent on every call. Rules state principles; examples are illustrations. */
export const MODELING_RULES = `## Modeling well
- Real-world sizes in meters (door 2 m tall, chair seat 0.45 m high, car 4.2×1.8×1.4 m, adult 1.7 m). Default box is 1 m, so box scale = its size.
- Spend detail in this order: (1) every object the request implies, (2) props and clutter that make it lived-in, (3) only then extra features on one object. Each object gets its defining feature (door: knob; bed: pillow + headboard); 6–20 parts per object in ops (repeated books, leaves, bricks: up to 60). If the reply would run long, use fewer parts per object, never fewer objects.
- Detail must show from the default camera: no part under 5 cm on every side (the checker flags specks), no decorative lines, stitching or buttons.
- Every part touches or overlaps a neighbor by ~0.02 m. Position is the center; a group's lowest point is at y=0.
- Cylinders stand along Y: wheels of a car along X use rotation [90,0,0] (axle along Z); along Z use [0,0,90]. Cones for roofs, capsules for limbs, squashed spheres (scale [1,0.6,1]) for domes/hair. Lampshades are truncated cones (radiusTop < radius), wide end down.
- Every held floating object (balloons, kites) MUST have a thin cylinder (radius 0.01) to its anchor; the checker flags any without one. Hanging lamps/signs hang from a cord.
- Buildings: fill gables with a wedge; multi-floor buildings need stairs or a ladder.
- Y must hold existing objects ("put X inside Y", "build Y around X"): size Y to their combined bounds + ≥0.5 m clearance on every side and above the tallest, centered on them; move each in with {"op":"update","id":…,"parent":Y,"components":{}} (no Transform keeps world position).
- Surfaces and containers meant to hold things are never empty: fill them with items varied in size, color and angle, some leaning or stacked (e.g. 5–8 books on a shelf, 2–4 props on a table). Every shelf level gets items, including the top one.
- Anything that gives off light (lamp, candle, fire, screen, window, sign) gets a Light child at its glowing point, and the glowing part gets emissive with emissiveIntensity 1–3. Every point/spot Light belongs to such a visible source, never floating bare (daylight: one directional sun).
- The mood of the request sets the lighting: warm/cozy/night = warm light (#ffb070–#ffd6a0), low ambient (~0.3), dark background; bright/clean/day = white light, ambient 0.6–1, light background; eerie = cold dim light.
- Spaces: an interior (room, corner, nook, kitchen, shop) has a floor and at least two walls that meet; an exterior has a ground surface. Floor/ground = the content's footprint + about 1 m; furniture fills it, never a big empty room around one object. Cluster pieces around a focal piece (within ~1.5 m).
- Mirror symmetric parts exactly: same y/z, negated x (or negated z for left/right of a car along X).
- 2–4 related colors per object.
- Material: metal metalness 0.8 roughness 0.3; glass opacity 0.4 roughness 0.1; lamps emissive color + emissiveIntensity 1–3; gloss paint roughness 0.35; wood/cloth metalness 0, roughness 0.6–0.9.
- Write "plan" first: parts with sizes and local positions, then build exactly that.`;

export interface FewShotExample {
  request: string;
  reply: { plan: string; summary: string; ops: unknown[]; detail?: unknown[] };
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
const eye = { shape: "sphere", radius: 0.025 };
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
    request: "a cozy bedroom",
    reply: {
      plan: "Room 4x4, floor top y0, walls meet at back-left. Rug and walls in ops; bed against the back wall is the focal piece, nightstand with lamp to its left, dresser to its right, wardrobe on the left wall, plant by the dresser, each in detail. Warm: dark background, ambient 0.3.",
      summary: "Laid out a cozy bedroom; the bed, nightstand, dresser, wardrobe and plant are built in detail.",
      ops: [{ op: "settings", settings: { background: "#1a1512", ambientLightIntensity: 0.3 } },
      { op: "assemble", id: "bedroom", name: "Bedroom", parent: null, parts: [
        part("br_floor", "Floor", box, [0, -0.02, 0], { color: "#7a5a3c" }, [4, 0.04, 4]),
        part("br_wall_back", "Back Wall", box, [0, 1.3, -1.95], { color: "#d9c7b0" }, [4, 2.6, 0.1]),
        part("br_wall_left", "Left Wall", box, [-1.95, 1.3, 0], { color: "#d9c7b0" }, [0.1, 2.6, 4]),
        part("br_rug", "Rug", box, [0.2, 0.005, 0.5], { color: "#9c4a3a" }, [1.8, 0.01, 1.2])
      ] }],
      detail: [
        { id: "bed", name: "Bed", description: "double bed: wooden frame with a tall padded headboard, mattress, duvet with a folded top edge, two pillows, a knitted throw across the foot, short tapered legs", position: [0.2, 0, -0.85], size: [1.6, 1.1, 2.1] },
        { id: "nightstand", name: "Nightstand", description: "nightstand with a drawer and round knob; on top a small lamp (fabric shade, warm emissive bulb with its Light), a paperback and a water glass", position: [-0.95, 0, -1.6], size: [0.5, 0.95, 0.4] },
        { id: "dresser", name: "Dresser", description: "three-drawer oak dresser with brass pulls and a plinth; a mirror leaning on top, perfume bottles and a jewelry box", position: [1.5, 0, -1.65], size: [0.9, 1.5, 0.45] },
        { id: "wardrobe", name: "Wardrobe", description: "two-door wardrobe with panel doors, long handles, a cornice and a hatbox on top", position: [-1.65, 0, 0.6], rotation: [0, 90, 0], size: [1, 2.1, 0.55] },
        { id: "plant", name: "Plant", description: "fiddle-leaf fig in a ribbed ceramic pot: trunk, a dozen broad leaves at varied angles", position: [1.6, 0, 0.4], size: [0.5, 1.3, 0.5] }
      ]
    }
  }
];

export interface LibraryExample extends FewShotExample {
  /** Word starts that make this example relevant to a request ("insid" matches inside/insides). */
  tags: readonly string[];
  /** The piece the rest of an interior clusters around. */
  focal?: string;
  /** Shown for an empty-scene request that matches no example, to demonstrate a whole composition. */
  fallback?: boolean;
}

const stone = { color: "#7a776f" };
const bark = { color: "#5a3b22" };
const pine = { color: "#1f3d2b" };
const counterWood = { color: "#9a6b3f" };

/**
 * Worked examples sent only with requests they are relevant to (see selectExamples), so the library can grow
 * without growing the cached system prompt. Each shows the modeling rules as a whole composition.
 */
export const EXAMPLE_LIBRARY: readonly LibraryExample[] = [
  {
    request: "a small two-story house",
    tags: ["house", "home", "cottage", "cabin", "building", "barn", "villa", "story", "storey", "roof", "tower", "chalet"],
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
  },
  {
    request: "a cozy reading corner",
    tags: ["room", "corner", "nook", "interior", "insid", "indoor", "living", "bedroom", "kitchen", "library", "study", "office", "furni", "decorat", "shelf", "shelv", "lamp", "cozy", "cosy"],
    focal: "armchair",
    reply: {
      plan: "Floor 3 wide x 2.4 deep (z -1.5..0.9, the furniture + ~1 m) top y0; walls 0.1 thick meet at back-left (z-1.45, x-1.45). Focal armchair x-0.55 z-0.85; shelf on back wall x0.6: 2 rows of 5 varied books (one leaning, one stack), plant+box on top; side table x0.1 z-0.6 with hollow mug (coffee disc, torus handle)+book; floor lamp x-1.15 z-1.1, shade wide end down, warm point light inside; dark background, ambient 0.3.",
      summary: "Built a cozy reading corner with an armchair, a filled bookshelf, a side table and a warm floor lamp.",
      ops: [{ op: "settings", settings: { background: "#1d1712", ambientLightIntensity: 0.3 } },
      { op: "assemble", id: "corner", name: "Corner", parent: null, parts: [
        part("floor", "Floor", box, [0, -0.02, -0.3], { color: "#6b4630" }, [3, 0.04, 2.4]),
        part("wall_back", "Back Wall", box, [0, 1.2, -1.45], sage, [3, 2.4, 0.1]),
        part("wall_left", "Left Wall", box, [-1.45, 1.2, -0.3], sage, [0.1, 2.4, 2.4])
      ] },
      { op: "assemble", id: "armchair", name: "Armchair", parent: null, transform: { position: [-0.55, 0, -0.85] }, parts: [
        part("ac_seat", "Seat", box, [0, 0.225, 0], fabric, [0.8, 0.45, 0.75]),
        part("ac_back", "Back", box, [0, 0.75, -0.3], fabric, [0.8, 0.6, 0.15]),
        part("ac_arm", "Arm", box, [-0.34, 0.575, 0], fabric, [0.12, 0.25, 0.75]),
        part("ac_cushion", "Cushion", { radius: 0.28, height: 0.1, bevel: 0.04 }, [0, 0.5, 0.07], cream)
      ] },
      { op: "repeat", source: "ac_arm", idPrefix: "ac_arm", name: "Arm", count: 1, step: [0.68, 0, 0] },
      { op: "assemble", id: "shelf", name: "Bookshelf", parent: null, transform: { position: [0.6, 0, -1.22] }, parts: [
        part("sh_side", "Side", box, [-0.38, 0.8, 0], walnut, [0.04, 1.6, 0.32]),
        part("sh_board", "Board", box, [0, 0.02, 0], walnut, [0.72, 0.04, 0.32]),
        { id: "sh_books", name: "Books", components: { Transform: { position: [0, 0.04, 0] } } },
        ...[[-0.3, 0.06, 0.26, red], [-0.23, 0.07, 0.3, green], [-0.16, 0.05, 0.22, cream]]
          .map(([x, w, h, color], i) => ({ ...part(`sh_b${i + 1}`, "Book", box, [x as number, (h as number) / 2, 0], color as Fields, [w as number, h as number, 0.22]), parent: "sh_books" })),
        { ...part("sh_b4", "Leaning Book", box, [-0.07, 0.125, 0], green, [0.05, 0.26, 0.22], [0, 0, -15]), parent: "sh_books" },
        { ...part("sh_b5", "Book Stack", box, [0.1, 0.025, 0], red, [0.22, 0.05, 0.16]), parent: "sh_books" },
        part("sh_pot", "Plant Pot", { shape: "cylinder", radius: 0.07, radiusTop: 0.09, height: 0.14 }, [-0.2, 1.67, 0], cream),
        part("sh_plant", "Plant", { shape: "sphere", radius: 0.12 }, [-0.2, 1.84, 0], green),
        part("sh_box", "Box", box, [0.15, 1.65, 0], red, [0.18, 0.1, 0.14])
      ] },
      { op: "repeat", source: "sh_side", idPrefix: "sh_side", name: "Side", count: 1, step: [0.76, 0, 0] },
      { op: "repeat", source: "sh_board", idPrefix: "sh_board", name: "Board", count: 2, step: [0, 0.78, 0] },
      { op: "repeat", source: "sh_books", idPrefix: "sh_books", name: "Books", count: 1, step: [0, 0.78, 0] },
      { op: "assemble", id: "side_table", name: "Side Table", parent: null, transform: { position: [0.1, 0, -0.6] }, parts: [
        part("st_top", "Top", { shape: "cylinder", radius: 0.22, height: 0.04 }, [0, 0.56, 0], wood),
        part("st_stem", "Stem", { shape: "cylinder", radius: 0.03, height: 0.52 }, [0, 0.28, 0], wood),
        part("st_foot", "Foot", { shape: "cylinder", radius: 0.15, height: 0.03 }, [0, 0.015, 0], wood),
        part("st_mug", "Mug", { shape: "cylinder", radius: 0.04, height: 0.09, hollow: 0.85 }, [0.09, 0.625, 0.05], cream),
        part("st_coffee", "Coffee", { shape: "cylinder", radius: 0.035, height: 0.01 }, [0.09, 0.64, 0.05], dark),
        part("st_handle", "Handle", { shape: "torus", radius: 0.025, height: 0.012 }, [0.15, 0.625, 0.05], cream),
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
    request: "a fruit stall at a sunny market",
    tags: ["market", "stall", "stand", "shop", "store", "vendor", "fruit", "produce", "counter", "street", "sunny", "bright", "daytime", "outdoor", "garden", "park", "yard", "plaza", "square"],
    fallback: true,
    reply: {
      plan: "Paving 5x4 top y0. Stall at origin facing +Z: counter 2x0.9x0.8, top board 2.1x0.05x0.9 (top y0.95), posts r0.04 h2.2 at x±0.95 z-0.35, red awning tilted 15°. Produce on the board: 2 apples, orange, squashed melon, crate with an orange stacked on it. White sun, bright sky, ambient 0.8.",
      summary: "Built a fruit stall in a sunny market square, its counter stocked with fruit and a crate.",
      ops: [{ op: "settings", settings: { background: "#cfe6f5", ambientLightIntensity: 0.8 } },
      { op: "assemble", id: "square", name: "Market Square", parent: null, parts: [
        part("paving", "Paving", box, [0, -0.02, 0], { color: "#b9b2a5" }, [5, 0.04, 4]),
        { id: "sun", name: "Sun", components: { Transform: { position: [0, 6, 0], rotation: [-35, 0, 25] }, Light: { type: "directional", color: "#ffffff", intensity: 2.5 } } }
      ] },
      { op: "assemble", id: "stall", name: "Fruit Stall", parent: null, parts: [
        part("stall_counter", "Counter", box, [0, 0.45, 0], counterWood, [2, 0.9, 0.8]),
        part("stall_top", "Counter Top", box, [0, 0.925, 0], { color: "#c49a6c" }, [2.1, 0.05, 0.9]),
        part("stall_post", "Post", { shape: "cylinder", radius: 0.04, height: 2.2 }, [-0.95, 1.1, -0.35], counterWood),
        part("stall_awning", "Awning", box, [0, 2.25, 0], { color: "#c8423a" }, [2.3, 0.05, 1.3], [15, 0, 0])
      ] },
      { op: "repeat", source: "stall_post", idPrefix: "stall_post", name: "Post", count: 1, step: [1.9, 0, 0] },
      { op: "assemble", id: "produce", name: "Produce", parent: null, parts: [
        part("fruit_apple1", "Apple", { shape: "sphere", radius: 0.08 }, [-0.8, 1.03, 0.1], { color: "#b8322a" }),
        part("fruit_apple2", "Apple", { shape: "sphere", radius: 0.07 }, [-0.62, 1.02, 0.18], { color: "#b8322a" }),
        part("fruit_orange1", "Orange", { shape: "sphere", radius: 0.085 }, [-0.45, 1.035, 0.05], { color: "#e8892b" }),
        part("fruit_melon", "Melon", { shape: "sphere", radius: 0.14 }, [-0.12, 1.09, 0.05], { color: "#5f8f3e" }, [1.3, 1, 1]),
        part("fruit_crate", "Crate", box, [0.35, 1.04, 0.05], counterWood, [0.4, 0.18, 0.3]),
        part("fruit_orange2", "Orange", { shape: "sphere", radius: 0.085 }, [0.35, 1.215, 0.05], { color: "#e8892b" })
      ] }]
    }
  },
  {
    request: "a campfire at night in a forest clearing",
    tags: ["camp", "fire", "bonfire", "night", "forest", "woods", "tree", "clearing", "tent", "dark", "moon", "evening", "snow", "winter"],
    reply: {
      plan: "Ground 6 wide x 4.5 deep (z -2.85..1.65, the clearing + ~1 m) top y0. Fire at origin: stone ring r0.5 (top 0.45) h0.12; two crossed logs r0.06 h0.8 at y0.18 and y0.29; flame cone r0.16 h0.45 y0.5, emissive, warm point light inside. Log bench r0.16 along Z at x1.4. Pines (trunk + cone) at x-1.9 z-1.6 and a copy 3.6 m right. Night: dark blue background, ambient 0.25.",
      summary: "Built a campfire in a forest clearing at night, with a glowing fire, a log bench and two pines.",
      ops: [{ op: "settings", settings: { background: "#0b1020", ambientLightIntensity: 0.25 } },
      { op: "assemble", id: "clearing", name: "Clearing", parent: null, parts: [
        part("ground", "Ground", box, [0, -0.02, -0.6], { color: "#3b4a2f" }, [6, 0.04, 4.5])
      ] },
      { op: "assemble", id: "campfire", name: "Campfire", parent: null, parts: [
        part("fire_ring", "Stone Ring", { shape: "cylinder", radius: 0.5, radiusTop: 0.45, height: 0.12 }, [0, 0.06, 0], stone),
        part("fire_log1", "Log", limb(0.06, 0.8), [0, 0.18, 0], bark, undefined, [0, 0, 90]),
        part("fire_log2", "Log", limb(0.06, 0.8), [0, 0.29, 0], bark, undefined, [90, 0, 0]),
        part("fire_flame", "Flame", { shape: "cone", radius: 0.16, height: 0.45 }, [0, 0.5, 0], { color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 2.5 }),
        { id: "fire_light", name: "Fire Light", components: { Transform: { position: [0, 0.5, 0] }, Light: { color: "#ff9a40", intensity: 4 } } }
      ] },
      { op: "assemble", id: "bench", name: "Log Bench", parent: null, parts: [
        part("bench_log", "Log", limb(0.16, 1.3), [1.4, 0.16, 0.2], bark, undefined, [90, 0, 0])
      ] },
      { op: "assemble", id: "pine", name: "Pine", parent: null, transform: { position: [-1.9, 0, -1.6] }, parts: [
        part("pine_trunk", "Trunk", { shape: "cylinder", radius: 0.12, height: 1.2 }, [0, 0.6, 0], bark),
        part("pine_top", "Foliage", { shape: "cone", radius: 0.7, height: 1.8 }, [0, 2, 0], pine)
      ] },
      { op: "repeat", source: "pine", idPrefix: "pine", name: "Pine", count: 1, step: [3.6, 0, -0.2] }]
    }
  }
];

/** "## Examples" text: one compact JSON response per request. */
export function examplesText(examples: readonly FewShotExample[], heading = "## Examples"): string {
  return [heading, ...examples.map((example) => `Request: "${example.request}"\nResponse: ${JSON.stringify(example.reply)}`)].join("\n");
}

/** The object-modeling examples in the cached system prompt. */
export function fewShotText(): string {
  return examplesText(FEW_SHOT_EXAMPLES);
}

/**
 * Up to two library examples for a request, most matching tags first (ties keep library order). An empty-scene
 * request that matches none still gets the fallback composition, since it has to build a whole scene.
 */
export function selectExamples(request: string, emptyScene: boolean): LibraryExample[] {
  const words = request.toLowerCase().match(/[a-z]+/g) ?? [];
  const scored = EXAMPLE_LIBRARY.map((example, index) => ({ example, index, score: example.tags.filter((tag) => words.some((word) => word.startsWith(tag))).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .map((entry) => entry.example);
  if (!scored.length && emptyScene) return EXAMPLE_LIBRARY.filter((example) => example.fallback);
  return scored;
}
