<script lang="ts">
  const topics = [
    ["getting-started", "Getting started"], ["workspace", "Workspace"], ["scene-editing", "Scene editing"],
    ["hierarchy-inspector", "Hierarchy & Inspector"], ["scripts", "Scripts & Console"],
    ["ai-assistant", "AI assistant"], ["animation-play", "Animation & Play"],
    ["save-export", "Save & export"], ["shortcuts", "Keyboard shortcuts"], ["troubleshooting", "Troubleshooting"]
  ];
</script>

<div class="docs-page">
  <header class="docs-intro">
    <span class="eyebrow">SIMUSTYLE MANUAL</span>
    <h1>Build a scene, your way.</h1>
    <p>Everything you need to create, script, animate, and export a SimuStyle scene.</p>
  </header>

  <nav class="docs-index" aria-label="Guide contents">
    {#each topics as [id, title]}
      <a href="#docs-{id}">{title}<span>›</span></a>
    {/each}
  </nav>

  <article class="docs-content">
    <section id="docs-getting-started">
      <h2>Getting started</h2>
      <p>Choose <b>Add</b> in the top bar to make your first object. Select it in the Scene or Hierarchy, then change its position, rotation, scale, and components in Inspector. Use <b>Play</b> to run scripts, animation, and physics.</p>
      <p>To start the browser editor locally, run <code>npm install</code> and <code>npm run dev</code> in a terminal, then open the local address Vite prints.</p>
    </section>

    <section id="docs-workspace">
      <h2>Arrange your workspace</h2>
      <p>Hierarchy, Inspector, Console, AI, Timeline, and Docs are independent windows. The tabs along the bottom show or hide them. Drag a title bar to move a window; drop near an edge to snap it, or release away from edges to float it.</p>
      <p>Resize a floating window from any edge or corner. Resize a snapped window from its inner edge. Snapped windows reserve room for the Scene and Script work areas. Your panel layout is saved on this device.</p>
      <p>In the Scene view, drag to orbit the camera, use the wheel to zoom, and right-drag to pan. Drag a selected object's gizmo to transform the object without orbiting the camera.</p>
    </section>

    <section id="docs-scene-editing">
      <h2>Create and edit objects</h2>
      <p><b>Add</b> creates a Cube, Sphere, Cylinder, Capsule, Cone, Plane, or Empty group. New primitives are spaced around the origin. Click an object in the view or its row in Hierarchy to select it. Hold <kbd>Ctrl</kbd> and drag in the viewport to box-select intersecting objects; Ctrl-click or Shift-click Hierarchy rows to extend a selection.</p>
      <p>Choose Select, Move, Rotate, or Scale in the toolbar. Move, Rotate, and Scale show a gizmo in the viewport. The World/Local button changes the gizmo axes. The magnet toggles snapping (0.5 m movement, 15° rotation, 0.1 scale); the grid button toggles the floor grid. Press <kbd>F</kbd> to frame the selection.</p>
      <p>Right-click an object for Cut, Copy, Paste, Duplicate, Rename, Delete, Group, and Ungroup actions. Right-click empty viewport or Hierarchy space to paste. Viewport paste uses the ground point under the pointer; Hierarchy paste creates a root object. Copying, duplicating, or deleting a group includes its descendants.</p>
    </section>

    <section id="docs-hierarchy-inspector">
      <h2>Hierarchy and Inspector</h2>
      <p>Drag a Hierarchy row onto another object to make it a child. Drop on the top or bottom edge to place it beside an object, or drop on blank space to move it to the root. The Inspector's <b>Inside</b> menu also changes the parent. Reparenting preserves world position. Groups are invisible but transform their children together.</p>
      <p>In Inspector, edit the selected object's name and transform, change component fields, collapse sections, or add components. Script controls and ranged script settings also appear here. Click a diamond beside an animatable field to key its value at the current Timeline time.</p>
    </section>

    <section id="docs-scripts">
      <h2>Scripts and Console</h2>
      <p>Scripts belong to an object. Select one and click <b>Script</b>, choose <b>+ Add a script</b> in Inspector, or click its script icon in Hierarchy. With nothing selected, Script creates a scene-wide script. In an object script, <code>me</code>, <code>I</code>, and <code>my</code> refer to its owner.</p>
      <p>Start with an event and indent actions underneath:</p>
      <pre>when game starts
  say "Scene started"

when space is pressed
  move up 2 over 0.5 seconds</pre>
      <p>Tab and Shift+Tab indent, Enter auto-indents, and Ctrl+/ toggles comments. Apply changes with <b>Apply</b> or Ctrl+S. The editor also applies edits when you leave it, save, or start Play. <b>✦ Parse</b> asks AI to interpret the complete script in context and propose a valid rewrite; review the full script and explanation before using it.</p>
      <p>Console runs supported plain-English commands immediately as one undoable edit. For example: <code>add a red ball named player at 0 2 0</code>, <code>move player above the box</code>, or <code>paint player blue</code>. Up and Down recall command history. Waits and glides complete immediately in Console.</p>
      <h3>Common script sentences</h3>
      <ul>
        <li><b>Events:</b> <code>when game starts</code>, <code>forever</code>, <code>every 2 seconds</code>, <code>when clicked</code>, <code>when space is pressed</code>, <code>when I touch a coin</code>, <code>when I receive "win"</code>.</li>
        <li><b>Movement:</b> <code>move up 2</code>, <code>move to 1 2 3</code>, <code>move by 1 0 0</code>, <code>move above the box</code>. Add <code>over 1 second</code> to glide while Play runs.</li>
        <li><b>Transform and look:</b> <code>turn left</code>, <code>rotate box1 to 0 90 0</code>, <code>scale by 2</code>, <code>paint red</code>, <code>hide</code>, <code>spin slowly</code>.</li>
        <li><b>Create and remove:</b> <code>add box</code>, <code>add 3 boxes named crate</code>, <code>add a red ball named player at 0 2 0</code>, <code>delete box1</code>.</li>
        <li><b>Logic:</b> <code>set score to 0</code>, <code>change score by 1</code>, <code>wait 1 second</code>, <code>repeat 3 times</code>, <code>if score is at least 3</code>, <code>broadcast "win"</code>.</li>
      </ul>
      <p>Commands can target <code>me</code>, <code>it</code>, a named object, <code>my children</code>, <code>my parent</code>, or a description such as <code>the nearest red ball</code>. Use <code>--</code> to start a comment. Runtime and compile errors appear in Console or inline beside the script.</p>
    </section>

    <section id="docs-ai-assistant">
      <h2>AI scene assistant</h2>
      <p>Open the AI window, describe the change, then send with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Review the proposed changes before applying; applied edits can be undone. AI checks scene operations and script source before making changes.</p>
      <p>For browser development, set <code>AI_API_KEY</code> and <code>AI_MODEL</code> in the ignored root <code>.env</code> file. <code>AI_BASE_URL</code> is optional. In the desktop app, use AI Settings; the key is stored in the operating system credential store. Requests need network access. Never put a key in a <code>VITE_</code> variable.</p>
    </section>

    <section id="docs-animation-play">
      <h2>Animation and Play</h2>
      <p>Add keyframes from Inspector, then scrub Timeline to preview them. Tracks support Linear, Ease In Out, and Step interpolation. Transform tracks on dynamic rigid bodies are skipped with a Console warning; use a static or kinematic body for transform animation.</p>
      <p><b>Play</b> runs scripts, animation, and physics. <b>Pause</b> freezes the simulation. <b>Step</b> advances one 60 fps frame while paused. <b>Stop</b> restores the scene snapshot from before Play. Script errors appear inline and in Console.</p>
    </section>

    <section id="docs-save-export">
      <h2>Save and export</h2>
      <p>Use the scene menu or File menu to create, open, and save JSON scenes. Ctrl+S saves. The scene name shows whether there are unsaved edits. Desktop Open and Save use native dialogs and support <code>.simu</code> and <code>.json</code>.</p>
      <ul>
        <li><b>GLB:</b> export a 3D snapshot for compatible tools and viewers.</li>
        <li><b>Standalone HTML:</b> export a self-contained web scene that autoplays. Add <code>?controls=1</code> to show script parameter sliders.</li>
        <li><b>WebM:</b> record the live Play view at 720p or 1080p in real time.</li>
      </ul>
    </section>

    <section id="docs-shortcuts">
      <h2>Keyboard shortcuts</h2>
      <dl class="shortcuts">
        <div><dt>Ctrl+S</dt><dd>Save / apply script edits</dd></div>
        <div><dt>Ctrl+Z / Ctrl+Y</dt><dd>Undo / redo</dd></div>
        <div><dt>Ctrl+D</dt><dd>Duplicate selection</dd></div>
        <div><dt>Delete</dt><dd>Delete selection</dd></div>
        <div><dt>F2</dt><dd>Rename selection</dd></div>
        <div><dt>Ctrl+G / Ctrl+Shift+G</dt><dd>Group / ungroup</dd></div>
        <div><dt>Q / W / E / R</dt><dd>Select / Move / Rotate / Scale</dd></div>
        <div><dt>F</dt><dd>Frame selected object</dd></div>
        <div><dt>Ctrl+drag</dt><dd>Box-select in viewport</dd></div>
        <div><dt>Ctrl+Enter</dt><dd>Send AI prompt</dd></div>
        <div><dt>Tab / Shift+Tab</dt><dd>Indent / outdent script lines</dd></div>
        <div><dt>Ctrl+/</dt><dd>Toggle script comments</dd></div>
        <div><dt>Up / Down</dt><dd>Recall Console commands</dd></div>
      </dl>
    </section>

    <section id="docs-troubleshooting">
      <h2>Troubleshooting</h2>
      <ul>
        <li><b>AI request failed:</b> check the model, base URL, API key, and network connection.</li>
        <li><b>Script will not run:</b> read inline diagnostics and Console errors for the failing line.</li>
        <li><b>Panel covers the view:</b> move it, resize it, or snap it to an edge. Floating panels can overlap the Scene view.</li>
        <li><b>Scene changes disappear after Stop:</b> Stop restores the pre-Play snapshot; save edits before starting Play.</li>
      </ul>
    </section>
    <footer>SimuStyle · User guide</footer>
  </article>
</div>

<style>
  .docs-page{height:100%;overflow:auto;background:#17181f;color:#d8d6e0;font:11px/1.65 'DM Sans',sans-serif;scroll-behavior:smooth}
  .docs-intro{padding:24px 24px 17px;border-bottom:1px solid #ffffff12;background:linear-gradient(135deg,#242238,#191a21 65%)}
  .eyebrow{font:9px 'DM Mono',monospace;letter-spacing:.16em;color:#a99aff}
  h1{margin:8px 0 5px;color:#f0eef8;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:-.03em}
  .docs-intro p{max-width:520px;margin:0;color:#9c99a9;font-size:11px}
  .docs-index{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;padding:15px 22px;border-bottom:1px solid #ffffff0e}
  .docs-index a{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid #ffffff0d;background:#1c1d25;color:#c8c5d3;text-decoration:none;font-size:10px}
  .docs-index a:hover{border-color:#8b7cf088;color:#fff}.docs-index span{color:#9888ff}
  .docs-content{max-width:860px;margin:0 auto;padding:8px 24px 26px}
  section{padding:18px 0 15px;border-bottom:1px solid #ffffff0e;scroll-margin-top:10px}
  h2{margin:0 0 8px;color:#eeeaf8;font-size:13px;font-weight:600}h3{margin:14px 0 5px;color:#d4d0e2;font-size:11px;font-weight:600}
  p{margin:7px 0;color:#aaa7b6}b{color:#d8d4e6;font-weight:600}
  code,pre{border:1px solid #ffffff0d;background:#111217;color:#c7bbff;font:10px/1.6 'DM Mono',monospace}
  code{padding:1px 4px}pre{overflow:auto;margin:9px 0;padding:10px 12px;color:#d7cbff}
  kbd{padding:1px 4px;border:1px solid #ffffff20;background:#20212a;color:#d8d5e2;font:9px 'DM Mono',monospace}
  a{color:#b2a5ff}ul{margin:7px 0;padding-left:18px;color:#aaa7b6}li{margin:5px 0}
  .shortcuts{margin:8px 0}.shortcuts div{display:grid;grid-template-columns:minmax(130px, .8fr) 1.2fr;gap:12px;padding:5px 7px;border-bottom:1px solid #ffffff08}.shortcuts dt{color:#c9c3e0;font:9px 'DM Mono',monospace}.shortcuts dd{margin:0;color:#9693a2}
  footer{padding:17px 0;color:#6f6d7a;font:9px 'DM Mono',monospace;letter-spacing:.04em}
  @media(max-width:520px){.docs-intro{padding:17px}.docs-index{padding:12px;grid-template-columns:1fr}.docs-content{padding-right:16px;padding-left:16px}.shortcuts div{grid-template-columns:110px 1fr}}
</style>
