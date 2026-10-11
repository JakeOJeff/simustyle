import { untrack } from "svelte";
import type { Scene } from "../../scene/types";

/** What the editor looks like right now, published by App so tutorial steps can check what the user did. */
export interface EditorSnapshot {
  mode: "select" | "translate" | "rotate" | "scale";
  space: "world" | "local";
  snap: boolean;
  gridVisible: boolean;
  playState: "stopped" | "playing" | "paused";
  selectedIds: string[];
  panelOpen: Record<string, boolean>;
  scene: Scene;
  timelineTime: number;
  activeTab: string;
  desktop: boolean;
}

/** A discrete editor action, such as "undo" or "camera-orbit", with optional details. */
export interface TutorialEvent {
  type: string;
  detail: Record<string, unknown>;
}

const progressKey = "simustyle.tutorialProgress.v1";

class TutorialState {
  /** The chapter being followed, or null when no guide is running. */
  chapterId = $state<string | null>(null);
  stepIndex = $state(0);
  /** Completed step indexes per chapter, persisted on this device. */
  progress = $state<Record<string, number[]>>({});
  snapshot = $state.raw<EditorSnapshot | null>(null);
  /** The editor as it was when the current step began. */
  start = $state.raw<EditorSnapshot | null>(null);
  /** Which of the current step's tasks are done. Tasks stay done once completed. */
  taskDone = $state<boolean[]>([]);
  /** Actions since the current step began. Cleared whenever the step changes. */
  events = $state.raw<TutorialEvent[]>([]);

  loadProgress(stepCounts: Record<string, number>): void {
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey) ?? "{}") as Record<string, unknown>;
      const valid: Record<string, number[]> = {};
      for (const [id, count] of Object.entries(stepCounts)) {
        const entries = saved[id];
        if (Array.isArray(entries)) valid[id] = [...new Set(entries.filter((step): step is number => typeof step === "number" && Number.isInteger(step) && step >= 0 && step < count))];
      }
      this.progress = valid;
    } catch {
      this.progress = {};
    }
  }

  saveProgress(): void {
    try {
      localStorage.setItem(progressKey, JSON.stringify(this.progress));
    } catch {
      // Tutorial steps remain usable when browser storage is unavailable.
    }
  }

  goTo(chapterId: string | null, stepIndex = 0): void {
    this.chapterId = chapterId;
    this.stepIndex = stepIndex;
    this.taskDone = [];
    this.start = this.snapshot;
    this.events = [];
  }

  markDone(chapterId: string, stepIndex: number): void {
    const steps = new Set(this.progress[chapterId] ?? []);
    steps.add(stepIndex);
    this.progress = { ...this.progress, [chapterId]: [...steps].sort((a, b) => a - b) };
    this.saveProgress();
  }

  resetProgress(): void {
    this.progress = {};
    this.goTo(null);
    this.saveProgress();
  }
}

export const tutorial = new TutorialState();

/** Record an editor action for the running tutorial step. Does nothing when no guide is running. */
export function emitTutorial(type: string, detail: Record<string, unknown> = {}): void {
  // untrack: callers may run inside an effect, which must not start depending on the event log.
  untrack(() => {
    if (!tutorial.chapterId) return;
    tutorial.events = [...tutorial.events, { type, detail }].slice(-200);
  });
}

export function publishEditorSnapshot(snapshot: EditorSnapshot): void {
  tutorial.snapshot = snapshot;
}
