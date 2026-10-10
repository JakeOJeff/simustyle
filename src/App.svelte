<script lang="ts">
  import { applyOps } from "./scene/applyOps";
  import { createEmptyScene, type Scene } from "./scene/types";
  import { serializeScene } from "./scene/serialize";

  let scene: Scene = $state(createEmptyScene());
  let message = $state("Scene core ready");

  function addBox() {
    const result = applyOps(scene, [{
      op: "create",
      id: `box_${scene.entities.length + 1}`,
      name: "Box",
      parent: null,
      components: { Transform: {}, Mesh: { shape: "box" }, Material: { color: "#8b7cff" } }
    }]);
    if (result.errors.length) {
      message = result.errors.join("; ");
      return;
    }
    scene = result.scene;
    message = `Added a box · ${scene.entities.length} ${scene.entities.length === 1 ? "entity" : "entities"}`;
  }
</script>

<svelte:head>
  <title>SimuStyle — Scene Editor</title>
</svelte:head>

<main class="window">
  <header class="topbar">
    <div class="brand"><span class="brand-mark">S</span><span>SimuStyle</span></div>
    <div class="milestone">SCENE CORE <span>·</span> M1</div>
  </header>
  <section class="workspace">
    <div class="eyebrow">A new kind of 3D workspace</div>
    <h1>Build a world<br /><em>from an idea.</em></h1>
    <p class="intro">A scene is a set of entities and components. Start with the core, then shape and simulate it.</p>
    <div class="actions">
      <button class="primary" onclick={addBox}><span>＋</span> Add a box to the scene</button>
      <span class="status"><i></i>{message}</span>
    </div>
    <div class="preview">
      <div class="preview-label"><span>SCENE DATA</span><span>{scene.entities.length.toString().padStart(2, "0")} ENTITIES</span></div>
      <pre>{serializeScene(scene)}</pre>
      <div class="preview-foot"><span>Schema validated</span><span>●</span></div>
    </div>
  </section>
  <footer><span>SimuStyle</span><span>SCENE · SIMULATION · MOTION</span></footer>
</main>
