/** Small, session-only LRU cache. No scene data or prompts are persisted to disk. */
export class BuildCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly capacity = 12, private readonly ttlMs = 5 * 60_000, private readonly now = Date.now) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: T): void {
    if (this.capacity <= 0 || this.ttlMs <= 0) return;
    this.entries.delete(key);
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(id);
    this.entries.set(key, { value: structuredClone(value), expires: this.now() + this.ttlMs });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void { this.entries.clear(); }
}
