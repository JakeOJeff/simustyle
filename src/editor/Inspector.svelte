<script lang="ts">
  import { componentSchemas, type ComponentSchema, type FieldSchema } from "../registry";
  import type { Entity, Scene, SceneSettings } from "../scene/types";
  import { settingSchemas } from "../scene/validate";
  import { parseScript } from "../lang/parser";
  import { typecheckScript } from "../lang/checker";
  import type { ScriptHandler } from "../lang/ast";

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
  }

  let { scene, entity, onUpdate, onRemove, onAdd, onKeyframe, onOpenScript, onRename, onReparent, onSettings }: Props = $props();

  /** Plain names for components, so the panel reads as "Shape" and "Look" rather than schema names. */
  const friendly: Record<string, { title: string; hint: string }> = {
    Transform: { title: "Position, rotation & size", hint: "Where it is. Inside a group, these are relative to the group." },
    Mesh: { title: "Shape", hint: "The visible 3D shape." },
    Material: { title: "Look", hint: "Color, shine, glow, and see-through." },
    RigidBody: { title: "Physics", hint: "Makes it fall, bounce, and collide during Play." },
    Collider: { title: "Collider", hint: "Makes it solid and touchable during Play, and can react when touched." },
    Joint: { title: "Joint", hint: "Connects this physics body to another object." },
    Light: { title: "Light", hint: "Lights up the scene." },
    Camera: { title: "Camera", hint: "A viewpoint for the scene." },
    Script: { title: "Script", hint: "Plain-sentence instructions this object follows during Play." },
    Animator: { title: "Animation", hint: "Keyframes made on the Timeline." }
  };

  function label(name: string): string {
    const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced[0]!.toUpperCase() + spaced.slice(1).toLowerCase();
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

  /** Scene settings in the order a person would look for them. */
  const sceneSettings: { key: keyof SceneSettings; title: string; hint: string }[] = [
    { key: "collisions", title: "Collisions", hint: "Off: objects pass through each other and touch events stop. The floor stays solid." },
    { key: "gravity", title: "Gravity", hint: "Meters per second², usually 0 -9.81 0." },
    { key: "background", title: "Background", hint: "Sky color behind the scene." },
    { key: "ambientLightIntensity", title: "Ambient light", hint: "Soft light on everything." },
    { key: "fixedTimestep", title: "Physics step", hint: "Seconds per physics step. Smaller is more accurate and slower." }
  ];

  function keyframeable(field: FieldSchema): boolean { return field.type === "float" || field.type === "vec3" || field.type === "color"; }
</script>

<aside class="inspector panel">
  <div class="panel-heading"><span>INSPECTOR</span><span class="muted">{entity ? "ENTITY" : "—"}</span></div>
  {#if entity}
    <div class="entity-heading">
      <div class="entity-icon">◇</div>
      <div class="entity-title"><strong>{entity.name}</strong><small>{entity.id}</small></div>
    </div>
    <label class="name-field">
      <span>NAME</span>
      {#key entity.id}
        <input value={entity.name} maxlength="100" onchange={(event) => { const name = event.currentTarget.value.trim(); if (name && name !== entity.name) onRename(name); else event.currentTarget.value = entity.name; }} onkeydown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      {/key}
    </label>
    <label class="name-field">
      <span>INSIDE</span>
      <select class="field-select" value={entity.parent ?? "__top__"} onchange={(event) => onReparent(event.currentTarget.value === "__top__" ? null : event.currentTarget.value)}>
        <option value="__top__">Nothing (top level)</option>
        {#each parentOptions(entity) as option (option.id)}<option value={option.id}>{option.name}</option>{/each}
      </select>
    </label>
    {#if scene.entities.some((candidate) => candidate.parent === entity.id)}
      <p class="children-note">Holds {scene.entities.filter((candidate) => candidate.parent === entity.id).length} object(s). Moving this moves them too.</p>
    {/if}
    {#each Object.entries(entity.components) as [component, fields] (component)}
      {@const schema = componentSchemas[component]}
      {#if schema}
        <section class="component-card">
          <div class="component-title">
            <button class="collapse" aria-label="Toggle {component}" onclick={() => openComponents[component] = !(openComponents[component] ?? true)}>{(openComponents[component] ?? true) ? "⌄" : "›"}</button>
            <span title={friendly[component]?.hint ?? schema.description}>{friendly[component]?.title ?? component}</span>
            <button class="remove-component" title="Remove {component}" onclick={() => onRemove(component)}>×</button>
          </div>
          {#if openComponents[component] ?? true}
            <div class="fields">
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
                {#if !(component === "Script" && fieldName === "source")}
                <div class="inspector-animatable-field">
                  {@render fieldControl(fieldName, field, fields[fieldName] ?? field.default, scene, (value, phase) => update(component, fieldName, value, phase))}
                  {#if keyframeable(field)}<button class="keyframe-button" aria-label="Add keyframe for {component}.{fieldName}" title="Add keyframe at current playhead" onclick={() => onKeyframe(component, fieldName)}>◇</button>{/if}
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
                          {#if param.min !== undefined && param.max !== undefined}<input aria-label="{param.name} slider" type="range" min={param.min} max={param.max} step={param.type === "int" ? 1 : (param.max - param.min) / 100} value={Number(value)} oninput={(event) => updateScriptParam(param, Number(event.currentTarget.value), values)} />{/if}
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
                {#if component !== "Script"}<div class="managed-hint">Tracks are edited in the timeline.</div>{/if}
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
        <button class="open-script" onclick={onOpenScript}>+ Add a script</button>
      </section>
    {/if}
    <div class="add-component-row">
      <select bind:value={addComponent} aria-label="Component to add">
        <option value="">Add a feature…</option>
        {#each addableSchemas() as schema (schema.name)}<option value={schema.name}>{friendly[schema.name]?.title ?? schema.name} — {friendly[schema.name]?.hint ?? schema.description}</option>{/each}
      </select>
      <button disabled={!addComponent} onclick={() => { onAdd(addComponent); addComponent = ""; }}>＋</button>
    </div>
  {:else}
    <div class="empty-inspector"><span>◇</span><p>Select an object in the viewport or the Scene panel to see and change it here.</p></div>
    <section class="component-card">
      <div class="component-title"><span title="Settings for the whole scene">Scene settings</span></div>
      <div class="fields">
        {#each sceneSettings as setting (setting.key)}
          <div title={setting.hint}>
            {@render fieldControl(setting.title, settingSchemas[setting.key], scene.settings[setting.key], scene, (value, phase) => { if (phase === undefined || phase === "end") onSettings({ [setting.key]: value }); })}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</aside>

{#snippet fieldControl(name: string, schema: FieldSchema, value: unknown, scene: Scene, onchange: (value: unknown, phase?: "start" | "preview" | "end") => void)}
  <div class="field-row">
    <label class="field-label" for="field-{name}">{label(name)}</label>
    {#if schema.type === "float"}
      <div class="range-input"><input id="field-{name}" type="range" min={schema.min} max={schema.max} step={schema.step ?? (schema.max - schema.min) / 100} value={Number(value)} onpointerdown={() => onchange(Number(value), "start")} oninput={(event) => onchange(Number(event.currentTarget.value), "preview")} onpointerup={(event) => onchange(Number(event.currentTarget.value), "end")} onpointercancel={() => onchange(Number(value), "end")} /><input class="numeric" type="number" min={schema.min} max={schema.max} step={schema.step ?? "any"} value={Number(value)} onchange={(event) => onchange(Number(event.currentTarget.value))} /></div>
    {:else if schema.type === "int"}
      <input id="field-{name}" class="numeric full" type="number" min={schema.min} max={schema.max} step="1" value={Number(value)} onchange={(event) => onchange(Number(event.currentTarget.value))} />
    {:else if schema.type === "bool"}
      <button id="field-{name}" class:checked={Boolean(value)} class="toggle" role="switch" aria-label={name} aria-checked={Boolean(value)} onclick={() => onchange(!Boolean(value))}><i></i></button>
    {:else if schema.type === "color"}
      <div class="color-input"><input id="field-{name}" type="color" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} /><code>{String(value)}</code></div>
    {:else if schema.type === "vec3"}
      <div class="vector-input">{#each [0, 1, 2] as axis}<label class="axis-{axis}"><span>{["X", "Y", "Z"][axis]}</span><input aria-label="{name} {["x", "y", "z"][axis]}" type="number" step="any" value={Number((value as number[])[axis])} onchange={(event) => { const next = [...(value as number[])]; next[axis] = Number(event.currentTarget.value); onchange(next); }} /></label>{/each}</div>
    {:else if schema.type === "enum"}
      <select id="field-{name}" class="field-select" value={String(value)} onchange={(event) => onchange(event.currentTarget.value)}>{#each schema.options as option}<option value={option}>{option}</option>{/each}</select>
    {:else if schema.type === "entityRef"}
      <select id="field-{name}" class="field-select" value={value === null ? "__world__" : String(value)} onchange={(event) => onchange(event.currentTarget.value === "__world__" ? null : event.currentTarget.value)}><option value="__world__">World</option>{#each scene.entities as option}<option value={option.id}>{option.name}</option>{/each}</select>
    {:else}
      {#if schema.multiline}<textarea id="field-{name}" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)}></textarea>{:else}<input id="field-{name}" class="text-input" type="text" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} />{/if}
    {/if}
  </div>
{/snippet}

<style>
  .inspector{width:292px;min-width:260px;overflow:auto;background:#17181f;border-left:1px solid #ffffff10}.panel-heading{height:42px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff10;color:#9a98a6;font:9px 'DM Mono',monospace;letter-spacing:.13em}.muted{color:#666573}.entity-heading{display:flex;align-items:center;gap:10px;padding:17px 14px 13px}.entity-icon{display:grid;place-items:center;width:30px;height:30px;background:#282538;border-radius:7px;color:#a99cff}.entity-title{display:grid;gap:3px}.entity-title strong{font-size:12px;font-weight:600}.entity-title small{font:9px 'DM Mono',monospace;color:#757381}.name-field{display:grid;gap:6px;padding:0 14px 13px}.name-field span,.field-label{font:9px 'DM Mono',monospace;color:#898795;text-transform:uppercase;letter-spacing:.07em}.name-field input,.text-input,textarea{width:100%;height:29px;background:#111217;border:1px solid #ffffff12;border-radius:4px;color:#c9c8d1;padding:0 8px;font:11px 'DM Sans',sans-serif}.component-card{border-top:1px solid #ffffff0d}.component-title{height:36px;padding:0 10px;display:flex;align-items:center;gap:6px;color:#d4d2dd;font-size:11px;font-weight:600}.collapse,.remove-component{border:0;background:none;color:#777583;cursor:pointer}.collapse{width:18px;font-size:16px}.remove-component{margin-left:auto;font-size:17px}.remove-component:hover{color:#ff7a87}.fields{padding:2px 11px 10px}.field-row{display:grid;gap:7px;padding:7px 0}.range-input{display:grid;grid-template-columns:1fr 64px;align-items:center;gap:8px}.range-input input[type=range]{width:100%;accent-color:#9788ff;height:14px}.numeric{width:64px;height:25px;background:#111217;border:1px solid #ffffff13;border-radius:4px;color:#d2d0dc;text-align:right;padding:0 5px;font:10px 'DM Mono',monospace}.numeric.full{width:100%}.toggle{width:30px;height:17px;border:0;border-radius:10px;background:#35343d;padding:2px;cursor:pointer}.toggle i{display:block;width:13px;height:13px;background:#96939f;border-radius:50%;transition:transform .15s}.toggle.checked{background:#7765dc}.toggle.checked i{transform:translateX(13px);background:#fff}.color-input{display:flex;align-items:center;gap:8px}.color-input input{width:28px;height:23px;background:none;border:0;padding:0;cursor:pointer}.color-input code{font:10px 'DM Mono',monospace;color:#c2bfcd}.vector-input{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.vector-input label{display:flex;align-items:center;border:1px solid #ffffff12;border-radius:4px;background:#111217;overflow:hidden}.vector-input span{padding-left:5px;font:9px 'DM Mono',monospace;color:#85828e}.vector-input .axis-0 span{color:#e88689}.vector-input .axis-1 span{color:#87c99f}.vector-input .axis-2 span{color:#829bdf}.vector-input input{width:100%;min-width:0;height:25px;background:transparent;border:0;outline:none;color:#dedce7;text-align:right;padding:0 4px;font:10px 'DM Mono',monospace}.field-select{height:27px;width:100%;background:#111217;border:1px solid #ffffff13;border-radius:4px;color:#cfccd9;padding:0 6px;font:10px 'DM Sans',sans-serif}.text-input{height:26px}textarea{height:80px;padding:7px;resize:vertical;font:10px/1.5 'DM Mono',monospace}.managed-hint{color:#777583;font-size:9px;padding:7px 1px}.add-component-row{display:grid;grid-template-columns:1fr 29px;gap:5px;padding:12px;border-top:1px solid #ffffff0d}.add-component-row select{height:29px;background:#111217;border:1px solid #ffffff13;border-radius:4px;color:#aaa8b4;padding:0 7px;font:10px 'DM Sans',sans-serif}.add-component-row button{border:0;border-radius:4px;background:#2e2a40;color:#b0a3ff;font-size:17px;cursor:pointer}.add-component-row button:disabled{opacity:.4;cursor:default}.empty-inspector{display:grid;justify-items:center;padding:55px 27px;color:#777583;text-align:center}.empty-inspector span{font-size:25px;color:#5f5c6a}.empty-inspector p{font-size:11px;line-height:1.55}
  .script-params{display:grid;gap:7px;margin:8px 0;padding:9px;background:#111217;border:1px solid #ffffff10;border-radius:5px}.script-params>strong{font:9px 'DM Mono',monospace;color:#8e87bd;letter-spacing:.08em}.script-params label{display:flex;align-items:center;justify-content:space-between;color:#b8b6c2;font-size:10px}.script-params input{width:100px;background:#191a21;color:#e0deea;border:1px solid #ffffff18;border-radius:3px;padding:4px}.script-errors{display:grid;gap:4px;color:#ff8992;font:10px/1.4 'DM Mono',monospace;padding:7px 2px}
  .children-note{margin:-4px 14px 12px;color:#8e8b9c;font-size:10px}
  .script-owner{margin:4px 1px 8px;color:#a9a7b5;font-size:10.5px;line-height:1.5}.script-owner b{color:#e6e3f1;font-weight:600}.script-owner code,.add-script-card code{color:#7fd1ff;font:10px 'DM Mono',monospace}
  .event-chips{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.event-chips span{padding:3px 7px;border-radius:10px;background:#2a2540;color:#c9bfff;font:9.5px 'DM Mono',monospace}
  .add-script-card{margin:4px 12px 0;padding:11px;border:1px dashed #7fd1ff40;border-radius:7px;background:#16202a}.add-script-card strong{font-size:11px;color:#d9eefa}.add-script-card p{margin:5px 0 4px;color:#9fb4c2;font-size:10.5px;line-height:1.5}
  .field-label{text-transform:none!important;letter-spacing:.02em!important;font-size:10px!important}
  .open-script{width:100%;height:30px;margin:6px 0 4px;border:1px solid #7fd1ff40;border-radius:5px;background:#1f2f3a;color:#a9def7;font-size:10.5px;cursor:pointer}.open-script:hover{background:#26394a}
  .inspector-animatable-field{position:relative}.inspector-animatable-field .field-row{padding-right:22px}.keyframe-button{position:absolute;right:0;top:5px;width:20px;height:23px;border:0;background:none;color:#777583;font-size:17px;cursor:pointer}.keyframe-button:hover{color:#b2a5ff}
</style>
