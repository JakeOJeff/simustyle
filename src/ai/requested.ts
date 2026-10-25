import type { Scene } from "../scene/types";

/** Words that never identify an object: articles, counts and filler. */
const FILLER = new Set(["a", "an", "the", "some", "few", "several", "many", "lots", "of", "with", "and", "or", "for", "in", "on", "at", "to", "my", "its", "their",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "pair", "set", "small", "big", "large", "little", "tiny", "huge"]);

/** Lowercase identifying words with common endings removed ("Climbing" and "climber" both become "climb"). */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => !FILLER.has(word))
    .map(stem);
}

/** Drops one common ending when at least 4 letters remain, so "swing" stays "swing" but "swings" loses its s. */
function stem(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  const ending = ["ing", "ers", "er", "es", "s"].find((suffix) => word.endsWith(suffix) && word.length - suffix.length >= 4);
  return ending ? word.slice(0, -ending.length) : word;
}

/** "slid" (slides) and "slide" are the same word; very short stems must match exactly. */
const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

export interface PlannedObject { name: string; parent: string | null }

/**
 * Requested objects (as the model listed them) that nothing in the scene is named for. An object counts as built
 * when one entity's name together with its ancestors' names contains every identifying word of the request, so
 * "pastry case" is met by a "Pastry" inside a "Display Case". Planned detail objects count, since they are built next.
 */
export function missingRequested(scene: Scene, requested: readonly string[], planned: readonly PlannedObject[] = []): string[] {
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const lineage = (name: string, parent: string | null) => {
    const names = [name];
    const seen = new Set<string>();
    for (let next = byId.get(parent ?? ""); next && !seen.has(next.id); next = byId.get(next.parent ?? "")) { seen.add(next.id); names.push(next.name); }
    return words(names.join(" "));
  };
  const named = [...scene.entities.map((entity) => lineage(entity.name, entity.parent)), ...planned.map((item) => lineage(item.name, item.parent))];
  return requested.filter((item) => {
    const wanted = words(item);
    return wanted.length > 0 && !named.some((have) => wanted.every((word) => have.some((other) => same(word, other))));
  }).map((item) => `Requested '${item}' is missing; build it, named for what it is, before any extras.`);
}
