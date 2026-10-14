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

The top bar contains scene file actions, edit and view menus, transform tools, Add, Script, Docs, simulation controls, and Export. The editor windows are Scene, Inspector, Console, Assistant, Timeline, and Docs. Use the Docs button in the top bar or the tabs along the bottom to open it; the other panel tabs show or hide their windows.

- Drag a window title bar to move it. Drop it near an edge to snap it there; keep it away from edges to leave it floating.
- Resize a floating window from any edge or corner. Resize a snapped window from its edge facing the center of the editor.
- Snapped windows reserve their space so the Scene viewport and script editor fit between them. The current window layout is saved on this device.
- The Scene viewport is the 3D work area. Drag with the left mouse button to orbit, use the wheel to zoom, and drag with the middle button to pan. The Perspective menu in the top-left corner switches between Perspective, Top, Bottom, Front, Back, Right, and Left views, and the Shaded menu beside it toggles wireframe display. In the top-right corner, click an axis on the gizmo to look down it; the buttons below it frame the selection and reset the camera. The tool rail on the left switches Select, Move, Rotate, and Scale, and the shelf along the bottom adds the last-used shape or light in one click (the arrow beside each picks another, plus empty groups and script objects), adds a camera, imports a scene file, or opens the AI panel with **Generate**. Selecting or transforming an object does not orbit the camera.

## Cameras

New scenes include an active **Camera**. Select it in Scene to edit Transform and Camera parameters. It looks along local **-Z**. **Scene camera** in the viewport previews the active lens; Play uses it automatically. Turning on **Is active** on another camera switches cameras. When importing an older scene with inactive cameras, the first camera is used; scenes without cameras use the editor's fallback view.

Perspective uses **Fov** (degrees); orthographic uses **Ortho size** (visible vertical height before zoom). **Zoom** works on both. **Near** must be less than **Far**. Camera Transform, Fov, Zoom, Ortho size, and Follow offset support Timeline keyframes.

**Follow target** follows an object with a **Follow offset** along world axes. **Follow damping** of 0 snaps; positive values smooth movement, with larger values catching up faster. **Look at target** continually aims at an object. Targets cannot create a dependency cycle through parents or other cameras. Deleting a target clears its camera references and undo restores them.

Set **Controls** to `fly`, press Play, and click the viewport. Use **WASD** to move, **Q/E** for down/up, **Shift** for faster movement, and **left-drag** to look. Move speed is meters per second; Look speed is degrees per pointer pixel. Following overrides movement, and a look target overrides manual rotation. Pause freezes these controls; Stop restores the scene snapshot.

Parent a light, mesh, or group under a camera to carry it. Child transforms are local to the camera. Use a negative Z offset to place an object in front of its lens. Keep camera rigs and carried objects without dynamic physics bodies.

The `camera.*` API works in scene scripts, object scripts, and the Console:

```text
setting lens = 65 from 10 to 120
when game starts
  camera.set("fov", lens)
  camera.follow(find("Player"), 0, 3, 6, 5)
  camera.attach(find("Lamp"), 0.5, -0.3, -1)

when space is pressed
  camera.use(find("Overview"))
```

Create the named Player, Lamp, and Overview objects before using this example.

| Call | Effect |
| --- | --- |
| `camera()` | Get the active camera handle. |
| `camera.create("Overview", 0, 10, 10)` | Create and return a camera; the first becomes active. |
| `camera.use(find("Overview"))` | Switch the active camera. |
| `camera.get("fov")`, `camera.set("fov", 65)` | Read or change a parameter, with schema validation. |
| `camera.set("projection", "orthographic")` | Change lens type. |
| `camera.set("controls", "fly")` | Enable movement while playing. |
| `camera.position(0, 4, 10)` | Set world position and clear following. |
| `camera.move(0, 0, -1)` | Move along local axes; negative Z is forward. |
| `camera.rotate(0, 15, 0)` | Add pitch, yaw, roll in degrees; clear look targeting. |
| `camera.aim(0, 1, 0)` | Aim once at a world point; clear look targeting. |
| `camera.lookAt(find("Player"))` | Track an object's position. |
| `camera.follow(find("Player"), 0, 3, 6, 5)` | Follow and aim; damping is optional, default 0. |
| `camera.unfollow()` | Clear follow and look targets, retaining the live Transform. |
| `camera.attach(find("Lamp"), 0, 0, -1)` | Parent an object at a camera-local position. |
| `camera.detach(find("Lamp"))` | Release a direct child into the scene, retaining its world pose. |

