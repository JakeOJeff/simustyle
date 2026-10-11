/** A looping 0..1 progress value for animated previews: plays over `cycle` seconds, then holds for `rest`. */
export class PreviewClock {
  progress = $state(0);
  #frame = 0;
  #start = 0;

  constructor(private cycle = 1.4, private rest = 0.45) {}

  start(): void {
    if (this.#frame || typeof requestAnimationFrame === "undefined") return;
    // Respect reduced motion: show the finished pose instead of looping.
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.progress = 0.62;
      return;
    }
    this.#start = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - this.#start) / 1000) % (this.cycle + this.rest);
      this.progress = Math.min(1, elapsed / this.cycle);
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  restart(): void {
    this.#start = performance.now();
  }

  stop(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}
