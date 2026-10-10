<script lang="ts">
  import { highlightLine } from "../lang/highlight";
  import { parseScript } from "../lang/parser";
  import { typecheckScript, type ScriptDiagnostic } from "../lang/checker";
  import { findUnclearWords } from "../lang/fuzzy";
  import { SHAPE_NOUNS } from "../lang/vocabulary";
  import { runScriptRewrite, type RewriteStage } from "../ai/scriptRewrite";
  import type { ParseEntity } from "../ai/scriptParse";

  interface Props {
    title: string;
    /** Name of the object this script belongs to ("me" in the script). */
    owner?: string;
    ownerHasChildren?: boolean;
    source: string;
    dirty: boolean;
    readOnly: boolean;
    entityNames: Set<string>;
    /** Scene objects the AI Parse can point at. */
    entities?: ParseEntity[];
    ownerId?: string;
    onChange: (source: string) => void;
    onCommit: () => void;
  }

  let { title, owner = "", ownerHasChildren = false, source, dirty, readOnly, entityNames, entities = [], ownerId, onChange, onCommit }: Props = $props();
  let textarea: HTMLTextAreaElement;
  let highlight: HTMLPreElement;
  let gutter: HTMLDivElement;
  let measure: HTMLSpanElement;
  let referenceOpen = $state(true);

  // --- Parse: fix typos locally, then AI on broken lines, then the whole script; review before applying ---
  const lineHeight = 20;
  const padTop = 12;
  const padLeft = 14;
  let charWidth = $state(7.2);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let parsing = $state(false);
  let parseMessage = $state("");
  let rewriteDraft = $state<{ original: string; source: string; meaning: string; stage: RewriteStage; aiCalls: number } | null>(null);
  const stageLabels: Record<RewriteStage, string> = {
    none: "",
    local: "Fixed locally — no AI call",
    lines: "AI fixed only the broken lines",
    full: "AI rewrote the full script"
  };
  // Draft lines that are not in the original, so the review shows exactly what changed.
  let changedDraftLines = $derived.by(() => {
    if (!rewriteDraft) return new Set<number>();
    const before = new Set(rewriteDraft.original.split("\n").map((line) => line.trimEnd()));
    return new Set(rewriteDraft.source.split("\n").flatMap((line, index) => (before.has(line.trimEnd()) ? [] : [index])));
  });

  $effect(() => {
    const read = () => { if (measure) charWidth = measure.getBoundingClientRect().width / 20 || charWidth; };
    read();
    void document.fonts?.ready.then(read);
  });

  let entityById = $derived(new Map(entities.map((entity) => [entity.id, entity])));
  function boxStyle(line: number, column: number, length: number): string {
    return `top:${padTop + (line - 1) * lineHeight}px;left:${padLeft + (column - 1) * charWidth - 2}px;width:${length * charWidth + 4}px;height:${lineHeight}px`;
  }

  async function parse() {
    if (parsing || readOnly || !source.trim()) return;
    parsing = true;
    parseMessage = "";
    rewriteDraft = null;
    try {
      const original = source;
      const result = await runScriptRewrite({ source: original, owner: ownerId ? entityById.get(ownerId) ?? null : null, entities });
      if (result.source.trim() === original.trim()) parseMessage = result.stage === "none" ? "Nothing to fix: the script is already valid." : "Parse found no changes to make.";
      else rewriteDraft = { original, ...result };
    } catch (error) {
      parseMessage = `AI rewrite failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      parsing = false;
    }
  }

  function applyRewrite() {
    if (!rewriteDraft || readOnly) return;
    if (source !== rewriteDraft.original) {
      rewriteDraft = null;
      parseMessage = "The script changed while the rewrite was open. Run Parse again to review a current rewrite.";
      return;
    }
    onChange(rewriteDraft.source);
    rewriteDraft = null;
  }

  function dismissRewrite() {
    rewriteDraft = null;
  }

  // --- Hover card: which scene object a word in the script refers to ---
  interface HoverCard { left: number; top: number; title: string; items: ParseEntity[] }
  let hoverCard = $state<HoverCard | null>(null);
  let owningEntity = $derived(ownerId ? entityById.get(ownerId) ?? null : null);
  const selfWords = new Set(["me", "my", "myself", "i", "self"]);

  function childCount(entity: ParseEntity): number {
    return entities.filter((other) => other.parent === entity.name).length;
  }

  function distanceFromOwner(entity: ParseEntity): string {
    const from = owningEntity?.position;
    const to = entity.position;
    if (!from || !to || entity.id === owningEntity?.id) return "";
    return `${Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]).toFixed(1)} m from me`;
  }

  /** Scene objects a word refers to: names, quoted names, me/my, my children/parent, and shape nouns. */
  function resolveWord(text: string, previous: string): { title: string; items: ParseEntity[] } | null {
    const lower = text.toLowerCase();
    if (/^["']/.test(text)) {
      const name = text.replace(/^["']|["']$/g, "").toLowerCase();
      const items = entities.filter((entity) => entity.name.toLowerCase() === name);
      return items.length ? { title: "Scene object", items } : null;
    }
    if (selfWords.has(lower)) return owningEntity ? { title: `"${text}" = this script's object`, items: [owningEntity] } : { title: `"${text}" = the scene script (no object)`, items: [] };
    if (previous === "my" && owningEntity && lower === "children") return { title: "my children", items: entities.filter((entity) => entity.parent === owningEntity.name) };
    if (previous === "my" && owningEntity && lower === "parent") return { title: "my parent", items: entities.filter((entity) => entity.name === owningEntity.parent) };
    const byName = entities.filter((entity) => entity.id.toLowerCase() === lower || entity.name.toLowerCase().split(/\s+/).includes(lower));
    if (byName.length) return { title: byName.length === 1 ? "Scene object" : `${byName.length} objects match "${text}"`, items: byName };
    const noun = SHAPE_NOUNS[lower] ? lower : lower.replace(/e?s$/, "");
    const shape = SHAPE_NOUNS[noun];
    if (shape) {
      const kind = shape === "Light" ? "light" : shape;
      return { title: `Any ${noun} (${kind}) in the scene`, items: entities.filter((entity) => entity.shape === kind) };
    }
    return null;
  }

  function hover(event: MouseEvent) {
    const rect = textarea.getBoundingClientRect();
    const x = event.clientX - rect.left + textarea.scrollLeft - padLeft;
    const y = event.clientY - rect.top + textarea.scrollTop - padTop;
    const index = Math.floor(y / lineHeight);
    const column = Math.floor(x / charWidth);
    const line = lines[index];
    if (x < 0 || y < 0 || line === undefined || column >= line.length) { hoverCard = null; return; }
    let start = 0;
    let previous = "";
    for (const span of highlightLine(line, entityNames)) {
      const end = start + span.text.length;
      if (column < end) {
        const found = span.text.trim() && span.cls !== "comment" ? resolveWord(span.text, previous) : null;
        hoverCard = found ? {
          ...found,
          left: Math.max(4, padLeft + start * charWidth - textarea.scrollLeft),
          top: padTop + (index + 1) * lineHeight - textarea.scrollTop + 2
        } : null;
        return;
      }
      if (span.text.trim()) previous = span.text.toLowerCase();
      start = end;
    }
    hoverCard = null;
  }

  const examples: { group: string; items: { code: string; hint: string }[] }[] = [
    { group: "1 · When", items: [
      { code: "when game starts\n  say \"hello\"", hint: "once, when Play starts" },
      { code: "when clicked\n  spin fast", hint: "when this object (or one inside it) is clicked" },
      { code: "when a box is added\n  create a ball", hint: "when a Play-time script creates a box" },
      { code: "when space is pressed\n  move up 2 over 0.3 seconds", hint: "or: when I press left · when the a key is pressed" },
      { code: "when I touch the floor\n  paint it red", hint: "it = the object touched; leave the object out for anything" },
      { code: "every 2 seconds\n  turn left", hint: "repeats on a timer" },
      { code: "forever\n  if key right is pressed\n    move right 0.1", hint: "every frame: smooth controls" },
      { code: "when I receive \"win\"\n  say \"You win!\"", hint: "runs when any script does: broadcast \"win\"" }
    ] },
    { group: "2 · Do", items: [
      { code: "move up 2", hint: "up · down · left · right · forward · back" },
      { code: "move to 0 2 0", hint: "x y z · or: move by 1 0 0" },
      { code: "move above the box over 1 second", hint: "above · below · beside · left of · in front of · behind" },
      { code: "turn left 45", hint: "or: turn around · turn right" },
      { code: "grow by 2", hint: "shrink by 2 · scale to 0.5" },
      { code: "paint red", hint: "a color word or #rrggbb" },
      { code: "spin slowly", hint: "bounce · float · pulse · shake · wobble · sway · orbit · flash · tumble" },
      { code: "hide", hint: "and: show · destroy · stop" },
      { code: "create a red ball at 0 3 0", hint: "or: create a box above me called \"Crate\"" },
      { code: "say \"Score:\" score", hint: "prints to the Console" },
      { code: "push up 5", hint: "needs Physics (a dynamic RigidBody)" }
    ] },
    { group: "3 · Who", items: [
      { code: "paint the nearest red ball blue", hint: "the [nearest/biggest/highest…] [color] ball/box/cone/light/group/name" },
      { code: "paint my children green", hint: "objects inside this one · also: my parent" },
      { code: "move all cubes up 1", hint: "all … acts on every match" },
      { code: "destroy it", hint: "it = the object touched or clicked" }
    ] },
    { group: "4 · Remember & decide", items: [
      { code: "set score to 0", hint: "a variable every event can use" },
      { code: "change score by 1", hint: "or: increase speed by 2 · decrease lives" },
      { code: "if score is at least 3\n  broadcast \"win\"\notherwise\n  say score", hint: "is · is not · is more than · is less than · is at most" },
      { code: "wait 1 second", hint: "pause before the next line" },
      { code: "repeat 3 times\n  move up 1\n  wait 0.2 seconds", hint: "or: repeat until my y is more than 5" },
      { code: "if distance to the player is less than 2\n  paint red", hint: "my x · my y · my size · x of the ball · random 1 to 10" },
      { code: "setting speed = 3 from 0 to 10", hint: "becomes a slider in the Inspector" },
      { code: "-- a note to yourself", hint: "ignored when the script runs" }
    ] }
  ];

  const templates: { name: string; code: string }[] = [
    { name: "Spin when clicked", code: "when clicked\n  spin fast\n  wait 2 seconds\n  stop\n" },
    { name: "Move with arrow keys", code: "setting speed = 0.1 from 0 to 1\n\nforever\n  if key left is pressed\n    move left speed\n  if key right is pressed\n    move right speed\n  if key up is pressed\n    move forward speed\n  if key down is pressed\n    move back speed\n\nwhen space is pressed\n  move up 1.5 over 0.25 seconds\n  move down 1.5 over 0.25 seconds\n" },
    { name: "Collect coins", code: "-- Put this on the player. Name coin objects \"Coin\".\nwhen game starts\n  set score to 0\n\nwhen I touch a coin\n  destroy it\n  change score by 1\n  say \"Score:\" score\n  if score is 3\n    broadcast \"win\"\n\nwhen I receive \"win\"\n  say \"You win!\"\n  bounce\n" },
    { name: "Rain of balls", code: "every 1 seconds\n  create a blue ball at (random -3 to 3) 6 (random -3 to 3)\n" },
    { name: "Patrol back and forth", code: "when game starts\n  forever\n    move right 3 over 1.5 seconds\n    wait 1.5 seconds\n    move left 3 over 1.5 seconds\n    wait 1.5 seconds\n" },
    { name: "Group: light up children", code: "-- Put this on a group.\nwhen clicked\n  paint my children yellow\n  wait 1 second\n  paint my children white\n" }
  ];
  let templateChoice = $state("");

  function useTemplate(name: string) {
    const template = templates.find((candidate) => candidate.name === name);
    templateChoice = "";
    if (!template || readOnly) return;
    const body = source.split("\n").filter((line) => !line.trim().startsWith("--")).join("").trim();
    // An empty (or comment-only) script is replaced; otherwise the template is added at the end.
    const next = body ? `${source.trimEnd()}\n\n${template.code}` : template.code;
    onChange(next);
    queueMicrotask(() => { textarea.value = next; textarea.focus(); });
  }

  let lines = $derived(source.split("\n"));
  let diagnostics = $derived.by((): ScriptDiagnostic[] => {
    try {
      return typecheckScript(parseScript(source));
    } catch (error) {
      const issue = error as { line?: number; column?: number; message?: string };
      return [{ line: issue.line ?? 1, column: issue.column ?? 1, message: (issue.message ?? String(error)).replace(/ \(line \d+, column \d+\)$/, "") }];
    }
  });
  let errorLines = $derived(new Set(diagnostics.map((issue) => issue.line)));
  let unclear = $derived(findUnclearWords(source, entityNames, errorLines));
  let pendingWords = $derived(unclear);

  function syncScroll() {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
    scrollTop = textarea.scrollTop;
    scrollLeft = textarea.scrollLeft;
  }

  function replaceSelection(text: string, selectStart: number, selectEnd = selectStart) {
    const next = source.slice(0, textarea.selectionStart) + text + source.slice(textarea.selectionEnd);
    onChange(next);
    queueMicrotask(() => { textarea.value = next; textarea.setSelectionRange(selectStart, selectEnd); });
  }

  function lineStart(index: number): number { return source.lastIndexOf("\n", index - 1) + 1; }

  function keydown(event: KeyboardEvent) {
    if (readOnly) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const first = lineStart(start);
      if (event.shiftKey) {
        const block = source.slice(first, end);
        const dedented = block.replace(/^ {1,2}/gm, "");
        const next = source.slice(0, first) + dedented + source.slice(end);
        onChange(next);
        queueMicrotask(() => { textarea.value = next; textarea.setSelectionRange(Math.max(first, start - 2), end - (block.length - dedented.length)); });
      } else if (start !== end && source.slice(start, end).includes("\n")) {
        const block = source.slice(first, end);
        const indented = block.replace(/^/gm, "  ");
        const next = source.slice(0, first) + indented + source.slice(end);
        onChange(next);
        queueMicrotask(() => { textarea.value = next; textarea.setSelectionRange(start + 2, end + (indented.length - block.length)); });
      } else replaceSelection("  ", start + 2);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const current = source.slice(lineStart(start), start);
      const indent = current.match(/^\s*/)?.[0] ?? "";
      const extra = current.trimEnd().endsWith(":") ? "  " : "";
      replaceSelection(`\n${indent}${extra}`, start + 1 + indent.length + extra.length);
    } else if ((event.ctrlKey || event.metaKey) && event.key === "/") {
      event.preventDefault();
      const first = lineStart(start);
      const block = source.slice(first, end);
      const commented = block.split("\n").every((line) => !line.trim() || line.trimStart().startsWith("--"));
      const toggled = block.split("\n").map((line) => !line.trim() ? line : commented ? line.replace(/^(\s*)-- ?/, "$1") : line.replace(/^(\s*)/, "$1-- ")).join("\n");
      const next = source.slice(0, first) + toggled + source.slice(end);
      onChange(next);
      queueMicrotask(() => { textarea.value = next; textarea.setSelectionRange(first, first + toggled.length); });
    }
  }

  /** Insert an example on a new line below the cursor, matching the current indentation. */
  function insertExample(code: string) {
    if (readOnly) return;
    const cursor = textarea?.selectionEnd ?? source.length;
    const lineEnd = source.indexOf("\n", cursor) === -1 ? source.length : source.indexOf("\n", cursor);
    const currentLine = source.slice(lineStart(cursor), lineEnd);
    const indent = currentLine.trimEnd().endsWith(":") ? `${currentLine.match(/^\s*/)?.[0] ?? ""}  ` : currentLine.match(/^\s*/)?.[0] ?? "";
    const snippet = code.split("\n").map((line) => indent + line).join("\n");
    const prefix = source.length === 0 ? "" : source.slice(0, lineEnd) + "\n";
    const next = (currentLine.trim() === "" && source.length ? source.slice(0, lineStart(cursor)) : prefix) + snippet + source.slice(lineEnd);
    onChange(next);
    const caret = next.length - source.slice(lineEnd).length;
    queueMicrotask(() => { textarea.value = next; textarea.focus(); textarea.setSelectionRange(caret, caret); });
  }

  function jumpTo(line: number) {
    let index = 0;
    for (let current = 1; current < line; current += 1) index = source.indexOf("\n", index) + 1;
    textarea.focus();
    textarea.setSelectionRange(index, index);
  }
