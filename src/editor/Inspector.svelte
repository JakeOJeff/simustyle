<script lang="ts">
  import { componentSchemas, type ComponentSchema, type FieldSchema } from "../registry";
  import type { Entity, Scene } from "../scene/types";
  import { parseScript } from "../lang/parser";
  import { typecheckScript } from "../lang/checker";

  interface Props {
    scene: Scene;
    entity: Entity | null;
    onUpdate: (component: string, fields: Record<string, unknown>, phase?: "start" | "preview" | "end") => void;
    onRemove: (component: string) => void;
    onAdd: (component: string) => void;
  }

  let { scene, entity, onUpdate, onRemove, onAdd }: Props = $props();
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
      return { params: program.params, errors: typecheckScript(program) };
    } catch (error) {
      const issue = error as { line?: number; column?: number; message?: string };
      return { params: [], errors: [{ line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message ?? String(error) }] };
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
      <input value={entity.name} readonly />
    </label>
    {#each Object.entries(entity.components) as [component, fields] (component)}
      {@const schema = componentSchemas[component]}
      {#if schema}
        <section class="component-card">
          <div class="component-title">
            <button class="collapse" aria-label="Toggle {component}" onclick={() => openComponents[component] = !(openComponents[component] ?? true)}>{(openComponents[component] ?? true) ? "⌄" : "›"}</button>
            <span>{component}</span>
            <button class="remove-component" title="Remove {component}" onclick={() => onRemove(component)}>×</button>
          </div>
          {#if openComponents[component] ?? true}
            <div class="fields">
              {#each Object.entries(schema.fields) as [fieldName, field] (fieldName)}
                {@render fieldControl(fieldName, field, fields[fieldName] ?? field.default, scene, (value, phase) => update(component, fieldName, value, phase))}
              {/each}
              {#if component === "Script"}
                {@const script = inspectScript(fields.source)}
                {#if script.params.length}
                  <div class="script-params"><strong>PARAMETERS</strong>
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
    <div class="add-component-row">
      <select bind:value={addComponent} aria-label="Component to add">
        <option value="">Add component…</option>
        {#each addableSchemas() as schema (schema.name)}<option value={schema.name}>{schema.name}</option>{/each}
      </select>
      <button disabled={!addComponent} onclick={() => { onAdd(addComponent); addComponent = ""; }}>＋</button>
    </div>
  {:else}
    <div class="empty-inspector"><span>◇</span><p>Select an entity to inspect its components.</p></div>
  {/if}
</aside>

{#snippet fieldControl(name: string, schema: FieldSchema, value: unknown, scene: Scene, onchange: (value: unknown, phase?: "start" | "preview" | "end") => void)}
  <div class="field-row">
    <label class="field-label" for="field-{name}">{name}</label>
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
</style>
