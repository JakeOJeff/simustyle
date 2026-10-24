import type { Entity } from "../../scene/types";
import type { EditorSnapshot, TutorialEvent } from "./tutorialState.svelte";

/** What a task check can see: the editor when the step began, the editor now, and the actions taken since. */
export interface StepContext {
  start: EditorSnapshot;
  now: EditorSnapshot;
  events: TutorialEvent[];
  /** True when an action of this type happened during the step (and matches, when a test is given). */
  happened(type: string, test?: (detail: Record<string, unknown>) => boolean): boolean;
  /** True when `first` happened and `then` happened after it. */
  inOrder(first: string, then: string | string[]): boolean;
  /** True when the control with this `data-tutorial-target` is on screen. */
  visible(target: string): boolean;
}

export interface TutorialTask {
  label: string;
  done: (context: StepContext) => boolean;
  /** Controls to highlight while this task is the next one to do; the first one on screen wins. */
  targets?: string[];
}

export interface TutorialStep {
  title: string;
  instruction: string;
  /** Controls to highlight when the current task names none. */
  targets?: string[];
  /** Completing every task finishes the step. A step with no tasks is finished with its Continue button. */
  tasks: TutorialTask[];
  /** Only the Tauri desktop app can detect these; elsewhere the step is read-only. */
  desktopOnly?: boolean;
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

function created(context: StepContext, test: (entity: Entity) => boolean = () => true): boolean {
  const before = new Set(context.start.scene.entities.map((entity) => entity.id));
  return context.now.scene.entities.some((entity) => !before.has(entity.id) && test(entity));
}

function gained(context: StepContext, component: string, test: (fields: Record<string, unknown>, entity: Entity) => boolean = () => true): boolean {
  return context.now.scene.entities.some((entity) => {
    const fields = entity.components[component];
    if (!fields || !test(fields, entity)) return false;
    const previous = context.start.scene.entities.find((candidate) => candidate.id === entity.id)?.components[component];
    return !previous || !test(previous, entity);
  });
}

const hasSelection = (context: StepContext) => context.now.selectedIds.length > 0;
const selectTask: TutorialTask = { label: "Select an object", done: hasSelection, targets: ["hierarchy-list", "viewport"] };
const playing = (context: StepContext) => context.now.playState !== "stopped";
const pressPlay: TutorialTask = { label: "Press Play", done: (context) => context.happened("play-state", (detail) => detail.state === "playing"), targets: ["play"] };
const contextActions = ["cut", "copy", "paste", "duplicate", "rename", "delete", "group"];

export const chapters: TutorialChapter[] = [
  { id: "workspace", title: "Workspace and navigation", summary: "Move around the scene and arrange the editor.", steps: [
    { title: "Orbit the scene", instruction: "In the Scene view, hold the right mouse button and drag to orbit the camera around your scene. A short right-click opens the context menu instead.", targets: ["viewport"], tasks: [
      { label: "Right-drag in the Scene view to orbit", done: (context) => context.happened("camera-orbit") }
    ] },
    { title: "Pan and zoom", instruction: "Hold the middle mouse button and drag to pan. Use the mouse wheel to zoom in and out.", targets: ["viewport"], tasks: [
      { label: "Middle-drag to pan", done: (context) => context.happened("camera-pan") },
      { label: "Scroll the wheel to zoom", done: (context) => context.happened("camera-zoom") }
    ] },
    { title: "Arrange editor windows", instruction: "Drag a panel's title bar to move it; drop it near an edge to dock it or in the middle to float it. Drag a panel's edge or corner to resize it.", tasks: [
      { label: "Drag a panel by its title bar", done: (context) => context.happened("panel-move"), targets: ["panel-title"] },
      { label: "Resize a panel from an edge", done: (context) => context.happened("panel-resize"), targets: ["panel-edge", "panel-title"] }
    ] },
    { title: "Find a panel", instruction: "The tabs along the bottom show and hide Scene, Inspector, Console, Assistant, Timeline, and Docs. Your layout is saved on this device.", targets: ["panel-tabs"], tasks: [
      { label: "Hide or show a panel from the tabs", done: (context) => context.happened("panel") }
    ] }
  ] },
  { id: "create-select", title: "Create and select objects", summary: "Add scene objects and place them where you want.", steps: [
    { title: "Open the Add menu", instruction: "Click Add in the top bar. This menu holds the shapes, lights, cameras, and groups you can create.", targets: ["add-menu"], tasks: [
      { label: "Open the Add menu", done: (context) => context.visible("add-cube") }
    ] },
    { title: "Create a Cube", instruction: "Click Cube. A cube is a basic 3D shape you can move, resize, and use as a building block.", targets: ["add-cube", "add-menu"], tasks: [
      { label: "Add a cube", done: (context) => created(context, (entity) => Boolean(entity.components.Mesh) && (entity.components.Mesh?.shape ?? "box") === "box") }
    ] },
    { title: "Add at the pointer", instruction: "Right-click empty space in the Scene view, open Add, and choose a shape. It lands on the ground or surface under your pointer.", tasks: [
      { label: "Right-click empty space in the Scene view", done: (context) => context.happened("context-menu", (detail) => detail.source === "viewport"), targets: ["viewport"] },
      { label: "Choose Add, then a shape", done: (context) => context.happened("context-add", (detail) => detail.source === "viewport"), targets: ["context-add-grid", "context-add", "viewport"] }
    ] },
    { title: "Add as a child", instruction: "Right-click an object in the Scene view or a row in the Scene panel, open Add, and create something. It is created inside the object you clicked.", tasks: [
      { label: "Right-click an object", done: (context) => context.happened("context-menu", (detail) => detail.id !== null), targets: ["hierarchy-row", "viewport"] },
      { label: "Add a child from the Add section", done: (context) => created(context, (entity) => entity.parent !== null), targets: ["context-add-grid", "context-add", "hierarchy-row"] }
    ] },
    { title: "Add lights and a camera", instruction: "Use Add (or the light and camera buttons at the bottom of the Scene view) to create a Point, Sun, or Spot light and a Camera. Select a Sun or Spot light's marker and rotate it to aim.", tasks: [
      { label: "Add a light", done: (context) => created(context, (entity) => Boolean(entity.components.Light)), targets: ["add-light", "shelf-light", "add-menu"] },
      { label: "Add a camera", done: (context) => created(context, (entity) => Boolean(entity.components.Camera)), targets: ["add-camera", "shelf-camera", "add-menu"] }
    ] },
    { title: "Select several objects", instruction: "Ctrl-drag a box in the Scene view, or Ctrl-click / Shift-click rows in the Scene panel to extend the selection.", targets: ["hierarchy-list", "viewport"], tasks: [
      { label: "Select two or more objects", done: (context) => context.now.selectedIds.length >= 2 }
    ] }
  ] },
  { id: "transform", title: "Transform tools", summary: "Move, rotate, scale, and frame objects.", steps: [
    { title: "Use the Move tool", instruction: "Click Move in the center toolbar (or press W). Select an object and drag one of its colored arrows to reposition it.", tasks: [
      { label: "Choose the Move tool", done: (context) => context.happened("tool", (detail) => detail.mode === "translate"), targets: ["move-tool"] },
      selectTask,
      { label: "Drag an arrow on the gizmo", done: (context) => context.happened("gizmo-drag", (detail) => detail.mode === "translate"), targets: ["viewport"] }
    ] },
    { title: "Rotate and scale", instruction: "Switch to Rotate (R) and Scale (E) and drag the gizmo. Q returns to Select.", targets: ["tool-segment"], tasks: [
      { label: "Switch to Rotate", done: (context) => context.happened("tool", (detail) => detail.mode === "rotate") },
      { label: "Switch to Scale", done: (context) => context.happened("tool", (detail) => detail.mode === "scale") },
      { label: "Return to Select", done: (context) => context.happened("tool", (detail) => detail.mode === "select") }
    ] },
    { title: "Change gizmo space and snapping", instruction: "Toggle World/Local space, then turn on the magnet Snap button and move an object: it now jumps in 0.5 m steps.", tasks: [
      { label: "Switch between World and Local", done: (context) => context.happened("space"), targets: ["space-toggle"] },
      { label: "Turn Snap on", done: (context) => context.happened("snap", (detail) => detail.on === true), targets: ["snap-toggle"] },
      { label: "Drag the gizmo with Snap on", done: (context) => context.happened("gizmo-drag", (detail) => detail.snap === true), targets: ["viewport"] }
    ] },
    { title: "Frame the selection", instruction: "Select an object and press F to fly the camera to it. Toggle the floor grid with the grid button.", tasks: [
      selectTask,
      { label: "Press F to frame it", done: (context) => context.happened("frame"), targets: ["viewport"] },
      { label: "Toggle the grid", done: (context) => context.happened("grid"), targets: ["grid-toggle"] }
    ] }
  ] },
  { id: "hierarchy", title: "Hierarchy and groups", summary: "Organize objects into parents and groups.", steps: [
    { title: "Make a child", instruction: "Drag one Scene panel row onto another object. The child follows its parent when the parent moves.", targets: ["hierarchy-list"], tasks: [
      { label: "Drop a row onto another object", done: (context) => context.happened("reparent", (detail) => detail.parent !== null) }
    ] },
    { title: "Create a group", instruction: "Select two or more objects and press Ctrl+G (or the folder button in the Scene panel). Move the group to move its members together.", tasks: [
      { label: "Select two or more objects", done: (context) => context.now.selectedIds.length >= 2 || context.happened("group", (detail) => Number(detail.count) >= 2), targets: ["hierarchy-list", "viewport"] },
      { label: "Group them with Ctrl+G", done: (context) => context.happened("group", (detail) => Number(detail.count) >= 2), targets: ["hierarchy-group"] }
    ] },
    { title: "Ungroup", instruction: "Select a group and press Ctrl+Shift+G, or right-click it and choose Ungroup. Its children move up one level.", targets: ["hierarchy-list"], tasks: [
      { label: "Ungroup a group", done: (context) => context.happened("ungroup"), targets: ["context-ungroup", "hierarchy-list"] }
    ] },
    { title: "Use the context menu", instruction: "Right-click an object to try Rename, Duplicate, Copy, Paste, Group, or Delete. Deleting a group also removes everything inside it.", tasks: [
      { label: "Right-click an object", done: (context) => context.happened("context-menu", (detail) => detail.id !== null), targets: ["hierarchy-row", "viewport"] },
      { label: "Choose an action from the menu", done: (context) => context.inOrder("context-menu", contextActions), targets: ["context-menu"] }
    ] }
  ] },
  { id: "inspector", title: "Inspector and components", summary: "Edit transforms, materials, components, and scene settings.", steps: [
    { title: "Edit a transform", instruction: "Select an object and type a new position, rotation, or scale in Inspector.", tasks: [
      selectTask,
      { label: "Change a Transform value", done: (context) => context.happened("inspector-edit", (detail) => detail.component === "Transform"), targets: ["inspector-Transform", "inspector"] }
    ] },
    { title: "Change appearance", instruction: "Pick a new color in the Look section and watch the object update in the Scene view.", tasks: [
      { label: "Select a shape", done: (context) => context.now.selectedIds.some((id) => context.now.scene.entities.find((entity) => entity.id === id)?.components.Material), targets: ["hierarchy-list", "viewport"] },
      { label: "Change its color", done: (context) => context.happened("inspector-edit", (detail) => detail.component === "Material"), targets: ["inspector-Material", "inspector"] }
    ] },
    { title: "Add a component", instruction: "Use Inspector's Add a feature… list to add a component such as Light, Camera, or Collider, then click +.", tasks: [
      selectTask,
      { label: "Add a feature", done: (context) => context.happened("add-component"), targets: ["inspector-add-feature", "inspector"] }
    ] },
    { title: "Edit scene settings", instruction: "Click empty space in the Scene view (or choose View → Scene settings…) to show scene settings in Inspector. Change the background, gravity, or collisions.", tasks: [
      { label: "Show scene settings", done: (context) => context.now.selectedIds.length === 0 && context.now.panelOpen.inspector, targets: ["viewport"] },
      { label: "Change a scene setting", done: (context) => context.happened("scene-settings"), targets: ["inspector-scene-settings", "inspector"] }
    ] }
  ] },
  { id: "physics", title: "Physics and collisions", summary: "Make objects fall, collide, trigger events, and react.", steps: [
    { title: "Make an object physical", instruction: "Select a shape above the floor, switch Physics on in Inspector, then press Play to watch it fall.", tasks: [
      { label: "Switch Physics on", done: (context) => gained(context, "RigidBody"), targets: ["inspector-physics", "hierarchy-list", "viewport"] },
      pressPlay
    ] },
    { title: "Add a solid collider", instruction: "Stop Play, select an object without Physics, and switch Collision on. It blocks moving physics objects and can be touched.", tasks: [
      { label: "Stop the simulation", done: (context) => context.now.playState === "stopped", targets: ["stop"] },
      { label: "Give an object without Physics a collider", done: (context) => gained(context, "Collider", (fields, entity) => fields.enabled !== false && !entity.components.RigidBody), targets: ["inspector-collision", "hierarchy-list", "viewport"] }
    ] },
    { title: "Try a trigger", instruction: "In the Collider section, switch Trigger on. Triggers detect contact without blocking movement.", tasks: [
      { label: "Turn on Trigger", done: (context) => gained(context, "Collider", (fields) => fields.trigger === true), targets: ["inspector-Collider", "inspector"] }
    ] },
    { title: "Connect two bodies", instruction: "Give two objects Physics, add a Joint to one of them, and choose the other object in the Joint's Target field. Try a joint type.", tasks: [
      { label: "Add a Joint to a physics object", done: (context) => gained(context, "Joint"), targets: ["inspector-add-feature", "inspector-physics", "inspector"] },
      { label: "Choose its Target", done: (context) => gained(context, "Joint", (fields) => typeof fields.target === "string" && fields.target !== ""), targets: ["inspector-Joint", "inspector"] }
    ] },
    { title: "Compare collision modes", instruction: "Toggle the toolbar Collisions button, then Play and watch how objects pass through each other or collide.", tasks: [
      { label: "Toggle Collisions", done: (context) => context.happened("collisions"), targets: ["collisions-toggle", "stop"] },
      pressPlay
    ] }
  ] },
  { id: "scripts-console", title: "Scripts and Console", summary: "Give objects behaviors and issue scene commands.", steps: [
    { title: "Open an object's script", instruction: "Select an object and click Script in the top bar, or use + Add a script in Inspector.", tasks: [
      { label: "Open a script tab", done: (context) => context.now.activeTab !== "scene" && context.now.activeTab !== context.start.activeTab, targets: ["inspector-add-script", "script-button"] }
    ] },
    { title: "Add an event", instruction: "Write `when game starts` on one line and an indented action such as `say \"Hello\"` below it, then click Apply.", tasks: [
      { label: "Apply a script with a `when` line", done: (context) => context.happened("script-apply", (detail) => /^\s*when\b/m.test(String(detail.source))), targets: ["script-apply", "script-button"] }
    ] },
    { title: "Use Parse to repair a script", instruction: "Introduce a typo, such as `wehn game starts`, and click Parse. Review the suggested correction before applying it. AI repairs need AI configured; simple typos are fixed locally.", tasks: [
      { label: "Click Parse", done: (context) => context.happened("script-parse"), targets: ["script-parse", "script-button"] }
    ] },
    { title: "Run a Console command", instruction: "Press `/` to focus Console, type a command such as `add a red ball named Player at 0 2 0`, and press Enter.", tasks: [
      { label: "Run a Console command", done: (context) => context.happened("console-command"), targets: ["console-input", "panel-tab-console"] }
    ] },
    { title: "Inspect errors and history", instruction: "In Console, press Up and Down to recall earlier commands. Script errors are shown inline in the script editor and in Console.", tasks: [
      { label: "Recall a command with the Up arrow", done: (context) => context.happened("console-history"), targets: ["console-input", "panel-tab-console"] }
    ] }
  ] },
  { id: "play", title: "Play and debug", summary: "Run, pause, step through, and restore a simulation.", steps: [
    { title: "Start Play", instruction: "Click Play to run the scene. Scripts, animation, and physics start together.", targets: ["play"], tasks: [pressPlay] },
    { title: "Pause and step", instruction: "Pause the simulation, then use Step to advance one frame at a time.", tasks: [
      { label: "Pause", done: (context) => context.happened("play-state", (detail) => detail.state === "paused"), targets: ["play"] },
      { label: "Step one frame", done: (context) => context.happened("step"), targets: ["step"] }
    ] },
    { title: "Read Console output", instruction: "While the simulation runs, Console shows script output, warnings, and errors.", tasks: [
      { label: "Open Console", done: (context) => context.now.panelOpen.console, targets: ["panel-tab-console"] },
      { label: "Keep the simulation running", done: (context) => context.now.panelOpen.console && playing(context), targets: ["play"] }
    ] },
    { title: "Stop and restore", instruction: "Press Stop. The scene returns to how it was before Play.", targets: ["stop"], tasks: [
      { label: "Press Stop", done: (context) => context.happened("play-state", (detail) => detail.state === "stopped") }
    ] }
  ] },
  { id: "animation", title: "Animation and Timeline", summary: "Keyframe properties and preview motion.", steps: [
    { title: "Add a keyframe", instruction: "Select an object, then click the diamond next to an Inspector field, such as Position, to key it at the playhead.", tasks: [
      selectTask,
      { label: "Click a keyframe diamond", done: (context) => context.happened("keyframe"), targets: ["inspector-keyframe", "inspector"] }
    ] },
    { title: "Make a second key", instruction: "Open the Timeline, move its playhead, change the same property in Inspector, and key it again.", tasks: [
      { label: "Move the Timeline playhead", done: (context) => context.happened("timeline-time"), targets: ["timeline-scrubber", "panel-tab-timeline"] },
      { label: "Add another keyframe", done: (context) => context.now.scene.entities.some((entity) => Array.isArray(entity.components.Animator?.tracks) && (entity.components.Animator.tracks as { keys?: unknown[] }[]).some((track) => (track.keys?.length ?? 0) >= 2)) && context.happened("keyframe"), targets: ["inspector-keyframe"] }
    ] },
    { title: "Preview and retime", instruction: "Scrub the Timeline to preview the motion, then drag a keyframe diamond to change its time.", tasks: [
      { label: "Scrub the Timeline", done: (context) => context.happened("timeline-time"), targets: ["timeline-scrubber", "panel-tab-timeline"] },
      { label: "Drag a keyframe to a new time", done: (context) => context.happened("key-retime"), targets: ["timeline-key"] }
    ] },
    { title: "Choose interpolation", instruction: "Click a keyframe, then pick an easing such as Ease In Out or Step to change how it moves toward the next key.", tasks: [
      { label: "Change a key's easing", done: (context) => context.happened("easing"), targets: ["timeline-ease", "timeline-key", "panel-tab-timeline"] }
    ] }
  ] },
  { id: "ai", title: "AI scene assistant", summary: "Request scene edits and review them before applying.", steps: [
    { title: "Open the Assistant", instruction: "Show the Assistant panel from the bottom tabs or the Generate button. AI is optional; other chapters work without it.", tasks: [
      { label: "Open the Assistant panel", done: (context) => context.now.panelOpen.ai, targets: ["panel-tab-ai", "shelf-generate"] }
    ] },
    { title: "Configure a provider", instruction: "For browser development, set AI_API_KEY and AI_MODEL in the root .env file. In the desktop app, open View → AI settings…. Continue when you're set up.", tasks: [] },
    { title: "Request a small edit", instruction: "Describe a simple scene change, such as `add three red balls in a row`, and send it with Enter.", targets: ["ai-prompt", "panel-tab-ai"], tasks: [
      { label: "Send a request", done: (context) => context.happened("ai-request") }
    ] },
    { title: "Review the result", instruction: "Read the summary and script checks in the reply. Applied edits can be undone from the reply or with Ctrl+Z; send another request to revise.", targets: ["ai-prompt", "panel-tab-ai"], tasks: [
      { label: "Get a reply", done: (context) => context.happened("ai-response") || context.happened("ai-undo") }
    ] }
  ] },
  { id: "scene-files", title: "Scene files and recents", summary: "Create, name, save, and reopen scenes.", steps: [
    { title: "Rename your scene", instruction: "Click the scene name at the top left and choose Rename scene.", tasks: [
      { label: "Rename the scene", done: (context) => context.happened("scene-rename"), targets: ["scene-name-input", "file-rename", "scene-menu"] }
    ] },
    { title: "Save a scene", instruction: "Press Ctrl+S or choose Save from the scene menu. In the browser the scene downloads as JSON.", tasks: [
      { label: "Save the scene", done: (context) => context.happened("save"), targets: ["file-save", "scene-menu"] }
    ] },
    { title: "Create a fresh scene", instruction: "Choose New scene from the scene menu. Save anything you want to keep first.", tasks: [
      { label: "Start a new scene", done: (context) => context.happened("new-scene"), targets: ["file-new", "scene-menu"] }
    ] },
    { title: "Reopen a scene", instruction: "Choose Open… and pick the .simu or .json scene you saved.", tasks: [
      { label: "Open a scene file", done: (context) => context.happened("scene-open"), targets: ["file-open", "scene-menu"] }
    ] },
    { title: "Use recent scenes", instruction: "Choose Open Recent to show Scene Loader, then click a recent scene. Browser recents are stored on this device.", tasks: [
      { label: "Open a recent scene", done: (context) => context.happened("open-recent"), targets: ["recent-scene", "file-recent", "scene-menu"] }
    ] }
  ] },
  { id: "export", title: "Export", summary: "Share a model, playable web scene, or recording.", steps: [
    { title: "Export a model", instruction: "Open Export and choose Current frame · GLB for use in other 3D tools.", tasks: [
      { label: "Export a GLB", done: (context) => context.happened("export", (detail) => detail.kind === "glb"), targets: ["export-glb", "export-button"] }
    ] },
    { title: "Export a standalone scene", instruction: "Choose Standalone web page · HTML, then open the file in a WebGL-capable browser.", tasks: [
      { label: "Export HTML", done: (context) => context.happened("export", (detail) => detail.kind === "html"), targets: ["export-html", "export-button"] }
    ] },
    { title: "Record a demo", instruction: "Set the video duration and choose Export WebM to record the live Play view.", tasks: [
      { label: "Record a WebM", done: (context) => context.happened("export", (detail) => detail.kind === "video"), targets: ["export-video", "export-button"] }
    ] }
  ] },
  { id: "desktop", title: "Desktop app", summary: "Use native scene files and desktop AI settings.", steps: [
    { title: "Open a scene", instruction: "In the desktop app, choose Open… to pick a .simu or .json file with the native file picker.", desktopOnly: true, tasks: [
      { label: "Open a scene file", done: (context) => context.happened("scene-open"), targets: ["file-open", "scene-menu"] }
    ] },
    { title: "Save to disk", instruction: "Use Save or Ctrl+S to write to the scene's file path.", desktopOnly: true, tasks: [
      { label: "Save the scene", done: (context) => context.happened("save"), targets: ["file-save", "scene-menu"] }
    ] },
    { title: "Configure AI securely", instruction: "Open View → AI settings…. The desktop app stores the API key in the operating system credential store.", desktopOnly: true, tasks: [
      { label: "Save AI settings", done: (context) => context.happened("ai-settings"), targets: ["ai-settings-save", "view-ai-settings", "view-menu"] }
    ] }
  ] },
  { id: "editing-tools", title: "Editing tools and history", summary: "Use undo, redo, clipboard actions, and shortcuts safely.", steps: [
    { title: "Undo and redo", instruction: "Make a small change, press Ctrl+Z to undo it, then Ctrl+Y to redo it.", targets: ["undo"], tasks: [
      { label: "Undo with Ctrl+Z", done: (context) => context.happened("undo"), targets: ["undo"] },
      { label: "Redo with Ctrl+Y", done: (context) => context.inOrder("undo", "redo"), targets: ["redo"] }
    ] },
    { title: "Duplicate and delete", instruction: "Select an object, press Ctrl+D to duplicate it, then press Delete to remove the copy.", tasks: [
      selectTask,
      { label: "Duplicate with Ctrl+D", done: (context) => context.happened("duplicate"), targets: ["hierarchy-list", "viewport"] },
      { label: "Delete the copy", done: (context) => context.inOrder("duplicate", "delete"), targets: ["hierarchy-list", "viewport"] }
    ] },
    { title: "Use the context menu", instruction: "Right-click an object or empty space to Cut, Copy, Paste, Rename, Duplicate, or Delete.", tasks: [
      { label: "Right-click an object or empty space", done: (context) => context.happened("context-menu"), targets: ["hierarchy-row", "viewport"] },
      { label: "Choose a clipboard or edit action", done: (context) => context.inOrder("context-menu", contextActions), targets: ["context-menu"] }
    ] },
    { title: "Try the editor shortcuts", instruction: "Use Q/W/E/R to change tools, F to frame the selection, and `/` to focus the Console.", targets: ["viewport"], tasks: [
      { label: "Change tools with Q, W, E, or R", done: (context) => context.happened("tool", (detail) => detail.source === "key") },
      { label: "Frame the selection with F", done: (context) => context.happened("frame") },
      { label: "Focus Console with /", done: (context) => context.happened("console-focus") }
    ] }
  ] }
];
