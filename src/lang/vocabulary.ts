// Word lists for the plain-English commands (move, animate, "the red ball", ...).
// Shared by the parser, checker, runtime, and syntax highlighter so they agree.

export type RelationName = "above" | "below" | "beside" | "left" | "right" | "front" | "behind" | "near";
export type Superlative = "biggest" | "smallest" | "nearest" | "farthest" | "highest" | "lowest";
export type Direction = "up" | "down" | "left" | "right" | "forward" | "back";

export const COMMAND_WORDS = ["move", "glide", "go", "destroy", "delete", "remove", "animate", "stop", "turn", "rotate", "scale", "resize", "grow", "shrink", "paint", "color", "colour", "make", "push", "hide", "show", "say", "print", "create", "spawn"] as const;

/** Statement words that read like sentences: "set score to 0", "wait 1 second", "repeat 3 times". */
export const SENTENCE_WORDS = ["set", "change", "increase", "decrease", "add", "subtract", "wait", "repeat", "forever", "broadcast", "announce", "send", "tell"] as const;

/** Words that start a header line: "when game starts", "every 2 seconds", "forever". */
export const EVENT_WORDS = ["when", "every", "forever", "on"] as const;

/** Readable properties: "my y", "x of the ball", "distance to the player". */
export const PROPERTY_WORDS = ["x", "y", "z", "color", "colour", "size", "name", "distance"] as const;

/** Browser KeyboardEvent.key values mapped to the words scripts use ("when space is pressed"). */
export function keyName(eventKey: string): string {
  const named: Record<string, string> = { " ": "space", arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down", escape: "escape", enter: "enter", shift: "shift", tab: "tab", backspace: "backspace" };
  const lower = eventKey.toLowerCase();
  return named[lower] ?? lower;
}

export const KEY_WORDS = new Set(["space", "enter", "left", "right", "up", "down", "shift", "escape", "tab", "backspace", ..."abcdefghijklmnopqrstuvwxyz".split(""), ..."0123456789".split("")]);

/** Named colors used both for `paint X red` and for matching "the red ball". */
export const COLOR_NAMES: Record<string, string> = {
  red: "#e5484d", orange: "#f76b15", yellow: "#ffd60a", green: "#30a46c", blue: "#3e63dd", cyan: "#00a2c7",
  purple: "#8e4ec6", pink: "#e93d82", brown: "#8d5a3b", white: "#ffffff", black: "#111111", gray: "#8b8d98", grey: "#8b8d98"
};

/** Shape nouns map to Mesh.shape; "light"/"camera" match by component. */
export const SHAPE_NOUNS: Record<string, string> = {
  ball: "sphere", sphere: "sphere", orb: "sphere",
  box: "box", cube: "box", block: "box", crate: "box",
  cylinder: "cylinder", pillar: "cylinder", column: "cylinder", can: "cylinder",
  cone: "cone", capsule: "capsule", pill: "capsule",
  plane: "plane", floor: "plane", platform: "plane",
  light: "Light", lamp: "Light", camera: "Camera"
};

export const ANY_NOUNS = new Set(["one", "thing", "object", "entity", "shape"]);

export const SUPERLATIVES: Record<string, Superlative> = {
  biggest: "biggest", largest: "biggest", big: "biggest", large: "biggest", huge: "biggest",
  smallest: "smallest", tiniest: "smallest", small: "smallest", little: "smallest", tiny: "smallest",
  nearest: "nearest", closest: "nearest", farthest: "farthest", furthest: "farthest",
  highest: "highest", top: "highest", tallest: "highest", lowest: "lowest", bottom: "lowest"
};

/** Filler words skipped inside descriptions: "the ball that is above the box". */
export const FILLER_WORDS = new Set(["that", "which", "is", "sitting", "resting", "placed"]);

export const DIRECTIONS: Record<Direction, [number, number, number]> = {
  up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], forward: [0, 0, -1], back: [0, 0, 1]
};
export const DIRECTION_ALIASES: Record<string, Direction> = {
  up: "up", upward: "up", upwards: "up", down: "down", downward: "down", downwards: "down",
  left: "left", right: "right", forward: "forward", forwards: "forward", ahead: "forward", back: "back", backward: "back", backwards: "back"
};

export type AnimationStyle = "bounce" | "spin" | "float" | "pulse" | "shake" | "wobble" | "sway" | "orbit" | "flash" | "grow" | "shrink" | "tumble";

