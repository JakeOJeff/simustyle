<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Check, ChevronLeft, ChevronUp, Minus, PartyPopper, SkipForward, X } from "@lucide/svelte";
  import { portal } from "../animation/portal";
  import { chapters, type StepContext } from "./chapters";
  import { emitTutorial, tutorial, type EditorSnapshot, type TutorialEvent } from "./tutorialState.svelte";

  const cardWidth = 300;
  const margin = 12;

  let chapter = $derived(chapters.find((item) => item.id === tutorial.chapterId) ?? null);
  let step = $derived(chapter?.steps[tutorial.stepIndex] ?? null);
  /** Steps the editor cannot detect here: no tasks, or desktop-only steps in the browser. */
  let manual = $derived(!step || step.tasks.length === 0 || (step.desktopOnly === true && tutorial.snapshot?.desktop !== true));
  let currentTask = $derived(step && !manual ? step.tasks.findIndex((_, index) => !tutorial.taskDone[index]) : -1);

  let celebrating = $state(false);
  let chapterComplete = $state(false);
  let minimized = $state(false);
  let targetRect = $state<DOMRect | null>(null);
  let cardPosition = $state<{ left: number; top: number } | null>(null);
  let cardHeight = $state(190);
  /** Bumped while a guide runs so DOM-based checks (`visible`) re-evaluate. */
  let domTick = $state(0);
  let advanceTimer = 0;
  let previous: EditorSnapshot | null = null;

  onMount(() => {
    tutorial.loadProgress(Object.fromEntries(chapters.map((item) => [item.id, item.steps.length])));
    let queued = false;
    const schedule = () => {
      if (queued || !tutorial.chapterId) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; updateTarget(); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "aria-expanded"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const timer = window.setInterval(schedule, 300);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(timer);
      window.clearTimeout(advanceTimer);
    };
  });

  // Turn editor state changes into actions the steps can look for.
  $effect(() => {
    const now = tutorial.snapshot;
    const running = tutorial.chapterId !== null;
    const before = previous;
    previous = now;
    if (!now || !before || !running) return;
    if (now.space !== before.space) emitTutorial("space", { space: now.space });
    if (now.snap !== before.snap) emitTutorial("snap", { on: now.snap });
    if (now.gridVisible !== before.gridVisible) emitTutorial("grid", { on: now.gridVisible });
    if (now.scene.settings.collisions !== before.scene.settings.collisions) emitTutorial("collisions", { on: now.scene.settings.collisions });
    if (now.playState !== before.playState) emitTutorial("play-state", { state: now.playState });
    if (now.timelineTime !== before.timelineTime && now.playState === "stopped" && before.playState === "stopped") emitTutorial("timeline-time", { time: now.timelineTime });
    for (const [name, open] of Object.entries(now.panelOpen)) if (before.panelOpen[name] !== open) emitTutorial("panel", { name, open });
  });

  // A new step starts with fresh task state.
  $effect(() => {
    void tutorial.chapterId;
    void tutorial.stepIndex;
    untrack(() => {
      window.clearTimeout(advanceTimer);
      celebrating = false;
      chapterComplete = false;
      minimized = false;
    });
  });

  // Check the step's tasks whenever the editor changes; finished tasks stay finished.
  $effect(() => {
    const now = tutorial.snapshot;
    const events = tutorial.events;
    void domTick;
    if (!step || manual || !now || !chapter) return;
    const start = untrack(() => tutorial.start);
    if (!start) { untrack(() => tutorial.start = now); return; }
    const context = makeContext(start, now, events);
    const results = step.tasks.map((task) => {
      try { return task.done(context); } catch { return false; }
    });
    untrack(() => {
      const done = step!.tasks.map((_, index) => tutorial.taskDone[index] === true || results[index] === true);
      if (done.some((value, index) => value !== (tutorial.taskDone[index] === true))) tutorial.taskDone = done;
      if (done.every(Boolean) && !celebrating && !chapterComplete) completeStep();
    });
  });

  function makeContext(start: EditorSnapshot, now: EditorSnapshot, events: TutorialEvent[]): StepContext {
    return {
      start, now, events,
      happened: (type, test) => events.some((event) => event.type === type && (!test || test(event.detail))),
      inOrder: (first, then) => {
        const index = events.findIndex((event) => event.type === first);
        const later = Array.isArray(then) ? then : [then];
        return index >= 0 && events.slice(index + 1).some((event) => later.includes(event.type));
      },
      visible: (target) => findTarget([target]) !== null
    };
  }

  function completeStep() {
    if (!chapter) return;
    const chapterId = chapter.id;
    const index = tutorial.stepIndex;
    celebrating = true;
    tutorial.markDone(chapterId, index);
    window.clearTimeout(advanceTimer);
    advanceTimer = window.setTimeout(() => {
      if (tutorial.chapterId !== chapterId || tutorial.stepIndex !== index) return;
      celebrating = false;
      const steps = chapters.find((item) => item.id === chapterId)?.steps.length ?? 0;
      if (index < steps - 1) tutorial.goTo(chapterId, index + 1);
      else chapterComplete = true;
    }, 1100);
  }

  function continueManually() {
    if (!chapter) return;
    tutorial.markDone(chapter.id, tutorial.stepIndex);
    if (tutorial.stepIndex < chapter.steps.length - 1) tutorial.goTo(chapter.id, tutorial.stepIndex + 1);
    else chapterComplete = true;
  }

  function skip() {
    if (!chapter) return;
    if (tutorial.stepIndex < chapter.steps.length - 1) tutorial.goTo(chapter.id, tutorial.stepIndex + 1);
    else chapterComplete = true;
  }

  function nextChapter() {
    const index = chapters.findIndex((item) => item.id === chapter?.id);
    const next = chapters[index + 1];
    if (!next) { tutorial.goTo(null); return; }
    const done = tutorial.progress[next.id] ?? [];
    tutorial.goTo(next.id, Math.max(0, next.steps.findIndex((_, stepIndex) => !done.includes(stepIndex))));
  }

  /** The first on-screen control among these targets. */
  function findTarget(keys: string[]): HTMLElement | null {
    for (const key of keys) {
      for (const element of document.querySelectorAll<HTMLElement>(`[data-tutorial-target="${key}"]`)) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
        if (element.closest(".tutorial-coach")) continue;
        return element;
      }
    }
    return null;
  }

  function highlightKeys(): string[] {
    if (!step || chapterComplete) return [];
    const task = currentTask >= 0 ? step.tasks[currentTask] : undefined;
    return [...(task?.targets ?? []), ...(step.targets ?? [])];
  }

  function overlap(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): number {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }

  /** Put the card beside the highlighted control, away from open menus and dialogs. */
  function placeCard(rect: DOMRect | null): { left: number; top: number } {
    const width = Math.min(cardWidth, window.innerWidth - margin * 2);
    const height = cardHeight;
    const maxLeft = window.innerWidth - width - margin;
    const maxTop = window.innerHeight - height - margin;
    const clampLeft = (value: number) => Math.max(margin, Math.min(value, maxLeft));
    const clampTop = (value: number) => Math.max(margin, Math.min(value, maxTop));
    const corners = [{ left: margin, top: maxTop }, { left: maxLeft, top: maxTop }, { left: maxLeft, top: 56 }];
    if (!rect) return corners[0]!;
    const candidates = [
      { left: clampLeft(rect.left), top: rect.bottom + margin },
      { left: clampLeft(rect.left), top: rect.top - margin - height },
      { left: rect.right + margin, top: clampTop(rect.top) },
      { left: rect.left - margin - width, top: clampTop(rect.top) },
      { left: clampLeft(rect.right - width - 16), top: clampTop(rect.bottom - height - 16) },
      { left: clampLeft(rect.left + 16), top: clampTop(rect.bottom - height - 16) },
      ...corners
    ];
    const obstacles = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], .entity-context-menu, .export-popover')]
      .filter((element) => !element.closest(".tutorial-coach"))
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    const large = rect.width * rect.height > window.innerWidth * window.innerHeight * 0.3;
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const box = { left: candidate.left, top: candidate.top, right: candidate.left + width, bottom: candidate.top + height };
      const offscreen = box.left < margin - 1 || box.top < margin - 1 || box.right > window.innerWidth - margin + 1 || box.bottom > window.innerHeight - margin + 1;
      let score = offscreen ? 1e12 : 0;
      score += overlap(box, rect) * (large ? 0.02 : 4);
      for (const obstacle of obstacles) score += overlap(box, obstacle) * 3;
      score += Math.hypot(candidate.left + width / 2 - (rect.left + rect.width / 2), candidate.top + height / 2 - (rect.top + rect.height / 2)) * (large ? 0 : 0.5);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
    return a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
  }

  function updateTarget() {
    if (!tutorial.chapterId) { targetRect = null; return; }
    domTick += 1;
    const element = findTarget(highlightKeys());
    const rect = element?.getBoundingClientRect() ?? null;
    if (!sameRect(rect, targetRect)) targetRect = rect;
    const position = placeCard(rect);
    if (!cardPosition || cardPosition.left !== position.left || cardPosition.top !== position.top) cardPosition = position;
  }

  $effect(() => {
    void currentTask;
    void tutorial.stepIndex;
    void chapterComplete;
    void cardHeight;
    untrack(updateTarget);
  });

  /** Render `code` spans in instructions. */
  function parts(text: string): { code: boolean; text: string }[] {
    return text.split("`").map((part, index) => ({ code: index % 2 === 1, text: part }));
  }