Calls act on the active camera. You can also put a script on a camera and use `self.Camera.fov = 65` or ordinary sentences such as `move camera up 2 over 1 second`. Lens changes, following, scripts, and attachments work in standalone HTML and video exports. GLB captures the current camera lens and pose.

## Build and edit a scene

### Add and select objects

Choose **Add** in the top bar to create a Cube, Sphere, Cylinder, Capsule, Cone, Plane, Point/Sun/Spot light, Camera, Script object, or Empty group. Lights and cameras show a small clickable wireframe marker; rotate a Sun or Spot light to aim it. New primitives are spaced around the origin. Select an object by clicking it in the viewport or its row in the Scene panel. The selected object's properties appear in Inspector.

Press on an object and drag to move it, like in Roblox Studio: it slides across the floor and settles on top of other objects (or beside them when you drag onto a side). The pointer becomes an open hand over objects you can drag and a closed hand while dragging. Snap rounds the drop point to 0.5 m, and one undo puts the object back. Dragging is off during Play, and the gizmo handles take priority when the pointer is over them. A left-drag that starts on empty space still orbits the camera.

Hold **Ctrl** and drag in the viewport to draw a selection box. Every object whose visible bounds intersect the box is selected. Ctrl-click or Shift-click rows in the Scene panel to add or remove items from the current selection.

### Transform objects

Choose Select, Move, Rotate, or Scale from the top bar. Move, Rotate, and Scale display a viewport gizmo. Drag a gizmo handle to edit the object; use the Inspector for exact position, rotation, and scale values. The World/Local control changes the gizmo axes. The magnet button toggles snapping: 0.5 m for movement, 15° for rotation, and 0.1 for scale. The grid button toggles the floor grid; the viewport has no solid ground plane.

Use **Frame selected** from View or press **F** to bring the current selection into view. Undo and redo are available from the top bar and Edit menu.

### Organize objects

The Scene panel lists scene objects and groups. Drag one row onto another to make it a child. Drop on the top or bottom edge of a row to place it beside that object; drop on empty space to move it to the top level. The Inspector's **Inside** menu can also set an object's parent. Reparenting preserves the object's world position. Expand or collapse groups with the row arrow. Groups are invisible in the viewport, but selecting a group lets you transform its children together.

Right-click an object in the viewport or the Scene panel to open its context menu. It includes available actions such as Cut, Copy, Paste, Duplicate, Rename, Delete, Group, and Ungroup. Right-click empty viewport or Scene panel space to paste. A viewport paste uses the ground point under the pointer; a Scene panel paste creates a root-level copy. Copying and deleting a group includes its descendants. Paste and Duplicate offset the copy from its source.

### Save and open scenes

Use the scene menu at the left of the top bar or the File menu to create, open, rename, and save a scene. The scene name is editable from **Rename scene** and is stored in the scene file. **Ctrl+S** saves the current scene as its own JSON file (or writes the selected desktop `.simu`/`.json` path). Open **Scene Loader** from File or View to show a movable window with recent scenes, a file browser button, and **Save current scene as JSON**. The last ten opened or saved scenes appear in the list. Browser recents are cached on this device; desktop recents use their file paths. The scene name area shows whether there are unsaved edits.

## Inspector and components

Inspector edits the selected entity. Rename it in the Name field; edit Position, Rotation, and Scale in the Transform section. Component sections expose their fields and can be collapsed or removed when allowed. Add a component from the controls at the bottom of Inspector. Script settings and ranged parameters appear here too. Click a keyframe diamond beside an animatable property to key its current value at the Timeline playhead.

With nothing selected (or **View → Scene settings…**), Inspector shows **Scene settings**: Physics (Collisions, Gravity with Earth/Moon/Zero presets, and Physics step), Environment (Sky color and Ambient light), and Grid (viewport Snap). These edits are undoable and take effect the next time you press Play.

### Surface textures

Select a mesh object, open **Look** in Inspector, and choose **Texture**: Bricks,
Grass, Ground, Metal, Paper, Paving stones, Rock, Wood, or Wood floor. Choose
**None** to return to a plain surface. **Mapping** has three modes:

- **Auto repeat** (default): repeats at roughly one tile per meter. Resizing an
  object or its parent group keeps the pattern size. Box faces and cylinder caps
  use their own dimensions; curved surfaces use approximate circumference/arc length.
- **Stretch**: fits one image across each surface.
- **Custom**: exposes **Texture repeat X/Y** for your own repeat counts in UV space.

