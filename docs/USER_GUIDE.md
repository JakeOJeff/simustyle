# SimuStyle User Guide

This guide explains the editor controls and the main workflows for building, scripting, animating, and exporting a scene.

## Start the editor

For the browser version, install dependencies and start the development server from the project folder:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To run the desktop app during development, use `npm run tauri:dev`; see the [README](../README.md#desktop-application) for desktop prerequisites and AI setup.

## Editor layout

The top bar contains scene file actions, edit and view menus, transform tools, Add, Script, Docs, simulation controls, and Export. The editor windows are Hierarchy, Inspector, Console, AI, Timeline, and Docs. Use the Docs button in the top bar or the tabs along the bottom to open it; the other panel tabs show or hide their windows.

- Drag a window title bar to move it. Drop it near an edge to snap it there; keep it away from edges to leave it floating.
- Resize a floating window from any edge or corner. Resize a snapped window from its edge facing the center of the editor.
- Snapped windows reserve their space so the Scene viewport and script editor fit between them. The current window layout is saved on this device.
- The Scene viewport is the 3D work area. Drag with the mouse to orbit, use the wheel to zoom, and use the right mouse button to pan the view. Selecting or transforming an object does not orbit the camera.

## Build and edit a scene

### Add and select objects

Choose **Add** in the top bar to create a Cube, Sphere, Cylinder, Capsule, Cone, Plane, Physics ball or box, Point/Sun/Spot light, Camera, Script object, or Empty group. Lights and cameras show a small clickable wireframe marker; rotate a Sun or Spot light to aim it. New primitives are spaced around the origin. Select an object by clicking it in the viewport or its row in Hierarchy. The selected object's properties appear in Inspector.

Hold **Ctrl** and drag in the viewport to draw a selection box. Every object whose visible bounds intersect the box is selected. Ctrl-click or Shift-click rows in Hierarchy to add or remove items from the current selection.

### Transform objects

Choose Select, Move, Rotate, or Scale from the top bar. Move, Rotate, and Scale display a viewport gizmo. Drag a gizmo handle to edit the object; use the Inspector for exact position, rotation, and scale values. The World/Local control changes the gizmo axes. The magnet button toggles snapping: 0.5 m for movement, 15° for rotation, and 0.1 for scale. The grid button toggles the floor grid; the viewport has no solid ground plane.

Use **Frame selected** from View or press **F** to bring the current selection into view. Undo and redo are available from the top bar and Edit menu.

### Organize objects

Hierarchy lists scene objects and groups. Drag one row onto another to make it a child. Drop on the top or bottom edge of a row to place it beside that object; drop on empty space to move it to the top level. The Inspector's **Inside** menu can also set an object's parent. Reparenting preserves the object's world position. Expand or collapse groups with the row arrow. Groups are invisible in the viewport, but selecting a group lets you transform its children together.

Right-click an object in the viewport or Hierarchy to open its context menu. It includes available actions such as Cut, Copy, Paste, Duplicate, Rename, Delete, Group, and Ungroup. Right-click empty viewport or Hierarchy space to paste. A viewport paste uses the ground point under the pointer; a Hierarchy paste creates a root-level copy. Copying and deleting a group includes its descendants. Paste and Duplicate offset the copy from its source.

### Save and open scenes

Use the scene menu at the left of the top bar or the File menu to create, open, and save a scene. **Ctrl+S** saves. Browser scenes use JSON files. In the desktop app, Open and Save use native dialogs and accept `.simu` or `.json` scene files. The scene name area shows whether there are unsaved edits.

## Inspector and components

Inspector edits the selected entity. Rename it in the Name field; edit Position, Rotation, and Scale in the Transform section. Component sections expose their fields and can be collapsed or removed when allowed. Add a component from the controls at the bottom of Inspector. Script settings and ranged parameters appear here too. Click a keyframe diamond beside an animatable property to key its current value at the Timeline playhead.

With nothing selected (or **View → Scene settings…**), Inspector shows **Scene settings**: Collisions, Gravity, Background, Ambient light, and Physics step. These edits are undoable and take effect the next time you press Play.

### Collisions

During Play, objects with Physics (RigidBody) or a **Collider** bump into each other. The stacked-boxes button in the top bar turns collisions on or off for the whole scene; when off, objects pass through each other but still land on the floor, and touch events stop. A Collider makes an object solid and touchable without Physics. Turn off **Enabled** to let one object pass through others, or turn on **Trigger** to detect touches without blocking. Choose a **Reaction** (flash, shake, change color, jump, disappear, destroy other) to react without a script, or write `when I touch a ball` in a script.

## Console

Type a supported plain-English scene command in the Console command bar and press Enter. While stopped, it applies as one undoable edit. During Play or Pause, it edits the live simulation; Stop restores the scene from before Play. For example:

```text
add a red ball named player at 0 2 0
move player above the box
paint player blue
```

Use Up and Down to recall command history. Commands that contain waits or glides finish immediately in the Console. The [Scripting reference](../README.md#scripting) lists supported sentences, targets, values, and examples.

## Scripts

Scripts belong to an object. Select an object and choose **Script** in the top bar, **+ Add a script** in Inspector, or the script icon on its Hierarchy row. A script with no object selected becomes a Scene Script. Inside an object script, `me`, `I`, and `my` refer to that object; scripts on groups can also address `my children` and `my parent`.

Start with an event line and indent the actions beneath it:

```text
when game starts
  say "Scene started"

when space is pressed
  move up 2 over 0.5 seconds
```

The editor provides syntax highlighting, line numbers, starter examples, and inline errors. Tab and Shift+Tab indent, Enter keeps indentation, and Ctrl+/ toggles comments. Choose **Apply** or press Ctrl+S to apply script edits. The editor also applies edits when you leave it, save, or start Play. Use **✦ Parse** to ask the configured AI to interpret the complete script in context and rewrite it as valid script syntax; review the full replacement and its explanation before applying it. The rewrite is checked with the parser and type checker first. See the [full scripting reference](../README.md#scripting) for events, commands, conditions, variables, and values.

## AI scene assistant

Open the AI window and describe a scene change in the prompt box; Ctrl+Enter sends the request. Review the proposed operations and apply them to make one undoable change. Generated script source and scene operations are validated before application. AI requires a configured provider and network access.

In the browser development server, set `AI_API_KEY` and `AI_MODEL` in the ignored `.env` file. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Never expose a provider key with a `VITE_` variable. In the desktop app, configure the provider from AI Settings; the API key is stored in the operating system credential store. See [installation and desktop setup](../README.md#install-and-run).

## Animate and simulate

Click the keyframe diamond next to an animatable Inspector field to add a key at the current playhead. Scrub Timeline to preview values. Tracks support Linear, Ease In Out, and Step interpolation. Transform animation on dynamic rigid bodies is skipped with a Console warning; animate static or kinematic transforms instead.

Use **Play** to run scripts, animation, and physics. **Pause** freezes the simulation; **Step** advances one 60 fps frame while paused; **Stop** restores the scene to its pre-Play state. Script compilation errors appear in the editor and Console.

## Export

Choose **Export** in the top bar:

- **GLB** saves a 3D snapshot for compatible 3D tools and viewers.
- **Standalone HTML** creates a self-contained web scene that autoplays. Add `?controls=1` to its URL to show script parameter sliders.
- **WebM** records the live Play viewport at 720p or 1080p for a chosen duration. Recording runs in real time.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+S | Save the scene or apply script edits |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate selection |
| Delete | Delete selection and its descendants |
| F2 | Rename selected object |
| Ctrl+G / Ctrl+Shift+G | Group selection / ungroup selection |
| Q / W / E / R | Select / Move / Rotate / Scale tool |
| F | Frame selected object |
| Ctrl+drag in viewport | Box-select intersecting objects |
| Ctrl+click or Shift+click in Hierarchy | Extend selection |
| Ctrl+Enter in AI prompt | Send the AI request |
| / | Focus the Console command bar |
| Tab in Console | Select the most recently added scene object |
| Tab / Shift+Tab in Script | Indent / outdent lines |
| Ctrl+/ in Script | Toggle line comments |
| Up / Down in Console | Recall command history |

## Troubleshooting

- **AI requests fail:** Check the model, base URL, and API key in AI Settings or `.env`, then confirm network access. Provider errors are shown in the AI window.
- **Scripts do not run:** Check inline diagnostics and Console for the line and error, then use the language examples in the [scripting reference](../README.md#scripting).
- **An object is hidden behind a panel:** Move the panel or snap it to an edge. Snapped windows reserve space for the Scene and Script areas; floating windows may overlap them.
- **A scene does not look the same after Stop:** Stop deliberately restores the scene to its exact pre-Play snapshot. Save scene edits before starting Play.

