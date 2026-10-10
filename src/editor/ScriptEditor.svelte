<script lang="ts">
  import { highlightLine } from "../lang/highlight";
  import { parseScript } from "../lang/parser";
  import { typecheckScript, type ScriptDiagnostic } from "../lang/checker";

  interface Props {
    title: string;
    /** Name of the object this script belongs to ("me" in the script). */
    owner?: string;
    ownerHasChildren?: boolean;
    source: string;
    dirty: boolean;
    readOnly: boolean;
    entityNames: Set<string>;
    onChange: (source: string) => void;
    onCommit: () => void;
  }

  let { title, owner = "", ownerHasChildren = false, source, dirty, readOnly, entityNames, onChange, onCommit }: Props = $props();
  let textarea: HTMLTextAreaElement;
  let highlight: HTMLPreElement;
  let gutter: HTMLDivElement;
  let referenceOpen = $state(true);

  const examples: { group: string; items: { code: string; hint: string }[] }[] = [
    { group: "1 · When", items: [
      { code: "when game starts\n  say \"hello\"", hint: "once, when Play starts" },
      { code: "when clicked\n  spin fast", hint: "when this object (or one inside it) is clicked" },
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

  function syncScroll() {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
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
          readonly={readOnly}
          placeholder={"-- Write sentences, then press Play.\nwhen game starts\n  bounce\n\nwhen clicked\n  paint red"}
          oninput={(event) => onChange(event.currentTarget.value)}
          onkeydown={keydown}
          onscroll={syncScroll}
          onblur={() => { if (dirty) onCommit(); }}
        ></textarea>
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
  .problems{max-height:96px;overflow:auto;margin:0;padding:6px 10px;list-style:none;border-top:1px solid #ff5a6a33;background:#1d1519}
  .problems button{border:0;background:none;color:#ffb3ba;text-align:left;font:10.5px/18px 'DM Mono',monospace;cursor:pointer;padding:0}
  .problems b{color:#ff8992;font-weight:500;margin-right:6px}
</style>