**Normal map** selects the surface's lighting detail independently of color.
**Auto (match texture)** uses the selected color texture's normal, **Off** disables
normal mapping, or choose Bricks, Grass, Ground, Paving stones, Rock, Wood, or Wood
floor directly. This also works with **Texture → None**, so a plain painted object
can have brick edges, wood grain, or rock detail. The blue/purple preview shows the
actual selected normal map. Paper and metal have flat source normals, so Auto
uses no normal for those; a separate normal can still be applied to them.

**Normal map strength** controls the effect: 0 flattens it, 1 uses the original
map, and up to 10 makes subtle grain more visible. Color, normal, roughness and
metalness maps share the selected Stretch/Auto repeat/Custom mapping.

**Relief depth (m)** makes joints and grain look recessed as the camera moves,
especially at shallow angles. Height-based parallax is enabled by default at
0.035 m; increase toward 0.05–0.07 m for more pronounced stone relief, or set 0
to disable it. **Crevice shadow** darkens the supplied occlusion map's cracks.
Both effects use one small packed texture and add no mesh vertices. Turning
both controls to 0 skips that texture entirely.

Relief works in the editor, Play, offline HTML, and video. GLB preserves normal
and ambient-occlusion maps; its standard materials do not carry the custom
view-dependent parallax shader. Collision shapes stay unchanged.

Color tints the image: white (`#ffffff`) keeps its original colors. Set roughness
to 1 to preserve the supplied roughness map, and metalness to 1 for bare metal.
One material covers the entire object; use separate parts for different surfaces.
Texture and tiling edits support undo/redo, saving, duplication, Play, GLB, offline
HTML, and video exports. HTML embeds each used image once and remains offline.

Ask the Assistant to "give this wall a brick texture" or "make the floor wood with
tiling 4 by 4." Scene and script agents receive texture context. Scripts can use
`self.Material.texture = "wood"`, `self.Material.normalTexture = "rock"`,
`self.Material.normalStrength = 2`, and
`self.Material.textureMapping = "auto"`. For manual repeats, set
`self.Material.textureMapping = "custom"` before `self.Material.textureRepeatX = 4`.

The nine sets use compact 512px WebP maps and load only when selected. Height and
AO are packed together for relief. Unused DirectX normals, previews and source
files are excluded from the app; original 2K archives remain local in `textures/`.

### Collisions

During Play, objects with Physics (RigidBody) or a **Collider** bump into each other. The stacked-boxes button in the top bar turns collisions on or off for the whole scene; when off, objects pass through each other but still land on the floor, and touch events stop. Each selected object has **Physics** and **Collision** switches at the top of Inspector: Physics makes it fall and bounce; Collision makes it solid and touchable (with or without Physics) and stores the choice in its Collider. Turn off **Enabled** to let one object pass through others, or turn on **Trigger** to detect touches without blocking. Choose a **Reaction** (flash, shake, change color, jump, disappear, destroy other) to react without a script, or write `when I touch a ball` in a script.

## Console

Type a supported plain-English scene command in the Console command bar and press Enter. While stopped, it applies as one undoable edit. During Play or Pause, it edits the live simulation; Stop restores the scene from before Play. Quick commands are `play` (or `run`/`start`), `pause`, `stop`, `clear` (clears the Console output), and `help` (lists commands and keys). The buttons above the command bar run `play`, `pause`, `stop`, and `help`, and the header button clears the output. `play` resumes a paused simulation. To target one object from a matching group, use a zero-based index, for example `move all balls[2] up 1` selects the third matching ball. For example:

```text
add a red ball named player at 0 2 0
move player above the box
paint player blue
```

