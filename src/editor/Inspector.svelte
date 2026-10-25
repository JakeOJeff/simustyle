<script lang="ts">
  import { componentSchemas, type ComponentSchema, type FieldSchema } from "../registry";
  import type { Entity, Scene, SceneSettings, Vec3 } from "../scene/types";
  import { MESH_FIELD_SHAPES, meshTopRadius } from "../scene/meshGeometry";
  import { settingSchemas } from "../scene/validate";
  import { parseScript } from "../lang/parser";
  import { typecheckScript } from "../lang/checker";
  import { surfaceTexture, normalTexture, texturePaths, textureUrl } from "../materials/catalog";
  import type { ScriptHandler } from "../lang/ast";
  import { Atom, Camera, ChevronDown, ChevronRight, Clapperboard, Cuboid, Diamond, FileCode, Globe, Lightbulb, Link, Move3d, Palette, Plus, Shapes, Sparkles, X } from "@lucide/svelte";

  const componentIcons: Record<string, typeof Move3d> = {
    Transform: Move3d, Mesh: Shapes, Material: Palette, RigidBody: Atom, Collider: Cuboid, Joint: Link,
    Light: Lightbulb, Camera, Script: FileCode, Animator: Clapperboard
  };

  interface Props {
    scene: Scene;
    entity: Entity | null;
    onUpdate: (component: string, fields: Record<string, unknown>, phase?: "start" | "preview" | "end") => void;
    onRemove: (component: string) => void;
    onAdd: (component: string) => void;
    onKeyframe: (component: string, field: string) => void;
    onOpenScript: () => void;
    onRename: (name: string) => void;
    onReparent: (parent: string | null) => void;
    /** Change scene-wide settings (shown when nothing is selected). */
    onSettings: (settings: Partial<SceneSettings>) => void;
    /** Quick switches: Physics adds/removes the RigidBody; Collision sets Collider.enabled. */
    onPhysics: (enabled: boolean) => void;
    onCollision: (enabled: boolean) => void;
    /** Timeline playhead, so keyframe buttons can show whether a field is keyed right now. */
    playhead?: number;
    onOpenTimeline?: () => void;
    /** Opens the animation preset gallery next to the clicked button. */
    onAnimate?: (anchor: DOMRect) => void;
    /** Viewport grid snap, shown in the scene settings. */
    snap?: boolean;
    onSnap?: (enabled: boolean) => void;
    readOnly?: boolean;
  }

  let { scene, entity, onUpdate, onRemove, onAdd, onKeyframe, onOpenScript, onRename, onReparent, onSettings, onPhysics, onCollision, playhead = 0, onOpenTimeline, onAnimate, snap = false, onSnap, readOnly = false }: Props = $props();

  /** "keyed": a key sits at the playhead; "animated": the field has a track; otherwise not animated. */
  function keyState(component: string, field: string): "keyed" | "animated" | "none" {
    const tracks = entity?.components.Animator?.tracks;
    if (!Array.isArray(tracks)) return "none";
    const track = tracks.find((candidate) => candidate?.component === component && candidate?.field === field);
    if (!track || !Array.isArray(track.keys)) return "none";
    return track.keys.some((key: { time?: unknown }) => typeof key.time === "number" && Math.abs(key.time - playhead) < 0.001) ? "keyed" : "animated";
  }

  function entityIcon(current: Entity): typeof Move3d {
    if (current.components.Light) return Lightbulb;
    if (current.components.Camera) return Camera;
    if (current.components.Mesh) return Shapes;
    if (current.components.Script) return FileCode;
    return Globe;
  }

  /** Plain names for components, so the panel reads as "Shape" and "Look" rather than schema names. */
  const friendly: Record<string, { title: string; hint: string }> = {
    Transform: { title: "Position, rotation & size", hint: "Where it is. Inside a group, these are relative to the group." },
    Mesh: { title: "Shape", hint: "The visible 3D shape." },
    Material: { title: "Look", hint: "Color, surface texture, tiling, shine, glow, and see-through. Color tints the texture; white keeps its original colors." },
    RigidBody: { title: "Physics", hint: "Makes it fall, bounce, and collide during Play." },
    Collider: { title: "Collider", hint: "Makes it solid and touchable during Play, and can react when touched." },
    Joint: { title: "Joint", hint: "Connects this physics body to another object." },
    Light: { title: "Light", hint: "Lights up the scene." },
    Camera: { title: "Camera", hint: "Used in Play and Scene camera preview. Forward is local -Z. Parent objects here to carry them. Follow offset uses world axes; damping 0 snaps, larger values catch up faster. Fly: click view, WASD, Q/E, drag to look." },
    Script: { title: "Script", hint: "Plain-sentence instructions this object follows during Play." },
    Animator: { title: "Animation", hint: "Keyframes made on the Timeline." }
  };

  function label(name: string): string {
    if (name === "textureMapping") return "Mapping";
    if (name === "normalTexture") return "Normal map";
    if (name === "normalStrength") return "Normal map strength";
    if (name === "reliefDepth") return "Relief depth (m)";
    if (name === "occlusionStrength") return "Crevice shadow";
    const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced[0]!.toUpperCase() + spaced.slice(1).toLowerCase();
  }

  /** Slider fill amount as a CSS percentage, so the track can show progress up to the thumb. */
  function rangeFill(value: number, min: number, max: number): string {
    if (!(max > min) || !Number.isFinite(value)) return "0%";
    return `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`;
  }

  /** Objects this one could be put inside: anything except itself and its own children. */
  function parentOptions(current: Entity): Entity[] {
    const blocked = new Set([current.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of scene.entities) if (candidate.parent && blocked.has(candidate.parent) && !blocked.has(candidate.id)) { blocked.add(candidate.id); grew = true; }
    }
    return scene.entities.filter((candidate) => !blocked.has(candidate.id));
  }

  function eventLabel(handler: ScriptHandler): string {
    switch (handler.event) {
      case "start": return "when game starts";
      case "frame": return "forever";
      case "interval": return `every ${handler.intervalSeconds}s`;
      case "click": return "when clicked";
      case "key": return `when ${handler.key} is pressed`;
      case "collide": return "when touched";
      case "message": return `when I receive "${handler.message}"`;
      case "created": return handler.filter ? "when object is added" : "when anything is added";
    }
  }
  let openComponents = $state<Record<string, boolean>>({});
  let addComponent = $state("");

  function update(component: string, field: string, value: unknown, phase?: "start" | "preview" | "end") {
    onUpdate(component, { [field]: value }, phase);
  }

  function addableSchemas(): ComponentSchema[] {
    if (!entity) return [];
    return Object.values(componentSchemas).filter((schema) =>
      !(schema.name in entity.components) && (schema.requires ?? []).every((required) => required in entity.components)
    );
  }

  function inspectScript(source: unknown) {
    try {
      const program = parseScript(typeof source === "string" ? source : "");
      return { params: program.params, handlers: program.handlers, errors: typecheckScript(program) };
    } catch (error) {
      const issue = error as { line?: number; column?: number; message?: string };
      return { params: [], handlers: [] as ScriptHandler[], errors: [{ line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message ?? String(error) }] };
    }
  }

  function updateScriptParam(param: { name: string; type: string; min?: number; max?: number }, rawValue: unknown, values: Record<string, unknown>) {
    let value = rawValue;
    if (param.type === "float" || param.type === "int") {
      const numeric = Number(rawValue);
      value = Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, param.type === "int" ? Math.round(numeric) : numeric));
    }
    update("Script", "parameters", { ...values, [param.name]: value });
  }

  const settingHints: Record<keyof SceneSettings, string> = {
    collisions: "Off: objects pass through each other and touch events stop. The floor stays solid.",
    gravity: "Meters per second², usually 0 -9.81 0.",
    background: "Sky color behind the scene.",
    ambientLightIntensity: "Soft light on everything.",
    fixedTimestep: "Seconds per physics step. Smaller is more accurate and slower."
  };

  const gravityPresets: { name: string; gravity: Vec3 }[] = [
    { name: "Earth", gravity: [0, -9.81, 0] },
    { name: "Moon", gravity: [0, -1.62, 0] },
    { name: "Zero", gravity: [0, 0, 0] }
  ];

  /** The slider covers the useful range; the setting itself accepts up to 10. */
  const ambientSliderMax = 1;
  /** Live slider value while dragging, committed to the scene on release. */
  let ambientDraft = $state<number | null>(null);

  /** Objects collide when they have Physics or a Collider, unless the Collider is switched off. */
  function collides(current: Entity): boolean {
    const collider = current.components.Collider;
    return collider ? collider.enabled !== false : Boolean(current.components.RigidBody);
  }

  function keyframeable(field: FieldSchema): boolean { return field.type === "float" || field.type === "vec3" || field.type === "color"; }

  function commitNumber(input: HTMLInputElement, current: number, schema: FieldSchema, commit: (value: number) => void) {
    const raw = input.value.trim();
    const value = Number(raw);
    input.value = String(current);
    if (!raw || !Number.isFinite(value)) return;
    if ((schema.type === "float" || schema.type === "int" || schema.type === "vec3") &&
        (schema.min !== undefined && value < schema.min || schema.max !== undefined && value > schema.max)) return;
    if (schema.type === "int" && !Number.isInteger(value)) return;
    commit(value);
  }