</script>

{#if chapter && step}
  {#if targetRect && !minimized && !chapterComplete}
    <div class="tutorial-ring" use:portal aria-hidden="true" style={`left:${targetRect.left - 4}px;top:${targetRect.top - 4}px;width:${targetRect.width + 8}px;height:${targetRect.height + 8}px`}></div>
  {/if}
  {#if minimized}
    <button class="tutorial-coach tutorial-pill" use:portal type="button" onclick={() => minimized = false} aria-label="Show tutorial step">
      <ChevronUp size={13} /> {chapter.title} · Step {tutorial.stepIndex + 1}/{chapter.steps.length}
    </button>
  {:else}
    <aside class="tutorial-coach" class:celebrating use:portal aria-live="polite" aria-label="Tutorial step" bind:offsetHeight={cardHeight}
      style={cardPosition ? `left:${cardPosition.left}px;top:${cardPosition.top}px` : "left:12px;bottom:12px"}>
      <header>
        <span>{chapter.title} · {chapterComplete ? "Done" : `Step ${tutorial.stepIndex + 1} of ${chapter.steps.length}`}</span>
        <button type="button" aria-label="Minimize tutorial" title="Minimize" onclick={() => minimized = true}><Minus size={13} /></button>
        <button type="button" aria-label="Exit tutorial" title="Exit tutorial" onclick={() => tutorial.goTo(null)}><X size={13} /></button>
      </header>
      {#if chapterComplete}
        <div class="coach-complete"><PartyPopper size={22} /><div><strong>Chapter complete</strong><p>You've finished {chapter.title}.</p></div></div>
        <div class="coach-actions">
          {#if chapters.findIndex((item) => item.id === chapter.id) < chapters.length - 1}<button type="button" class="primary" onclick={nextChapter}>Next chapter</button>{/if}
          <button type="button" onclick={() => tutorial.goTo(null)}>Close</button>
        </div>
      {:else}
        <h3>{step.title}</h3>
        <p>{#each parts(step.instruction) as part}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</p>
        {#if manual}
          {#if step.desktopOnly && tutorial.snapshot?.desktop !== true}<p class="coach-note">This step needs the SimuStyle desktop app. Read it, then continue.</p>{/if}
        {:else}
          <ul class="coach-tasks">
            {#each step.tasks as task, index}
              <li class:done={tutorial.taskDone[index]} class:current={index === currentTask}>
                <span class="task-mark">{#if tutorial.taskDone[index]}<Check size={11} strokeWidth={3} />{/if}</span>{task.label}
              </li>
            {/each}
          </ul>
        {/if}
        {#if celebrating}
          <p class="coach-success" role="status"><Check size={13} strokeWidth={3} /> Nice! {tutorial.stepIndex < chapter.steps.length - 1 ? "Moving on…" : "Wrapping up…"}</p>
        {:else}
          <div class="coach-actions">
            {#if manual}<button type="button" class="primary" onclick={continueManually}>Continue</button>{/if}
            {#if tutorial.stepIndex > 0}<button type="button" onclick={() => tutorial.goTo(chapter.id, tutorial.stepIndex - 1)}><ChevronLeft size={12} /> Back</button>{/if}
            {#if !manual}<button type="button" onclick={skip}>Skip <SkipForward size={11} /></button>{/if}
          </div>
        {/if}
      {/if}
    </aside>
  {/if}
{/if}

<style>
  .tutorial-ring{position:fixed;z-index:1001;border:2px solid #a99bff;border-radius:8px;box-shadow:0 0 0 9999px #0b0b0d3d,0 0 0 4px #8b7cf655,0 0 18px #a99bff;pointer-events:none;transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease;animation:tutorial-pulse 1.6s ease-in-out infinite}
  @keyframes tutorial-pulse{50%{box-shadow:0 0 0 9999px #0b0b0d2e,0 0 0 8px #8b7cf622,0 0 26px #a99bff}}
  .tutorial-coach{position:fixed;z-index:1002;width:min(300px,calc(100vw - 24px));padding:11px 13px 12px;border:1px solid #a99bff;border-radius:12px;background:#18181b;color:#ececee;box-shadow:0 12px 36px #000a;font:11px/1.5 'DM Sans',sans-serif;transition:left .2s ease,top .2s ease,border-color .2s}
  .tutorial-coach.celebrating{border-color:#6fd39a}
  header{display:flex;align-items:center;gap:4px;color:#a99bff;font:9px 'DM Mono',monospace;letter-spacing:.06em;text-transform:uppercase}
  header span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  header button{display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:none;color:#8f8aa6;cursor:pointer}
  header button:hover{background:#ffffff12;color:#fff}
  h3{margin:6px 0 3px;color:#f8f8f8;font-size:13px;font-weight:600}
  p{margin:0;color:#c3bed4;font-size:10.5px}
  code{padding:0 3px;border-radius:3px;background:#ffffff12;color:#bfe6ff;font:10px 'DM Mono',monospace}
  .coach-note{margin-top:7px;color:#e6c88c}
  .coach-tasks{display:grid;gap:4px;margin:9px 0 0;padding:0;list-style:none}
  .coach-tasks li{display:flex;align-items:center;gap:7px;color:#9c97ad;font-size:10.5px}
  .coach-tasks li.current{color:#f7f7f7;font-weight:600}
  .coach-tasks li.done{color:#8fd4a8;text-decoration:line-through;text-decoration-color:#8fd4a866}
  .task-mark{display:grid;flex:none;place-items:center;width:14px;height:14px;border:1.5px solid #6c6785;border-radius:50%;color:#10241a}
  .current .task-mark{border-color:#a99bff;box-shadow:0 0 0 3px #8b7cf633}
  .done .task-mark{border-color:#6fd39a;background:#6fd39a}
  .coach-success{display:flex;align-items:center;gap:6px;margin-top:10px;color:#8fe0ad;font-weight:600}
  .coach-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
  .coach-actions button{display:inline-flex;align-items:center;gap:4px;height:25px;padding:0 9px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#d4d4d8;font:10px 'DM Sans',sans-serif;cursor:pointer}
  .coach-actions button:hover{background:#2d2d33;color:#fff}
  .coach-actions button.primary{border-color:transparent;background:#7c6cf0;color:#fff;font-weight:600}.coach-actions button.primary:hover{background:#8b7cf6}
  .coach-complete{display:flex;align-items:center;gap:11px;margin-top:9px;color:#8fe0ad}
  .coach-complete strong{color:#f8f8f8;font-size:13px}
  .tutorial-pill{left:12px;bottom:12px;width:auto;display:flex;align-items:center;gap:6px;padding:7px 11px;border-radius:16px;color:#ececee;cursor:pointer}
  @media(prefers-reduced-motion:reduce){.tutorial-ring{animation:none;transition:none}.tutorial-coach{transition:none}}
</style>
