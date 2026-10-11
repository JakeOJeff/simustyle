<script lang="ts">
  import { onMount } from "svelte";

  type TutorialStep = { title: string; instruction: string };
  type TutorialChapter = { id: string; title: string; summary: string; steps: TutorialStep[] };

  const chapters: TutorialChapter[] = [
    { id: "workspace", title: "Workspace and navigation", summary: "Move around the scene and arrange the editor.", steps: [
      { title: "Orbit the scene", instruction: "In the Scene view, hold the left mouse button and drag to orbit the camera around your scene." },
      { title: "Pan and zoom", instruction: "Hold the middle mouse button and drag to pan. Use the mouse wheel to zoom in and out." },
      { title: "Arrange editor windows", instruction: "Drag a panel title bar to move it. Snap it near an edge, float it in the center, and resize it from an edge or corner." },
      { title: "Find a panel", instruction: "Use the panel tabs along the bottom to show and hide Hierarchy, Inspector, Console, AI, Timeline, and Docs. Your layout is saved on this device." }
    ] },
    { id: "create-select", title: "Create and select objects", summary: "Add scene objects and place them where you want.", steps: [
      { title: "Add a primitive", instruction: "Choose Add in the top bar and create a Cube or Sphere. Select it in the Scene view or Hierarchy." },
      { title: "Add at the pointer", instruction: "Right-click empty space in the Scene view, open Add, and choose a shape. It is placed at the pointer's ground or surface position." },
      { title: "Add as a child", instruction: "Right-click an object in the Scene view or a row in Hierarchy. Choose Add and create a child object." },
      { title: "Add lights and a camera", instruction: "Use Add to create a Point, Sun, or Spot light and a Camera. Select their wireframe markers; rotate a Sun or Spot light to aim it." },
      { title: "Select several objects", instruction: "Ctrl-drag in the Scene view to box-select. In Hierarchy, Ctrl-click or Shift-click rows to extend the selection." }
    ] },
    { id: "transform", title: "Transform tools", summary: "Move, rotate, scale, and frame objects.", steps: [
      { title: "Move an object", instruction: "Select an object, choose Move in the toolbar (or press W), and drag a gizmo axis." },
      { title: "Rotate and scale", instruction: "Switch to Rotate (E) and Scale (R), then drag the gizmo. Q returns to Select." },
      { title: "Change gizmo space and snapping", instruction: "Toggle World/Local space and the magnet Snap button. Try moving with snapping on and off." },
      { title: "Frame the selection", instruction: "Select an object and press F to bring it into view. Toggle the grid with the grid button." }
    ] },
    { id: "hierarchy", title: "Hierarchy and groups", summary: "Organize objects into parents and groups.", steps: [
      { title: "Make a child", instruction: "Drag one Hierarchy row onto another object. The child follows its parent when the parent moves." },
      { title: "Create a group", instruction: "Select multiple objects and press Ctrl+G. Move the group to move its members together." },
      { title: "Ungroup", instruction: "Select a group and press Ctrl+Shift+G. Its children move up one level." },
      { title: "Use the context menu", instruction: "Right-click an object to try Rename, Duplicate, Copy, Paste, Group, or Delete. Group deletion also removes its descendants." }
    ] },
    { id: "inspector", title: "Inspector and components", summary: "Edit transforms, materials, components, and scene settings.", steps: [
      { title: "Edit a transform", instruction: "Select an object and change its position, rotation, or scale in Inspector." },
      { title: "Change appearance", instruction: "Change the object's material color in Inspector and see it update in the Scene view." },
      { title: "Add a component", instruction: "Use Inspector's Add a feature control to add a component such as Light, Camera, Script, or Collider." },
      { title: "Edit scene settings", instruction: "Click empty scene space or choose View → Scene settings. Change the background, gravity, or collision setting." }
    ] },
    { id: "physics", title: "Physics and collisions", summary: "Make objects fall, collide, trigger events, and react.", steps: [
      { title: "Make an object physical", instruction: "Select a shape, enable Physics in Inspector, then press Play to see it fall." },
      { title: "Add a solid collider", instruction: "Add a Collider to an object without Physics. It can block moving physics objects and receive touches." },
      { title: "Try a trigger", instruction: "Enable Trigger in the Collider settings. Triggers detect contact without blocking movement." },
      { title: "Connect two bodies", instruction: "Give two objects Physics, add a Joint to one of them, and choose the other object in its Target field. Try a joint type in Inspector." },
      { title: "Compare collision modes", instruction: "Toggle the toolbar Collisions button, then Play and observe how objects interact." }
    ] },
    { id: "scripts-console", title: "Scripts and Console", summary: "Give objects behaviors and issue scene commands.", steps: [
      { title: "Open an object's script", instruction: "Select an object and click Script, or use + Add a script in Inspector." },
      { title: "Add an event", instruction: "Try a small script: `when game starts` on one line and an indented action such as `say \"Hello\"` below it. Apply the script." },
      { title: "Use Parse to repair a script", instruction: "With AI configured, introduce a typo in one line and choose Parse. Review the suggested correction before applying it." },
      { title: "Run a Console command", instruction: "Focus Console with `/` and enter a command such as `add a red ball named Player at 0 2 0`. Press Enter." },
      { title: "Inspect errors and history", instruction: "Try Up and Down to recall commands. Compile and runtime script errors are shown inline and in Console." }
    ] },
    { id: "play", title: "Play and debug", summary: "Run, pause, step through, and restore a simulation.", steps: [
      { title: "Start Play", instruction: "Press Play to run scripts, animation, and physics together." },
      { title: "Pause and step", instruction: "Pause the simulation, then use Step to advance one frame at a time." },
      { title: "Read Console output", instruction: "While Play runs, watch Console for script output, warnings, and errors." },
      { title: "Stop and restore", instruction: "Press Stop. The scene returns to the snapshot from before Play." }
    ] },
    { id: "animation", title: "Animation and Timeline", summary: "Keyframe properties and preview motion.", steps: [
      { title: "Add a keyframe", instruction: "Select an object, find an animatable Inspector field, and click its diamond to add a key." },
      { title: "Make a second key", instruction: "Move the Timeline playhead, change the same property, and add another keyframe." },
      { title: "Preview and retime", instruction: "Scrub the Timeline to preview. Drag a keyframe diamond to change its time." },
      { title: "Choose interpolation", instruction: "Select a track and try Linear, Ease In Out, and Step interpolation." }
    ] },
    { id: "ai", title: "AI scene assistant", summary: "Request scene edits and review them before applying.", steps: [
      { title: "Open AI", instruction: "Show the AI panel from the panel tabs. AI setup is optional; other chapters work without credentials." },
      { title: "Configure a provider", instruction: "For browser development, set AI_API_KEY and AI_MODEL in the root .env file. In the desktop app, configure AI Settings." },
      { title: "Request a small edit", instruction: "Describe a simple scene change and send it with Ctrl+Enter. Review the proposed operations and script checks." },
      { title: "Apply or revise", instruction: "Inspect the preview details, then apply the result or revise your request. Applied edits can be undone." }
    ] },
    { id: "scene-files", title: "Scene files and recents", summary: "Create, name, save, and reopen scenes.", steps: [
      { title: "Rename your scene", instruction: "Click the scene name in the top bar and choose Rename." },
      { title: "Create a fresh scene", instruction: "Use the scene menu or File → New to create a scene. Save anything you want to keep before replacing the current scene." },
      { title: "Save a scene", instruction: "Press Ctrl+S or open Scene Loader and save the current scene as JSON." },
      { title: "Reopen a scene", instruction: "Use Open or Scene Loader to browse for a .simu or .json scene." },
      { title: "Use recent scenes", instruction: "Open Scene Loader and choose a recent scene. Browser recents are stored on this device." }
    ] },
    { id: "export", title: "Export", summary: "Share a model, playable web scene, or recording.", steps: [
      { title: "Export a model", instruction: "Open Export and create a GLB snapshot for use in compatible 3D tools." },
      { title: "Export a standalone scene", instruction: "Create a standalone HTML export and open it in a WebGL-capable browser." },
      { title: "Record a demo", instruction: "Choose WebM, set the output size and duration, then record the live Play view." }
    ] },
    { id: "desktop", title: "Desktop app", summary: "Use native scene files and desktop AI settings.", steps: [
      { title: "Open a scene", instruction: "In the Tauri desktop app, use Open to choose a .simu or .json file with the native file picker." },
      { title: "Save to disk", instruction: "Use Save or Ctrl+S to write to the selected scene file path." },
      { title: "Configure AI securely", instruction: "Open AI Settings. The desktop app stores the API key in the operating system credential store." }
    ] },
    { id: "editing-tools", title: "Editing tools and history", summary: "Use undo, redo, clipboard actions, and shortcuts safely.", steps: [
      { title: "Undo and redo", instruction: "Make a small Inspector change, use Ctrl+Z to undo it, then Ctrl+Y to redo it." },
      { title: "Duplicate and delete", instruction: "Select an object, press Ctrl+D to duplicate it, then Delete to remove the copy." },
      { title: "Use the context menu", instruction: "Right-click an object or empty space to use Cut, Copy, Paste, Rename, Duplicate, and Delete." },
      { title: "Try the editor shortcuts", instruction: "Use Q/W/E/R to change tools, F to frame the selection, and `/` to focus the Console." }
    ] }
  ];

  const progressKey = "simustyle.tutorialProgress.v1";
  let progress = $state<Record<string, number[]>>({});
  let ready = $state(false);
  let activeChapter = $state<string | null>(null);
  let stepIndex = $state(0);
  let chapter = $derived(chapters.find((item) => item.id === activeChapter) ?? null);
  let totalSteps = $derived(chapters.reduce((total, item) => total + item.steps.length, 0));
  let completedSteps = $derived(Object.values(progress).reduce((total, steps) => total + steps.length, 0));

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey) ?? "{}") as Record<string, unknown>;
      const valid: Record<string, number[]> = {};
      for (const item of chapters) {
        const entries = saved[item.id];
        if (Array.isArray(entries)) valid[item.id] = [...new Set(entries.filter((step): step is number => typeof step === "number" && Number.isInteger(step) && step >= 0 && step < item.steps.length))];
      }
      progress = valid;
    } catch {
      progress = {};
    }
    ready = true;
  });

  $effect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(progressKey, JSON.stringify(progress));
    } catch {
      // Tutorial steps remain usable when browser storage is unavailable.
    }
  });

  function beginChapter(id: string) {
    activeChapter = id;
    const item = chapters.find((candidate) => candidate.id === id);
    const done = progress[id] ?? [];
    stepIndex = item ? item.steps.findIndex((_, index) => !done.includes(index)) : 0;
    if (stepIndex < 0) stepIndex = 0;
  }

  function markStepDone() {
    if (!chapter) return;
    const steps = new Set(progress[chapter.id] ?? []);
    steps.add(stepIndex);
    progress = { ...progress, [chapter.id]: [...steps].sort((a, b) => a - b) };
    if (stepIndex < chapter.steps.length - 1) stepIndex += 1;
  }

  function skipStep() {
    if (chapter && stepIndex < chapter.steps.length - 1) stepIndex += 1;
  }

  function resetProgress() {
    progress = {};
    activeChapter = null;
    stepIndex = 0;
  }