</script>

<aside class="inspector panel" data-tutorial-target="inspector">
  <fieldset disabled={readOnly} style="display:contents">

  {#if entity}
    {@const EntityIcon = entityIcon(entity)}
    <div class="entity-heading">
      <div class="entity-icon"><EntityIcon size={15} /></div>
      <div class="entity-title"><strong>{entity.name}</strong><small>{entity.id}</small></div>
      {#if onAnimate && entity.components.Transform}
        <button class="heading-action animate" title="Animate with a preset" aria-label="Animate {entity.name} with a preset" onclick={(event) => onAnimate(event.currentTarget.getBoundingClientRect())}><Sparkles size={14} /></button>
      {/if}
    </div>
    <label class="name-field">
      <span>NAME</span>
      {#key entity.id}
        <input value={entity.name} maxlength="100" onchange={(event) => { const name = event.currentTarget.value.trim(); if (name && name !== entity.name) onRename(name); else event.currentTarget.value = entity.name; }} onkeydown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      {/key}
    </label>
    <label class="name-field">
      <span>INSIDE</span>
      <select class="field-select" value={entity.parent ?? "__top__"} onchange={(event) => { const parent = event.currentTarget.value === "__top__" ? null : event.currentTarget.value; event.currentTarget.value = entity.parent ?? "__top__"; onReparent(parent); }}>
        <option value="__top__">Nothing (top level)</option>
        {#each parentOptions(entity) as option (option.id)}<option value={option.id}>{option.name}</option>{/each}
      </select>
    </label>
    <div class="quick-toggles">
      <label title="Falls, bounces, and can be pushed during Play. Settings appear in the Physics section below."><span>Physics</span>
        <button class:checked={Boolean(entity.components.RigidBody)} class="toggle" data-tutorial-target="inspector-physics" role="switch" aria-label="Physics" aria-checked={Boolean(entity.components.RigidBody)} onclick={() => onPhysics(!entity.components.RigidBody)}><i></i></button>
      </label>
      {#if entity.components.RigidBody}
        <label title="Keeps this object fixed against gravity, pushes, and collisions. Turn off to use its selected body type again."><span>Anchor</span>
          <button class:checked={entity.components.RigidBody.anchored === true} class="toggle" data-tutorial-target="inspector-anchor" role="switch" aria-label="Anchor" aria-checked={entity.components.RigidBody.anchored === true} onclick={() => update("RigidBody", "anchored", entity.components.RigidBody.anchored !== true)}><i></i></button>
        </label>
      {/if}
      <label title={scene.settings.collisions ? "Solid and touchable during Play: bumps into things and fires 'when I touch'." : "Collisions are off for the whole scene (toolbar). This object's setting applies when they are back on."}><span>Collision{scene.settings.collisions ? "" : " (scene off)"}</span>
        <button class:checked={collides(entity)} class="toggle" data-tutorial-target="inspector-collision" role="switch" aria-label="Collision" aria-checked={collides(entity)} onclick={() => onCollision(!collides(entity))}><i></i></button>
      </label>
    </div>
    {#if scene.entities.some((candidate) => candidate.parent === entity.id)}
      <p class="children-note">Holds {scene.entities.filter((candidate) => candidate.parent === entity.id).length} object(s). Moving this moves them too.</p>
    {/if}
    {#each Object.entries(entity.components) as [component, fields] (component)}
      {@const schema = componentSchemas[component]}
      {#if schema}
        {@const ComponentIcon = componentIcons[component] ?? Shapes}
        <section class="component-card" data-tutorial-target="inspector-{component}">
          <div class="component-title">
            <button class="collapse" aria-label="Toggle {component}" aria-expanded={openComponents[component] ?? true} onclick={() => openComponents[component] = !(openComponents[component] ?? true)}>{#if openComponents[component] ?? true}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}</button>
            <span class="component-icon"><ComponentIcon size={13} /></span>
            <span title={friendly[component]?.hint ?? schema.description}>{friendly[component]?.title ?? component}</span>
            <button class="remove-component" title="Remove {component}" aria-label="Remove {component}" onclick={() => onRemove(component)}><X size={13} /></button>
          </div>
          {#if openComponents[component] ?? true}
            <div class="fields">
              {#if component === "Material" && surfaceTexture(fields.texture)}
                <div class="surface-preview">
                  <img src={textureUrl(texturePaths(fields.texture).Color!)} alt="{surfaceTexture(fields.texture)?.label} texture" width="48" height="48" />
                  <span>White keeps the texture colors.</span>
                </div>
              {/if}
              {#if component === "Material" && normalTexture(fields)}
                {@const normal = normalTexture(fields)!}
                <div class="surface-preview normal-preview">
                  <img src={textureUrl(texturePaths(normal.id).NormalGL!)} alt="{normal.label} normal map" width="48" height="48" />
                  <span><strong>{normal.label} normal map</strong><br />Adds surface lighting detail. Raise strength for fine grain.</span>
                </div>
              {/if}
              {#if component === "Material" && (surfaceTexture(fields.texture) || normalTexture(fields))}
                <p class="mapping-hint">{fields.textureMapping === "stretch" ? "Fits one image across each surface." : fields.textureMapping === "custom" ? "Set your own repeat counts below." : "Repeats automatically at one tile per meter, including group size. Resizing keeps the pattern size."}</p>
              {/if}
              {#if component === "Script"}
                {@const summary = inspectScript(fields.source)}
                <p class="script-owner">Runs on <b>{entity.name}</b> during Play. In this script, <code>me</code> means {entity.name}{scene.entities.some((candidate) => candidate.parent === entity.id) ? " and " : ""}{#if scene.entities.some((candidate) => candidate.parent === entity.id)}<code>my children</code> means the objects inside it{/if}.</p>
                {#if summary.handlers.length}
                  <div class="event-chips">{#each summary.handlers as handler}<span>{eventLabel(handler)}</span>{/each}</div>
                {:else if !summary.errors.length}
                  <p class="script-owner">No event lines yet. Start with <code>when game starts</code>.</p>
                {/if}
                <button class="open-script" onclick={onOpenScript}>Edit script</button>
              {/if}
              {#each Object.entries(schema.fields) as [fieldName, field] (fieldName)}
                {#if !(component === "Script" && fieldName === "source") && !(component === "RigidBody" && fieldName === "anchored") && !(component === "Mesh" && MESH_FIELD_SHAPES[fieldName] && !MESH_FIELD_SHAPES[fieldName]!.includes(String(fields.shape ?? "box"))) && !(component === "Material" && (
                  ((fieldName === "textureRepeatX" || fieldName === "textureRepeatY") && ((!surfaceTexture(fields.texture) && !normalTexture(fields)) || fields.textureMapping !== "custom")) ||
                  (fieldName === "textureMapping" && !surfaceTexture(fields.texture) && !normalTexture(fields)) ||
                  (fieldName === "normalStrength" && !normalTexture(fields)) ||
                  ((fieldName === "reliefDepth" || fieldName === "occlusionStrength") && !(normalTexture(fields) ?? surfaceTexture(fields.texture))?.normal)
                ))}
                <div class="inspector-animatable-field">
                  {@render fieldControl(fieldName, field, fields[fieldName] ?? (component === "Mesh" && fieldName === "radiusTop" ? meshTopRadius(fields) : field.default), scene, (value, phase) => update(component, fieldName, value, phase))}
                  {#if keyframeable(field)}
                    {@const keyStatus = keyState(component, fieldName)}
                    <button class="keyframe-button key-{keyStatus}" data-tutorial-target="inspector-keyframe" aria-label="{keyStatus === 'keyed' ? 'Update' : 'Add'} keyframe for {component}.{fieldName}" title={keyStatus === "keyed" ? "Keyed at the playhead: click to update it with this value" : keyStatus === "animated" ? "Animated: click to add a key at the playhead" : "Add a keyframe at the playhead"} onclick={() => onKeyframe(component, fieldName)}><Diamond size={11} fill={keyStatus === "keyed" ? "currentColor" : "none"} /></button>
                  {/if}
                </div>
                {/if}
              {/each}
              {#if component === "Script"}
                {@const script = inspectScript(fields.source)}
                {#if script.params.length}
                  <div class="script-params"><strong>SETTINGS</strong>
                    {#each script.params as param (param.name)}
                      {@const values = (fields.parameters as Record<string, unknown> | undefined) ?? {}}
                      {@const value = values[param.name] ?? param.defaultValue}
                      <label><span>{param.name}</span>
                        {#if param.type === "float" || param.type === "int"}
                          {#if param.min !== undefined && param.max !== undefined}<input aria-label="{param.name} slider" type="range" style:--fill={rangeFill(Number(value), param.min, param.max)} min={param.min} max={param.max} step={param.type === "int" ? 1 : (param.max - param.min) / 100} value={Number(value)} oninput={(event) => updateScriptParam(param, Number(event.currentTarget.value), values)} />{/if}
                          <input type="number" min={param.min} max={param.max} step={param.type === "int" ? 1 : "any"} value={Number(value)} onchange={(event) => updateScriptParam(param, Number(event.currentTarget.value), values)} />
                        {:else if param.type === "bool"}
                          <input type="checkbox" checked={Boolean(value)} onchange={(event) => updateScriptParam(param, event.currentTarget.checked, values)} />
                        {:else if param.type === "color"}
                          <input type="color" value={String(value)} onchange={(event) => updateScriptParam(param, event.currentTarget.value, values)} />
                        {:else}
                          <input type="text" value={String(value)} onchange={(event) => updateScriptParam(param, event.currentTarget.value, values)} />
                        {/if}
                      </label>
                    {/each}
                  </div>
                {/if}
                {#if script.errors.length}
                  <div class="script-errors" role="alert">{#each script.errors as issue}<div>Line {issue.line}, column {issue.column}: {issue.message}</div>{/each}</div>
                {/if}
              {/if}
              {#if schema.managedFields}
                {#if component === "Animator"}
                  {@const trackCount = Array.isArray(fields.tracks) ? fields.tracks.length : 0}
                  <div class="animator-actions">
                    <span class="managed-hint">{trackCount ? `${trackCount} animated propert${trackCount === 1 ? "y" : "ies"}` : "No tracks yet"}</span>
                    {#if onOpenTimeline}<button onclick={onOpenTimeline}><Clapperboard size={12} /> Timeline</button>{/if}
                    {#if onAnimate}<button class="accent" onclick={(event) => onAnimate(event.currentTarget.getBoundingClientRect())}><Sparkles size={12} /> Presets</button>{/if}
                  </div>
                {:else if component !== "Script"}<div class="managed-hint">Tracks are edited in the timeline.</div>{/if}
              {/if}
            </div>
          {/if}
        </section>
      {/if}
    {/each}
    {#if !entity.components.Script}
      <section class="add-script-card">
        <strong>Make it do something</strong>
        <p>Give {entity.name} a script: plain sentences such as <code>when clicked</code> → <code>spin</code>.</p>
        <button class="open-script" data-tutorial-target="inspector-add-script" onclick={onOpenScript}>+ Add a script</button>
      </section>
    {/if}
    <div class="add-component-row" data-tutorial-target="inspector-add-feature">
      <select bind:value={addComponent} aria-label="Component to add">
        <option value="">Add a feature…</option>
        {#each addableSchemas() as schema (schema.name)}<option value={schema.name}>{friendly[schema.name]?.title ?? schema.name} — {friendly[schema.name]?.hint ?? schema.description}</option>{/each}
      </select>
      <button disabled={!addComponent} aria-label="Add feature" onclick={() => { onAdd(addComponent); addComponent = ""; }}><Plus size={15} /></button>
    </div>
  {:else}
    {@const settings = scene.settings}
    {@const ambient = ambientDraft ?? settings.ambientLightIntensity}
    <div class="entity-heading scene-heading">
      <div class="entity-icon"><Globe size={15} /></div>
      <div class="entity-title"><strong>Scene</strong><small>Select an object to edit it instead</small></div>
    </div>
    <div data-tutorial-target="inspector-scene-settings">
      <section class="settings-group">
        <h3>Physics</h3>
        <div class="setting-row" title={settingHints.collisions}>
          <span class="setting-label">Collisions</span>
          <button class:checked={settings.collisions} class="toggle setting-toggle" role="switch" aria-label="Collisions" aria-checked={settings.collisions} onclick={() => onSettings({ collisions: !settings.collisions })}><i></i></button>
        </div>
        <div class="setting-row" title={settingHints.gravity}>
          <span class="setting-label">Gravity</span>
          <div class="vector-input">{#each [0, 1, 2] as axis}<label class="axis-{axis}"><span>{["X", "Y", "Z"][axis]}</span><input aria-label="Gravity {["x", "y", "z"][axis]}" type="number" step="any" value={settings.gravity[axis]} onchange={(event) => commitNumber(event.currentTarget, settings.gravity[axis]!, settingSchemas.gravity, (value) => { const next = [...settings.gravity] as Vec3; next[axis] = value; onSettings({ gravity: next }); })} /></label>{/each}</div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Preset</span>
          <div class="segmented" role="group" aria-label="Gravity preset">
            {#each gravityPresets as preset (preset.name)}
              {@const active = preset.gravity.every((component, axis) => Math.abs(component - settings.gravity[axis]!) < 1e-6)}
              <button class:active aria-pressed={active} title="{preset.name} gravity: {preset.gravity[1]} m/s²" onclick={() => onSettings({ gravity: [...preset.gravity] as Vec3 })}>{preset.name}</button>
            {/each}
          </div>
        </div>
        <div class="setting-row" title={settingHints.fixedTimestep}>
          <span class="setting-label">Step</span>
          <label class="unit-input"><input aria-label="Physics step in seconds" type="number" min="0.001" max="0.1" step="0.001" value={Number(settings.fixedTimestep.toFixed(4))} onchange={(event) => { const value = Number(event.currentTarget.value); if (value >= 0.001 && value <= 0.1) onSettings({ fixedTimestep: value }); else event.currentTarget.value = String(settings.fixedTimestep); }} /><em>s</em></label>
        </div>
      </section>
      <section class="settings-group">
        <h3>Environment</h3>
        <div class="setting-row" title={settingHints.background}>
          <span class="setting-label">Sky</span>
          <label class="color-field">
            <input class="swatch" aria-label="Sky color" type="color" value={settings.background} onchange={(event) => onSettings({ background: event.currentTarget.value })} />
            {#key settings.background}<input aria-label="Sky color hex" type="text" maxlength="7" spellcheck="false" value={settings.background.toUpperCase()} onchange={(event) => { const value = event.currentTarget.value.trim(); const hex = value.startsWith("#") ? value : `#${value}`; if (/^#[0-9a-f]{6}$/i.test(hex)) onSettings({ background: hex.toLowerCase() }); else event.currentTarget.value = settings.background.toUpperCase(); }} />{/key}
          </label>
        </div>
        <div class="setting-row" title={settingHints.ambientLightIntensity}>
          <span class="setting-label">Ambient</span>
          <div class="slider-field">
            <input aria-label="Ambient light" type="range" min="0" max={ambientSliderMax} step="0.01" style:--fill={rangeFill(ambient, 0, ambientSliderMax)} value={Math.min(ambient, ambientSliderMax)} oninput={(event) => ambientDraft = Number(event.currentTarget.value)} onchange={(event) => { ambientDraft = null; onSettings({ ambientLightIntensity: Number(event.currentTarget.value) }); }} />
            <output>{ambient.toFixed(2)}</output>
          </div>
        </div>
      </section>
      {#if onSnap}
        <section class="settings-group">
          <h3>Grid</h3>
          <div class="setting-row" title="Snap moves to 0.5 m, turns to 15°, and scaling to 0.1 steps">
            <span class="setting-label">Snap</span>
            <div class="segmented" role="group" aria-label="Grid snap">
              <button class:active={!snap} aria-pressed={!snap} onclick={() => onSnap(false)}>Off</button>
              <button class="mono" class:active={snap} aria-pressed={snap} onclick={() => onSnap(true)}>0.5 m</button>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
  </fieldset>
</aside>

{#snippet fieldControl(name: string, schema: FieldSchema, value: unknown, scene: Scene, onchange: (value: unknown, phase?: "start" | "preview" | "end") => void)}
  <div class="field-row">
    <label class="field-label" for="field-{name}">{label(name)}</label>
    {#if schema.type === "float"}
      <div class="range-input"><input id="field-{name}" type="range" style:--fill={rangeFill(Number(value), schema.min, schema.max)} min={schema.min} max={schema.max} step={schema.step ?? (schema.max - schema.min) / 100} value={Number(value)} onpointerdown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onchange(Number(value), "start"); }} oninput={(event) => onchange(Number(event.currentTarget.value), "preview")} onpointerup={(event) => onchange(Number(event.currentTarget.value), "end")} onpointercancel={(event) => onchange(Number(event.currentTarget.value), "end")} onlostpointercapture={(event) => onchange(Number(event.currentTarget.value), "end")} /><input class="numeric" type="number" min={schema.min} max={schema.max} step={schema.step ?? "any"} value={Number(value)} onchange={(event) => commitNumber(event.currentTarget, Number(value), schema, onchange)} /></div>
    {:else if schema.type === "int"}
      <input id="field-{name}" class="numeric full" type="number" min={schema.min} max={schema.max} step="1" value={Number(value)} onchange={(event) => commitNumber(event.currentTarget, Number(value), schema, onchange)} />
    {:else if schema.type === "bool"}
      <button id="field-{name}" class:checked={Boolean(value)} class="toggle" role="switch" aria-label={name} aria-checked={Boolean(value)} onclick={() => onchange(!Boolean(value))}><i></i></button>
    {:else if schema.type === "color"}
      <div class="color-input"><input id="field-{name}" type="color" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} /><code>{String(value)}</code></div>
    {:else if schema.type === "vec3"}
      <div class="vector-input">{#each [0, 1, 2] as axis}<label class="axis-{axis}"><span>{["X", "Y", "Z"][axis]}</span><input aria-label="{name} {["x", "y", "z"][axis]}" type="number" step="any" value={Number((value as number[])[axis])} onchange={(event) => commitNumber(event.currentTarget, Number((value as number[])[axis]), schema, (part) => { const next = [...(value as number[])]; next[axis] = part; onchange(next); })} /></label>{/each}</div>
    {:else if schema.type === "enum"}
      <select id="field-{name}" class="field-select" value={String(value)} onchange={(event) => onchange(event.currentTarget.value)}>{#each schema.options as option}<option value={option}>{name === "texture" ? surfaceTexture(option)?.label ?? "None" : name === "normalTexture" ? option === "auto" ? "Auto (match texture)" : option === "none" ? "Off" : surfaceTexture(option)?.label ?? option : name === "textureMapping" ? { auto: "Auto repeat", stretch: "Stretch", custom: "Custom" }[option as "auto" | "stretch" | "custom"] : option}</option>{/each}</select>
    {:else if schema.type === "entityRef"}
      <select id="field-{name}" class="field-select" value={value === null ? "__world__" : String(value)} onchange={(event) => onchange(event.currentTarget.value === "__world__" ? null : event.currentTarget.value)}><option value="__world__">{name === "followTarget" || name === "lookAtTarget" ? "None" : "World"}</option>{#each scene.entities.filter((option) => !(name === "followTarget" || name === "lookAtTarget") || option.id !== entity?.id) as option}<option value={option.id}>{option.name}</option>{/each}</select>
    {:else}
      {#if schema.multiline}<textarea id="field-{name}" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)}></textarea>{:else}<input id="field-{name}" class="text-input" type="text" maxlength={schema.maxLength} value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} />{/if}
    {/if}
  </div>
{/snippet}

<style>
  .surface-preview{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:#9999a5;font-size:10px;line-height:1.5}.surface-preview img{border-radius:5px;object-fit:cover;flex-shrink:0}
  .mapping-hint{margin:0 0 10px;color:#9999a5;font-size:10px;line-height:1.5}
  .inspector{width:292px;min-width:260px;overflow:auto;background:var(--window-bg,#1c1c1f);border-left:1px solid #ffffff10}.entity-heading{display:flex;align-items:center;gap:10px;padding:17px 14px 13px}.entity-icon{display:grid;place-items:center;width:30px;height:30px;background:#2c2c31;border-radius:7px;color:#a99bff}.entity-title{display:grid;gap:3px}.entity-title strong{font-size:12px;font-weight:600}.entity-title small{font:9px 'DM Mono',monospace;color:#747480}.name-field{display:grid;gap:6px;padding:0 14px 13px}.name-field span,.field-label{font:9px 'DM Mono',monospace;color:#888894;text-transform:uppercase;letter-spacing:.07em}.name-field input,.text-input,textarea{width:100%;height:29px;background:#131315;border:1px solid #ffffff12;border-radius:6px;color:#cacacf;padding:0 8px;font:11px 'DM Sans',sans-serif}.component-card{border-top:1px solid #ffffff0d}.component-title{height:36px;padding:0 10px;display:flex;align-items:center;gap:6px;color:#d6d6d9;font-size:11px;font-weight:600}.collapse,.remove-component{border:0;background:none;color:#767682;cursor:pointer}.collapse{width:18px;font-size:16px}.remove-component{margin-left:auto;font-size:17px}.remove-component:hover{color:#ff7a87}.fields{padding:2px 11px 10px}.field-row{display:grid;gap:7px;padding:7px 0}.range-input{display:grid;grid-template-columns:1fr 64px;align-items:center;gap:8px}.numeric{width:64px;height:25px;background:#131315;border:1px solid #ffffff13;border-radius:6px;color:#d4d4d8;text-align:right;padding:0 5px;font:10px 'DM Mono',monospace}.numeric.full{width:100%}.toggle{width:30px;height:17px;border:0;border-radius:10px;background:#36363b;padding:2px;cursor:pointer}.toggle i{display:block;width:13px;height:13px;background:#94949e;border-radius:50%;transition:transform .15s}.toggle.checked{background:#7c6cf0}.toggle.checked i{transform:translateX(13px);background:#fff}.color-input{display:flex;align-items:center;gap:8px}.color-input input{width:28px;height:23px;background:none;border:0;padding:0;cursor:pointer}.color-input code{font:10px 'DM Mono',monospace;color:#c3c3c9}.vector-input{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.vector-input label{display:flex;align-items:center;border:1px solid #ffffff12;border-radius:6px;background:#131315;overflow:hidden}.vector-input span{padding-left:5px;font:9px 'DM Mono',monospace;color:#82828e}.vector-input .axis-0 span{color:#e88689}.vector-input .axis-1 span{color:#87c99f}.vector-input .axis-2 span{color:#829bdf}.vector-input input{width:100%;min-width:0;height:25px;background:transparent;border:0;outline:none;color:#e0e0e3;text-align:right;padding:0 4px;font:10px 'DM Mono',monospace}.field-select{height:27px;width:100%;background:#131315;border:1px solid #ffffff13;border-radius:6px;color:#d0d0d5;padding:0 6px;font:10px 'DM Sans',sans-serif}.text-input{height:26px}textarea{height:80px;padding:7px;resize:vertical;font:10px/1.5 'DM Mono',monospace}.managed-hint{color:#767682;font-size:9px;padding:7px 1px}.add-component-row{display:grid;grid-template-columns:1fr 29px;gap:5px;padding:12px;border-top:1px solid #ffffff0d}.add-component-row select{height:29px;background:#131315;border:1px solid #ffffff13;border-radius:6px;color:#aaaab2;padding:0 7px;font:10px 'DM Sans',sans-serif}.add-component-row button{border:0;border-radius:6px;background:#7c6cf0;color:#fff;font-size:17px;cursor:pointer}.add-component-row button:hover:not(:disabled){background:#8b7cf6}.add-component-row button:disabled{opacity:.4;cursor:default}
  .script-params{display:grid;gap:7px;margin:8px 0;padding:9px;background:#131315;border:1px solid #ffffff10;border-radius:8px}.script-params>strong{font:9px 'DM Mono',monospace;color:#8e87bd;letter-spacing:.08em}.script-params label{display:flex;align-items:center;justify-content:space-between;color:#b9b9bf;font-size:10px}.script-params input:not([type=range]){width:100px;height:25px;background:#1b1b1f;color:#e3e3e5;border:1px solid #ffffff14;border-radius:6px;padding:0 6px}.script-params input[type=range]{flex:1;min-width:60px;margin:0 8px}.script-errors{display:grid;gap:4px;color:#ff8992;font:10px/1.4 'DM Mono',monospace;padding:7px 2px}
  .quick-toggles{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 14px 13px}.quick-toggles label{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 9px;background:#131315;border:1px solid #ffffff12;border-radius:6px;cursor:pointer}.quick-toggles span{font:9px 'DM Mono',monospace;color:#888894;text-transform:uppercase;letter-spacing:.07em}
  .children-note{margin:-4px 14px 12px;color:#8e8e99;font-size:10px}
  .script-owner{margin:4px 1px 8px;color:#aaaab2;font-size:10.5px;line-height:1.5}.script-owner b{color:#e9e9eb;font-weight:600}.script-owner code,.add-script-card code{color:#7fd1ff;font:10px 'DM Mono',monospace}
  .event-chips{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.event-chips span{padding:3px 7px;border-radius:10px;background:#3b3566;color:#e1dbff;font:9.5px 'DM Mono',monospace}
  .add-script-card{margin:4px 12px 0;padding:11px;border:1px dashed #7fd1ff40;border-radius:7px;background:#1e1e22}.add-script-card strong{font-size:11px;color:#d9eefa}.add-script-card p{margin:5px 0 4px;color:#9fb4c2;font-size:10.5px;line-height:1.5}
  .field-label{text-transform:none!important;letter-spacing:.02em!important;font-size:10px!important}
  .open-script{width:100%;height:30px;margin:6px 0 4px;border:1px solid #7fd1ff40;border-radius:6px;background:#1f2f3a;color:#a9def7;font-size:10.5px;cursor:pointer}.open-script:hover{background:#26394a}
  .inspector-animatable-field{position:relative}.inspector-animatable-field .field-row{padding-right:22px}.keyframe-button{position:absolute;right:0;top:5px;display:grid;width:20px;height:23px;place-items:center;padding:0;border:0;border-radius:4px;background:none;color:#5f5f69;cursor:pointer;transition:color .12s,background .12s}.keyframe-button:hover{background:#ffffff0c;color:#a99bff}.keyframe-button.key-animated{color:#8b7cf6}.keyframe-button.key-keyed{color:#d2c8ff;filter:drop-shadow(0 0 4px #a99bff99)}
  .component-title .collapse,.component-title .remove-component{display:grid;place-items:center;height:22px;padding:0;border-radius:4px}.component-title .remove-component{width:22px}.component-title .collapse:hover,.component-title .remove-component:hover{background:#ffffff0c}
  .component-icon{display:grid;place-items:center;color:#a99bff}
  .entity-heading .heading-action{display:grid;width:28px;height:28px;margin-left:auto;place-items:center;padding:0;border:1px solid #7c6cf066;border-radius:7px;background:#3b3566;color:#e1dbff;cursor:pointer}.entity-heading .heading-action:hover{background:#463f78;border-color:#a99bff88;color:#fff}
  .animator-actions{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:4px 0}.animator-actions .managed-hint{flex:1;padding:0}.animator-actions button{display:flex;align-items:center;gap:5px;height:25px;padding:0 9px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#cfcbe0;font-size:10px;cursor:pointer}.animator-actions button:hover{background:#2d2d33;color:#fff}.animator-actions button.accent{border-color:#7c6cf066;background:#3b3566;color:#e1dbff}.animator-actions button.accent:hover{background:#463f78}
  .add-component-row button{display:grid;place-items:center}
  /* Scene settings: labelled rows grouped under small caps headings. */
  .scene-heading{padding:12px 14px;border-bottom:1px solid var(--window-line,#ffffff0d)}
  .scene-heading .entity-title strong{font-size:13px}
  .scene-heading .entity-title small{font:11px 'DM Sans',sans-serif;color:#8a8a95}
  .settings-group{display:grid;gap:6px;padding:12px 14px 14px;border-bottom:1px solid var(--window-line,#ffffff0d)}
  .settings-group h3{margin:0 0 4px;color:#8a8a95;font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}
  .setting-row{display:grid;grid-template-columns:68px minmax(0,1fr);align-items:center;gap:8px;min-height:32px}
  .setting-label{color:#dcdce0;font-size:12px}
  .setting-toggle{justify-self:end;width:34px;height:20px}.setting-toggle i{width:16px;height:16px}.setting-toggle.checked i{transform:translateX(14px)}
  .setting-row .vector-input label{height:30px;background:var(--field-bg,#161618)}.setting-row .vector-input span{padding-left:7px}.setting-row .vector-input input{height:100%;text-align:left;padding:0 6px;font-size:11px}
  .segmented{display:grid;grid-auto-columns:1fr;grid-auto-flow:column;gap:4px}
  .segmented button{height:30px;padding:0 6px;border:1px solid var(--field-border,#ffffff14);border-radius:6px;background:var(--field-bg,#161618);color:#a9a9b2;font-size:11.5px;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
  .segmented button:hover:not(.active){border-color:#ffffff26;color:#f2f2f3}
  .segmented button.active{border-color:#8b7cf6;background:#3b3566;color:#fff}
  .segmented button.mono{font-family:'DM Mono',monospace;font-size:11px}
  .unit-input,.color-field{display:flex;align-items:center;gap:8px;height:30px;padding:0 9px;border:1px solid var(--field-border,#ffffff14);border-radius:6px;background:var(--field-bg,#161618)}
  .unit-input:focus-within,.color-field:focus-within,.setting-row .vector-input label:focus-within{border-color:#a99bff80}
  .unit-input input,.color-field input[type=text]{flex:1;min-width:0;height:100%;padding:0;border:0;outline:none;background:transparent;color:#e6e6e9;font:11px 'DM Mono',monospace}
  .unit-input em{color:#74747f;font:normal 11px 'DM Mono',monospace}
  .color-field{padding-left:6px}
  .color-field .swatch{width:20px;height:20px;flex:none;padding:0;border:1px solid #ffffff26;border-radius:4px;background:none;cursor:pointer;overflow:hidden}
  .color-field .swatch::-webkit-color-swatch-wrapper{padding:0}.color-field .swatch::-webkit-color-swatch{border:0;border-radius:3px}.color-field .swatch::-moz-color-swatch{border:0;border-radius:3px}
  .slider-field{display:grid;grid-template-columns:minmax(0,1fr) 34px;align-items:center;gap:10px}
  .slider-field output{color:#c9c9cf;font:11px 'DM Mono',monospace;text-align:right}
  .settings-group button:focus-visible,.settings-group input:focus-visible{outline:2px solid var(--accent,#a99bff);outline-offset:1px}
</style>