</script>

<section class="script-editor" aria-label="Script editor for {title}">
  <header class="script-toolbar">
    <span class="script-title"><b>{title}</b><small>{readOnly ? "read-only while playing" : dirty ? "● unsaved — Ctrl+S to apply" : "saved"}</small></span>
    <span class="status" class:bad={diagnostics.length > 0}>{diagnostics.length ? `${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"}` : "✓ no problems"}</span>
    <button class="parse" disabled={readOnly || parsing || !source.trim()} onclick={parse} title="Fix the script: typos locally first, then AI on just the broken lines, then the whole script only if needed">
      {parsing ? "Parsing…" : "✦ Parse"}
    </button>
    <button class="apply" disabled={readOnly || !dirty} onclick={onCommit}>Apply</button>
    <select class="templates" aria-label="Start from a template" bind:value={templateChoice} onchange={() => useTemplate(templateChoice)} disabled={readOnly}>
      <option value="">Start from…</option>
      {#each templates as template}<option value={template.name}>{template.name}</option>{/each}
    </select>
    <button class="ghost" aria-pressed={referenceOpen} onclick={() => referenceOpen = !referenceOpen}>Help</button>
  </header>
  {#if owner}
    <div class="owner-bar">This script belongs to <b>{owner}</b>. In it, <code>me</code> means {owner}{#if ownerHasChildren}, and <code>my children</code> means the objects inside it{/if}.</div>
  {/if}
  <div class="script-body">
    <div class="code-area">
      <div class="gutter" bind:this={gutter} aria-hidden="true">
        {#each lines as _, index}<div class:error={errorLines.has(index + 1)}>{index + 1}</div>{/each}
      </div>
      <div class="code-layers">
        <pre class="highlight" bind:this={highlight} aria-hidden="true">{#each lines as line, index}<div class="code-line" class:error={errorLines.has(index + 1)}>{#each highlightLine(line, entityNames) as span}<span class="tok-{span.cls}" style={span.swatch ? `text-decoration:underline 2px ${span.swatch};text-underline-offset:3px` : undefined}>{span.text}</span>{/each}{line === "" ? " " : ""}</div>{/each}</pre>
        <textarea
          bind:this={textarea}
          value={source}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          readonly={readOnly || parsing}
          placeholder={"-- Write sentences, then press Play.\nwhen game starts\n  bounce\n\nwhen clicked\n  paint red"}
          oninput={(event) => onChange(event.currentTarget.value)}
          onkeydown={keydown}
          onscroll={() => { syncScroll(); hoverCard = null; }}
          onmousemove={hover}
          onmouseleave={() => hoverCard = null}
          onblur={() => { if (dirty) onCommit(); }}
        ></textarea>
        {#if hoverCard}
          <div class="hover-card" role="tooltip" style="left:{hoverCard.left}px;top:{hoverCard.top}px">
            <small>{hoverCard.title}</small>
            {#each hoverCard.items.slice(0, 4) as item (item.id)}
              <div class="hover-item">
                <b>{#if item.color}<i class="swatch" style="background:{item.color}"></i>{/if}{item.name}</b>
                <span class="kind">{item.shape ?? (childCount(item) ? "group" : "empty")}</span>
                <span class="detail">
                  {#if item.position}at {item.position.map((value) => Math.round(value * 10) / 10).join(", ")}{/if}{#if item.color} · {item.color}{/if}{#if item.parent} · inside {item.parent}{/if}{#if childCount(item)} · holds {childCount(item)} object{childCount(item) === 1 ? "" : "s"}{/if}{#if distanceFromOwner(item)} · {distanceFromOwner(item)}{/if}
                </span>
              </div>
            {:else}
              <span class="detail">No matching object in the scene yet.</span>
            {/each}
            {#if hoverCard.items.length > 4}<span class="detail">and {hoverCard.items.length - 4} more</span>{/if}
          </div>
        {/if}
        <span class="measure" bind:this={measure} aria-hidden="true">MMMMMMMMMMMMMMMMMMMM</span>
        <div class="fuzzy-clip"><div class="fuzzy-layer" style="transform:translate({-scrollLeft}px,{-scrollTop}px)">
          {#each pendingWords as word (`${word.line}:${word.column}`)}
            <span class="fuzzy-box" style={boxStyle(word.line, word.column, word.text.length)} title="Not script syntax yet — press Parse"></span>
          {/each}
        </div></div>
      </div>
    </div>
    {#if referenceOpen}
      <aside class="reference" aria-label="Script reference">
        <div class="learn">
          <strong>Scripts in one minute</strong>
          <ol>
            <li>Start with a <b>when</b> line: <code>when clicked</code></li>
            <li>Indent the things to do under it, one per line: <code>spin fast</code></li>
            <li>Each line is a sentence: <i>verb</i> · <i>who</i> (optional, means <code>me</code>) · <i>how</i>: <code>move the box up 2 over 1 second</code></li>
          </ol>
          <p>Press <b>Play</b> to run it. Click any example below to insert it.</p>
        </div>
        {#each examples as section}
          <h3>{section.group}</h3>
          {#each section.items as item}
            <button class="example" onclick={() => insertExample(item.code)} title="Insert">
              <code>{#each item.code.split("\n") as line}<span class="example-line">{#each highlightLine(line, entityNames) as span}<span class="tok-{span.cls}">{span.text}</span>{/each}</span>{/each}</code>
              <small>{item.hint}</small>
            </button>
          {/each}
        {/each}
      </aside>
    {/if}
  </div>
  {#if parseMessage}
    <div class="parse-message" role="status">{parseMessage} <button onclick={() => parseMessage = ""} aria-label="Dismiss">×</button></div>
  {/if}
  {#if rewriteDraft}
    <div class="rewrite-backdrop" role="presentation">
      <div class="rewrite-dialog" role="dialog" aria-modal="true" aria-labelledby="rewrite-title">
        <header><strong id="rewrite-title">Review Parse fixes</strong><button class="ghost" onclick={dismissRewrite} aria-label="Close">×</button></header>
        <p>{rewriteDraft.meaning || "Parse interpreted the script as follows."}</p>
        <p class="stage">{stageLabels[rewriteDraft.stage]}{rewriteDraft.aiCalls ? ` · ${rewriteDraft.aiCalls} AI call${rewriteDraft.aiCalls === 1 ? "" : "s"}` : ""} · changed lines are highlighted</p>
        <label for="rewrite-output">Rewritten script</label>
        <pre id="rewrite-output">{#each rewriteDraft.source.split("\n") as line, index}<span class="draft-line" class:changed={changedDraftLines.has(index)}>{line || " "}</span>{/each}</pre>
        <footer>
          <button class="ghost" onclick={dismissRewrite}>Keep editing</button>
          <button class="apply" disabled={readOnly} onclick={applyRewrite}>Use rewrite</button>
        </footer>
      </div>
    </div>
  {/if}
  {#if diagnostics.length}
    <ul class="problems" role="alert">
      {#each diagnostics as issue}<li><button onclick={() => jumpTo(issue.line)}><b>Line {issue.line}</b> {issue.message}</button></li>{/each}
    </ul>
  {/if}
</section>

<style>
  .script-editor{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;background:#15161c;color:#d9d7e2}
  .script-toolbar{height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid #ffffff10;background:#1a1b22}
  .script-title{display:flex;align-items:baseline;gap:9px;flex:1;min-width:0;font-size:11px}.script-title b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.script-title small{color:#858391;font:9px 'DM Mono',monospace}
  .status{font:9px 'DM Mono',monospace;color:#83cfa0}.status.bad{color:#ff8992}
  .script-toolbar button{height:26px;padding:0 11px;border-radius:5px;font-size:10px;cursor:pointer}
  .apply{border:1px solid #a99aff55;background:#302a47;color:#d0c7ff}.apply:disabled{opacity:.4;cursor:default}
  .ghost{border:1px solid #ffffff14;background:transparent;color:#aaa8b4}.ghost[aria-pressed="true"]{color:#d0c7ff;border-color:#a99aff44}
  .script-body{flex:1;min-height:0;display:flex}
  .code-area{flex:1;min-width:0;display:flex;position:relative}
  .gutter{width:44px;flex:0 0 44px;overflow:hidden;padding:12px 8px 12px 0;text-align:right;color:#55535f;font:12px/20px 'DM Mono',ui-monospace,monospace;background:#131419;border-right:1px solid #ffffff08;user-select:none}
  .gutter .error{color:#ff8992}
  .code-layers{position:relative;flex:1;min-width:0}
  .highlight,textarea{position:absolute;inset:0;margin:0;padding:12px 14px;border:0;font:12px/20px 'DM Mono',ui-monospace,monospace;tab-size:2;white-space:pre;overflow:auto;letter-spacing:0}
  .highlight{pointer-events:none;color:#d9d7e2;overflow:hidden}
  textarea{resize:none;outline:none;background:transparent;color:transparent;caret-color:#e8e4ff;-webkit-text-fill-color:transparent}
  textarea::placeholder{color:#55535f;-webkit-text-fill-color:#55535f}
  textarea::selection{background:#8d7cff44}
  .code-line.error{background:linear-gradient(90deg,#ff5a6a1c,#ff5a6a05);box-shadow:inset 2px 0 #ff5a6a}
  .tok-comment{color:#6b6978;font-style:italic}.tok-string{color:#e6c07b}.tok-number{color:#f2a46b}.tok-color{color:#f0a0c8}
  .tok-keyword{color:#c792ea;font-weight:500}.tok-command{color:#7fd1ff;font-weight:600}.tok-phrase{color:#8fd1b0}
  .tok-builtin{color:#82aaff}.tok-entity{color:#ffd479;text-decoration:underline dotted #ffd47966}.tok-property{color:#b4c6e7}.tok-operator{color:#9a98a6}
  .reference{width:280px;flex:0 0 280px;overflow:auto;padding:10px 12px 16px;border-left:1px solid #ffffff0d;background:#17181f}
  .owner-bar{padding:6px 14px;border-bottom:1px solid #ffffff0d;background:#1b2530;color:#a9c4d6;font-size:10.5px}.owner-bar b{color:#e6f4fc;font-weight:600}.owner-bar code{color:#7fd1ff;font:10px 'DM Mono',monospace}
  .templates{height:26px;max-width:150px;padding:0 6px;border:1px solid #ffffff14;border-radius:5px;background:#111217;color:#cfcbe0;font-size:10px}
  .learn{margin:2px 0 6px;padding:10px;border:1px solid #a99aff33;border-radius:7px;background:#1d1a2b}.learn strong{color:#d6ccff;font-size:11px}.learn ol{margin:6px 0 4px;padding-left:18px;color:#c3bfd2;font-size:10.5px;line-height:1.55}.learn p{margin:4px 0 0;color:#8e8b9c;font-size:10px}.learn code{color:#7fd1ff;font:10px 'DM Mono',monospace}.learn b{color:#e6e3f1}
  .reference-intro{margin:2px 0 6px;color:#858391;font-size:10px}
  .reference h3{margin:14px 0 6px;color:#9a8fe0;font:9px 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase}
  .example{display:grid;gap:3px;width:100%;margin:0 0 5px;padding:7px 8px;border:1px solid #ffffff0c;border-radius:6px;background:#111217;text-align:left;cursor:pointer}
  .example:hover{border-color:#a99aff55;background:#1b1a27}
  .example code{display:grid;font:10.5px/16px 'DM Mono',ui-monospace,monospace;white-space:pre}
  .example small{color:#77757f;font-size:9.5px;line-height:1.35}
  .parse{border:1px solid #ffd47955;background:#3a3020;color:#ffe2a3}.parse:disabled{opacity:.4;cursor:default}
  .measure{position:absolute;visibility:hidden;white-space:pre;font:12px/20px 'DM Mono',ui-monospace,monospace;pointer-events:none}
  .fuzzy-clip{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2}
  .fuzzy-layer{position:absolute;inset:0;pointer-events:none}
  .fuzzy-box{position:absolute;box-sizing:border-box;border:1.5px dashed #ffd479aa;border-radius:4px;background:#ffd47910;padding:0}
  .hover-card{position:absolute;z-index:5;display:grid;gap:6px;min-width:170px;max-width:290px;padding:8px 10px;border:1px solid #ffd47944;border-radius:6px;background:#1f1d24f2;box-shadow:0 8px 24px #0008;pointer-events:none;font-size:10.5px}
  .hover-card small{color:#bfa865;font:9px 'DM Mono',monospace;letter-spacing:.04em}
  .hover-item{display:grid;grid-template-columns:1fr auto;gap:2px 8px}.hover-item b{display:flex;align-items:center;gap:5px;color:#ffe2a3;font-weight:600}
  .hover-item .kind{color:#7fd1ff;font:9px 'DM Mono',monospace;text-transform:uppercase}.hover-card .detail{grid-column:1/-1;color:#a7a4b3;font-size:10px}
  .swatch{width:9px;height:9px;border-radius:2px;border:1px solid #ffffff33}
  .rewrite-dialog .stage{color:#ffd479;font:10px 'DM Mono',monospace}
  .draft-line{display:block}.draft-line.changed{background:#30a46c26;box-shadow:inset 2px 0 #30a46c}
  .parse-message{display:flex;justify-content:space-between;gap:8px;padding:5px 12px;border-top:1px solid #ffd47933;background:#221d14;color:#ffe2a3;font-size:10.5px}.parse-message button{border:0;background:none;color:inherit;cursor:pointer}
  .rewrite-backdrop{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:#090a0dcc}
  .rewrite-dialog{display:flex;flex-direction:column;gap:10px;width:min(680px,100%);max-height:min(80%,720px);padding:14px;border:1px solid #a99aff55;border-radius:8px;background:#1a1b22;box-shadow:0 16px 50px #0009}
  .rewrite-dialog header,.rewrite-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .rewrite-dialog header strong{color:#e7e1ff;font-size:12px}.rewrite-dialog p{margin:0;color:#bcb9c8;font-size:11px;line-height:1.5}
  .rewrite-dialog label{color:#918e9e;font-size:10px}.rewrite-dialog pre{flex:1;min-height:100px;max-height:50vh;overflow:auto;margin:0;padding:12px;border:1px solid #ffffff12;border-radius:5px;background:#111217;color:#d9d7e2;font:11px/1.6 'DM Mono',ui-monospace,monospace;white-space:pre}
  .rewrite-dialog footer{justify-content:flex-end}.rewrite-dialog footer button{height:28px;padding:0 11px;border-radius:5px;font-size:10px;cursor:pointer}
  .problems{max-height:96px;overflow:auto;margin:0;padding:6px 10px;list-style:none;border-top:1px solid #ff5a6a33;background:#1d1519}
  .problems button{border:0;background:none;color:#ffb3ba;text-align:left;font:10.5px/18px 'DM Mono',monospace;cursor:pointer;padding:0}
  .problems b{color:#ff8992;font-weight:500;margin-right:6px}
</style>