</script>

<div class="tutorial-page">
  <header class="tutorial-header">
    <span class="tutorial-eyebrow">OPTIONAL INTERACTIVE GUIDE</span>
    <h1>Learn SimuStyle by doing</h1>
    <p>Choose a chapter, try each action in the editor, and mark it done when you are ready. Skip anything or leave whenever you like. Your progress is saved on this device.</p>
    <div class="overall-progress"><span>{completedSteps} of {totalSteps} steps</span><progress value={completedSteps} max={totalSteps}></progress><button type="button" onclick={resetProgress} disabled={!completedSteps && !activeChapter}>Reset</button></div>
  </header>

  <div class="tutorial-layout">
    <nav class="chapter-list" aria-label="Tutorial chapters">
      {#each chapters as item (item.id)}
        {@const done = progress[item.id]?.length ?? 0}
        <button type="button" class:active={activeChapter === item.id} onclick={() => beginChapter(item.id)}>
          <span class="chapter-title">{item.title}</span>
          <small>{done}/{item.steps.length} complete</small>
        </button>
      {/each}
    </nav>

    <section class="tutorial-content" aria-label="Chapter contents">
      {#if chapter}
        {@const step = chapter.steps[stepIndex]}
        {@const done = progress[chapter.id]?.includes(stepIndex) ?? false}
        <div class="tutorial-topline"><button class="back-button" type="button" onclick={() => activeChapter = null}>All chapters</button><span>Chapter {chapters.findIndex((item) => item.id === chapter.id) + 1} of {chapters.length}</span></div>
        <h2>{chapter.title}</h2>
        <p class="chapter-summary">{chapter.summary}</p>
        <div class="step-progress"><progress value={(progress[chapter.id]?.length ?? 0)} max={chapter.steps.length}></progress><span>Step {stepIndex + 1} of {chapter.steps.length}</span></div>
        <article class="step-card">
          <span class="step-label">TRY THIS IN THE EDITOR</span>
          <h3>{step.title}</h3>
          <p>{step.instruction}</p>
          {#if done}<p class="done-note" role="status">You marked this step complete.</p>{/if}
          <div class="step-actions">
            <button type="button" class="primary-action" onclick={markStepDone}>{stepIndex === chapter.steps.length - 1 ? "Complete chapter" : "Done, next step"}</button>
            {#if stepIndex > 0}<button type="button" onclick={() => stepIndex -= 1}>Previous</button>{/if}
            {#if stepIndex < chapter.steps.length - 1}<button type="button" onclick={skipStep}>Skip step</button>{/if}
          </div>
        </article>
        <div class="step-map" aria-label="Chapter steps">
          {#each chapter.steps as item, index}
            <button type="button" class:current={stepIndex === index} class:complete={progress[chapter.id]?.includes(index) ?? false} aria-label="Step {index + 1}: {item.title}" onclick={() => stepIndex = index}>{index + 1}</button>
          {/each}
        </div>
        {#if (progress[chapter.id]?.length ?? 0) === chapter.steps.length}<p class="chapter-done" role="status">Chapter complete. Choose another chapter or revisit any step.</p>{/if}
      {:else}
        <div class="chapter-welcome">
          <span class="step-label">PICK UP WHERE YOU LIKE</span>
          <h2>Choose a chapter</h2>
          <p>Every chapter is self-contained. Start at the beginning, jump straight to a feature, or use the manual instead. Nothing in this tutorial changes your scene automatically.</p>
          <div class="chapter-cards">
            {#each chapters as item (item.id)}
              {@const done = progress[item.id]?.length ?? 0}
              <button type="button" onclick={() => beginChapter(item.id)}>
                <span>{item.title}</span><small>{item.summary}</small><progress value={done} max={item.steps.length}></progress>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .tutorial-page{height:100%;overflow:auto;background:#17181f;color:#d8d6e0;font:11px/1.55 'DM Sans',sans-serif}
  .tutorial-header{padding:22px 24px 15px;border-bottom:1px solid #ffffff12;background:linear-gradient(135deg,#242238,#191a21 65%)}
  .tutorial-eyebrow,.step-label{color:#a99aff;font:9px 'DM Mono',monospace;letter-spacing:.14em}
  h1{margin:7px 0 5px;color:#f0eef8;font-size:19px;line-height:1.25;font-weight:600;letter-spacing:-.025em}
  .tutorial-header>p{max-width:650px;margin:0;color:#9c99a9}
  .overall-progress{display:flex;align-items:center;gap:10px;margin-top:13px;color:#aaa7b6;font-size:10px}.overall-progress progress{flex:1}.overall-progress button,.tutorial-content button{border:1px solid #ffffff18;border-radius:5px;background:#22232c;color:#c9c5d5;padding:6px 9px;font:10px 'DM Sans',sans-serif;cursor:pointer}.overall-progress button:disabled{opacity:.4;cursor:default}
  progress{height:5px;accent-color:#9b8cff}
  .tutorial-layout{display:grid;grid-template-columns:185px minmax(0,1fr);min-height:calc(100% - 146px)}
  .chapter-list{display:flex;flex-direction:column;gap:3px;padding:12px 9px;border-right:1px solid #ffffff10;background:#15161c}
  .chapter-list button{display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid transparent;border-radius:5px;background:transparent;text-align:left;color:#bcb9c8;cursor:pointer}.chapter-list button:hover{background:#20212a}.chapter-list button.active{border-color:#8273db55;background:#29263b;color:#e7e1ff}.chapter-list small{color:#777584;font-size:9px}
  .tutorial-content{min-width:0;padding:18px clamp(16px,4vw,34px) 30px}.tutorial-topline{display:flex;justify-content:space-between;align-items:center;color:#777584;font:9px 'DM Mono',monospace}.tutorial-content .back-button{padding:3px 7px;background:transparent;color:#aaa4c9}
  h2{margin:13px 0 2px;color:#eeeaf8;font-size:16px;font-weight:600}.chapter-summary{margin:0;color:#9996a5}.step-progress{display:flex;align-items:center;gap:10px;margin:17px 0 9px;color:#83808f;font-size:9px}.step-progress progress{flex:1}
  .step-card{padding:18px;border:1px solid #ffffff14;border-radius:9px;background:linear-gradient(145deg,#20212a,#1b1c23)}.step-card h3{margin:9px 0 7px;color:#f0edf8;font-size:14px;font-weight:600}.step-card p{max-width:650px;margin:0;color:#b0adbb;line-height:1.7}.step-card .done-note{margin-top:12px;color:#9fd3ae}.step-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:17px}.tutorial-content button.primary-action{border-color:#8374dc;background:#51477c;color:#fff}.tutorial-content button:hover:not(:disabled){border-color:#8d7df0;color:#fff}
  .step-map{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.step-map button{width:25px;height:25px;padding:0;border-radius:50%;font:9px 'DM Mono',monospace}.step-map button.current{border-color:#a99aff;background:#39334f;color:#fff}.step-map button.complete{border-color:#527b5b;color:#a9dfb5}.chapter-done{color:#9fd3ae}
  .chapter-welcome{max-width:750px;margin:auto}.chapter-welcome h2{margin-top:8px}.chapter-welcome>p{max-width:650px;color:#9996a5}.chapter-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:18px}.chapter-cards button{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-height:92px;text-align:left}.chapter-cards button span{color:#e4e0ef;font-size:11px}.chapter-cards button small{flex:1;color:#92909e;line-height:1.45}.chapter-cards progress{width:100%}
  @media(max-width:600px){.tutorial-layout{grid-template-columns:1fr}.chapter-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-right:0;border-bottom:1px solid #ffffff10}.chapter-list button{min-width:0}.chapter-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tutorial-header{padding:16px}.tutorial-content{padding:16px}}
</style>