/** Each style lists the words that select it, so "like a bouncing ball" picks bounce. */
export const ANIMATION_STYLES: Record<AnimationStyle, string[]> = {
  bounce: ["bounce", "bouncing", "bounces", "bouncy", "hop", "hopping", "jump", "jumping", "ball"],
  spin: ["spin", "spinning", "spins", "rotate", "rotating", "twirl", "twirling", "turntable", "top", "record", "wheel"],
  float: ["float", "floating", "floats", "hover", "hovering", "bob", "bobbing", "drift", "drifting", "boat", "balloon", "ghost", "cloud"],
  pulse: ["pulse", "pulsing", "pulses", "breathe", "breathing", "heartbeat", "heart", "throb", "throbbing", "beat", "beating"],
  shake: ["shake", "shaking", "shakes", "vibrate", "vibrating", "tremble", "trembling", "jitter", "jittery", "earthquake", "scared", "nervous", "cold", "shiver", "shivering"],
  wobble: ["wobble", "wobbling", "wobbly", "jiggle", "jiggling", "wiggle", "wiggling", "jelly", "jello", "dance", "dancing"],
  sway: ["sway", "swaying", "swing", "swinging", "pendulum", "rock", "rocking", "tree", "flag"],
  orbit: ["orbit", "orbiting", "circle", "circling", "around", "planet", "moon", "satellite"],
  flash: ["flash", "flashing", "blink", "blinking", "glow", "glowing", "flicker", "flickering", "siren", "alarm", "firefly"],
  grow: ["grow", "growing", "grows", "expand", "expanding", "inflate", "inflating"],
  shrink: ["shrink", "shrinking", "shrinks", "deflate", "deflating", "vanish", "vanishing"],
  tumble: ["tumble", "tumbling", "flip", "flipping", "somersault", "cartwheel", "roll", "rolling", "dice", "asteroid"]
};

export const FAST_WORDS = new Set(["fast", "faster", "quick", "quickly", "rapid", "rapidly", "speedy", "crazy", "frantic", "frantically", "hyper"]);
export const SLOW_WORDS = new Set(["slow", "slowly", "gently", "gentle", "lazy", "lazily", "calm", "calmly", "sleepy", "relaxed"]);
export const BIG_WORDS = new Set(["big", "high", "wild", "wildly", "huge", "lots", "violently", "hard", "strong", "strongly"]);
export const SMALL_WORDS = new Set(["little", "slightly", "subtle", "subtly", "tiny", "softly", "small", "bit"]);

export interface AnimationSpec {
  style: AnimationStyle;
  speed: number;
  amplitude: number;
}

/** Map a plain-English description to a built-in animation, or null if no style word is recognised. */
export function matchAnimation(words: string[]): AnimationSpec | null {
  const lower = words.map((word) => word.toLowerCase().replace(/'s$/, ""));
  // Prefer the most specific word: verbs ("spinning") beat nouns ("ball") when both are present.
  let style: AnimationStyle | null = null;
  let rank = Infinity;
  for (const [candidate, triggers] of Object.entries(ANIMATION_STYLES) as [AnimationStyle, string[]][]) {
    for (const word of lower) {
      const index = triggers.indexOf(word);
      if (index >= 0 && index < rank) { style = candidate; rank = index; }
    }
  }
  if (!style) return null;
  let speed = 1;
  let amplitude = 1;
  const very = lower.includes("very") || lower.includes("super") || lower.includes("really");
  for (const word of lower) {
    if (FAST_WORDS.has(word)) speed = very ? 2.5 : 1.8;
    if (SLOW_WORDS.has(word)) speed = very ? 0.3 : 0.5;
    if (BIG_WORDS.has(word)) amplitude = very ? 2.2 : 1.6;
    if (SMALL_WORDS.has(word)) amplitude = very ? 0.25 : 0.5;
  }
  return { style, speed, amplitude };
}

export const ANIMATION_STYLE_LIST = Object.keys(ANIMATION_STYLES).join(", ");

/** Animation styles that also work as a one-word command: "spin", "bounce slowly", "float the cloud gently". */
export const ANIMATION_VERBS = new Set(["bounce", "spin", "float", "pulse", "shake", "wobble", "sway", "orbit", "flash", "tumble", "hover", "jump", "blink", "glow", "wiggle", "vibrate"]);

/** Words that describe how an animation looks rather than what it acts on. */
export const ANIMATION_MODIFIERS = new Set([...FAST_WORDS, ...SLOW_WORDS, ...BIG_WORDS, ...SMALL_WORDS, "very", "super", "really", "forever", "around", "like", "as", "a", "an"]);