After each command, Console lists every created, changed, or removed object by name, for example `Created Ball2: red ball at 0 0.5 0`, `Crate: moved to 1 2 3, painted blue`, or `Removed Crate`. Use Up and Down to recall command history. Commands that contain waits or glides finish immediately in the Console. The [Scripting reference](../README.md#scripting) lists supported sentences, targets, values, and examples.

## Scripts

Scripts belong to an object. Select an object and choose **Script** in the top bar, **+ Add a script** in Inspector, or the script icon on its Scene panel row. A script with no object selected becomes a Scene Script. Inside an object script, `me`, `I`, and `my` refer to that object; scripts on groups can also address `my children` and `my parent`.

Start with an event line and indent the actions beneath it:

```text
when game starts
  say "Scene started"

when space is pressed
  move up 2 over 0.5 seconds
```

The editor provides syntax highlighting, line numbers, starter examples, and inline errors. Tab and Shift+Tab indent, Enter keeps indentation, and Ctrl+/ toggles comments. Choose **Apply** or press Ctrl+S to apply script edits. The editor also applies edits when you leave it, save, or start Play. Use **✦ Parse** to turn casual wording into valid syntax. It fixes typos locally first (no AI call), then asks the configured AI to fix only the broken lines; valid lines are never changed, and the AI makes sense of odd wording without adding actions you did not write. The review shows which stage ran and highlights changed lines; every result is checked with the parser and type checker first. Hover an object name, `me`, or a shape word such as `ball` to see which scene object it refers to. Hover a color code to see its color swatch and hex value. See the [full scripting reference](../README.md#scripting) for events, commands, conditions, variables, and values.

## AI scene assistant

Open the Assistant window and describe a scene change in the prompt box; Enter sends the request and Shift+Enter adds a new line. The suggestions in an empty panel send a starter request with one click. Before applying anything, the assistant builds a first draft, runs its scripts in an isolated Play-start preview, then asks for an independent second pass that checks the design against your request and the captured Console output. The second result is validated before it is applied as one undoable edit. Expand **Checked before apply** in the response to see script output and runtime issues. This preview runs game-start scripts and five short script ticks; it does not render the scene or run Rapier physics, so it cannot verify the visual appearance or physics behavior. New objects are placed on free floor space when no position is given, lifted if they would sink into the floor, and renamed if their name is already taken; the reply mentions any adjustment. AI requires a configured provider and network access.

On the hosted site and the development server, AI uses daily credits: one credit per model call, and a request usually takes two or three. The balance shows under the prompt box and resets at 00:00 UTC. SimuStyle is free and its AI costs are paid by the developer, which is why the limit exists; the heart button in the top bar explains this and links to donations. The desktop app uses your own API key and has no credit limit.

In the browser development server, set `AI_API_KEY` and `AI_MODEL` in the ignored `.env` file. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Never expose a provider key with a `VITE_` variable. In the desktop app, configure the provider from AI Settings; the API key is stored in the operating system credential store. See [installation and desktop setup](../README.md#install-and-run).

## Animate and simulate

Open Timeline with **Animate** in the top bar. **Presets** add one-click motion (Bounce, Float, Spin, Swing, Pulse, Shake, Wobble, Pop In, Drop In, Slide In, Color Cycle, Glow Pulse, Flicker) starting from the object's current pose; open them from the timeline, the Inspector header, or the right-click **Animate…** item. Click the keyframe diamond next to an animatable Inspector field to key its value at the playhead (a filled diamond means a key is already there), or use **Property** in the timeline. Drag keys to retime them (snapping to 0.1 s; hold Alt for free timing), double-click a lane to insert a key on the existing curve, and click a lane to seek; focused lanes support Left/Right (Shift for finer steps) and Home/End. Each segment draws its easing; click the curve chip or the selected key's easing button to pick Linear, Smooth, Step, a custom cubic-bezier with draggable handles, or Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Back, Elastic, or Bounce in In, Out, or In-Out. Key shapes show the easing: diamond for linear, circle for eased, square for hold. The header holds transport, previous/next key, Loop, and length; **Key all** keys every track at the playhead. Transform animation on dynamic rigid bodies is skipped with a Console warning; animate static or kinematic transforms instead.

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
| Q / W / E / R | Select / Move / Scale / Rotate tool |
| F | Frame selected object |
| Drag an object in viewport | Move it across surfaces |
| Ctrl+drag in viewport | Box-select intersecting objects |
| Ctrl+click or Shift+click in the Scene panel | Extend selection |
| Enter in Assistant prompt | Send the AI request (Shift+Enter for a new line) |
| K | Key the selected object's position at the playhead |
| Space while stopped / paused | Start / resume Play |
| Space during Play | Send the `space` key to scripts |
| / | Focus the Console command bar |
| Tab in Console | Select the most recently added scene object |
| Tab / Shift+Tab in Script | Indent / outdent lines |
| Ctrl+/ in Script | Toggle line comments |
| Up / Down in Console | Recall command history |

## Troubleshooting

- **"You've used all … AI credits for today":** Wait for the 00:00 UTC reset, or use the desktop app with your own API key.
- **AI requests fail:** Check the model, base URL, and API key in AI Settings or `.env`, then confirm network access. Provider errors are shown in the Assistant window.
- **Scripts do not run:** Check inline diagnostics and Console for the line and error, then use the language examples in the [scripting reference](../README.md#scripting).
- **An object is hidden behind a panel:** Move the panel or snap it to an edge. Snapped windows reserve space for the Scene and Script areas; floating windows may overlap them.
- **A scene does not look the same after Stop:** Stop deliberately restores the scene to its exact pre-Play snapshot. Save scene edits before starting Play.

