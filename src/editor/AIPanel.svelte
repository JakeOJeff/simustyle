<script lang="ts">
  import { ArrowUp } from "@lucide/svelte";
  import type { SceneOp } from "../scene/types";
  import type { CreditStatus } from "../ai/client";
  import { resetIn } from "./SupportDialog.svelte";
  import type { SceneAgentPreflight } from "../ai/agent";

  export interface AIPanelMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    /** A short result summary shown on one line above the operation details. */
    summary?: string;
    operations?: SceneOp[];
    preflight?: SceneAgentPreflight;
    /** A finished build that wasn't applied (the scene changed while it loaded); the user can still add it. */
    fallbackDraft?: { summary: string; operations: SceneOp[] };
    /** Retry resends `prompt`; Continue sends `continuation`, which asks for only what a partial build left out. */
    retry?: { prompt: string; continuation?: string };
  }

  interface Props {
    messages: readonly AIPanelMessage[];
    loading: boolean;
    aiProgress: string;
    prompt: string;
    onPromptChange: (prompt: string) => void;
    onSubmit: (prompt: string) => void;
    onUndo: (messageId: string) => void;
    onApplyDraft: (messageId: string) => void;
    /** Today's free AI credits on the hosted site; null when AI is not metered. */
    credits?: CreditStatus | null;
    /** Opens the "free forever" note that explains the credit limit. */
    onSupport?: () => void;
  }

  let { messages, loading, aiProgress, prompt, onPromptChange, onSubmit, onUndo, onApplyDraft, credits = null, onSupport }: Props = $props();
  const outOfCredits = $derived(credits !== null && credits.remaining <= 0);

  function submit(event: Event) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || loading || outOfCredits) return;
    onSubmit(value);
  }

  const suggestions = ["Build a cozy reading corner in warm wood and sage green", "Create a colorful low-poly playground, organized into folders", "Make a precise row of five industrial lamps"];

  function operationLabel(operation: SceneOp): string {
    switch (operation.op) {
      case "create": return `Create ${operation.name} (${operation.id})`;
      case "update": return `Update ${operation.id}`;
      case "delete": return `Delete ${operation.id}`;
      case "settings": return "Update scene settings";
    }
  }
</script>

<section class="ai-panel" aria-label="AI scene assistant">
  <div class="conversation" aria-live="polite" aria-relevant="additions text">
    {#if messages.length === 0 && !loading}
      <div class="empty-state">
        <p>Describe what to build, including your style, colors, and details. I'll organize the parts and check the result. You can undo anything.</p>
        <div class="suggestions">
          {#each suggestions as suggestion (suggestion)}<button type="button" disabled={outOfCredits} onclick={() => onSubmit(suggestion)}>{suggestion}</button>{/each}
        </div>
      </div>
    {/if}
    {#each messages as message (message.id)}
      <article class="message" class:user-message={message.role === "user"}>
        <div class="message-role">{message.role === "user" ? "YOU" : "ASSISTANT"}</div>
        {#if message.role === "user"}
          <p class="message-content">{message.content}</p>
        {:else}
          <p class="summary" title={message.summary ?? message.content}>{message.summary ?? message.content}</p>
          {#if message.preflight}
            <details class="preflight-details">
              <summary>Checked before apply · {message.preflight.frames} script ticks{#if message.preflight.critique?.score !== undefined} · visual critique {message.preflight.critique.score}/10{/if}</summary>
              <div class="preflight-output">
                {#if message.preflight.context}
                  {@const context = message.preflight.context}
                  <strong>Scene context</strong>
                  <span>{context.source === "model" ? "References resolved against the scene" : `Expanded the groups the request names${context.note ? ` (${context.note})` : ""}`}; {context.expanded.length ? `listed part by part: ${context.expanded.join(", ")}` : "every group collapsed to its bounding box"}.</span>
                  {#if context.resolvedRequest}<code>Read as: {context.resolvedRequest}</code>{/if}
                  {#each context.facts as fact}<code>{fact}</code>{/each}
                {/if}
                {#if message.preflight.critique}
                  {@const critique = message.preflight.critique}
                  <strong>Visual critique{critique.score !== undefined ? ` · ${critique.score}/10` : ""}</strong>
                  <span>{critique.outcome === "passed" ? "Passed; no fix pass needed." : critique.outcome === "fixed" ? "One fix pass applied for these issues." : critique.outcome === "kept" ? `The fix pass was not applied, so this is the critiqued build. ${critique.note ?? ""}` : `The critique could not run: ${critique.note ?? "unknown error"}`}</span>
                  {#each critique.issues as issue}<code>{issue.entityId ? `[${issue.entityId}] ` : ""}{issue.problem} Fix: {issue.fix}</code>{/each}
                {/if}
                {#if message.preflight.quality}
                  <strong>Design and organization checks</strong>
                  {#each message.preflight.quality.checks as check}<span>{check}</span>{/each}
                  <span>{message.preflight.quality.stats.meshes} meshes · {message.preflight.quality.stats.groups} groups · {message.preflight.quality.stats.dynamicBodies} dynamic bodies</span>
                  {#if message.preflight.quality.warnings.length}
                    <strong>Items to review</strong>
                    {#each message.preflight.quality.warnings as warning}<code>{warning}</code>{/each}
                  {:else}<span>No geometry or organization warnings detected.</span>{/if}
                {/if}
                <strong>Console output</strong>
                {#if message.preflight.console.length}
                  {#each message.preflight.console as line}<code>{line}</code>{/each}
                {:else}<span>No script print output.</span>{/if}
                <strong>Runtime issues in preview</strong>
                {#if message.preflight.issues.length}
                  {#each message.preflight.issues as line}<code>{line}</code>{/each}
                {:else}<span>None detected.</span>{/if}
                {#if message.preflight.baselineIssues.length}
                  <strong>Issues already present before this request</strong>
                  {#each message.preflight.baselineIssues as line}<code>{line}</code>{/each}
                {/if}
                <span>Scripts were previewed in isolation without Rapier physics{message.preflight.critique?.score === undefined ? " or visual review" : ""}.</span>
              </div>
            </details>
          {/if}
          {#if message.operations?.length}
            <details class="operation-details">
              <summary>{message.operations.length} {message.operations.length === 1 ? "operation" : "operations"} <span>View changes</span></summary>
              <div class="operation-list">
                {#each message.operations as operation, index (`${message.id}-${index}`)}
                  <details class="operation">
                    <summary><span class="operation-kind">{operation.op.toUpperCase()}</span>{operationLabel(operation)}</summary>
                    <pre>{JSON.stringify(operation, null, 2)}</pre>
                  </details>
                {/each}
              </div>
              <button class="undo-button" type="button" onclick={() => onUndo(message.id)}>Undo this change</button>
            </details>
          {/if}
          {#if message.fallbackDraft}
            <div class="fallback-draft">
              <span>{message.fallbackDraft.summary}</span>
              <button class="undo-button" type="button" onclick={() => onApplyDraft(message.id)}>Add what was built</button>
              {#if message.fallbackDraft.operations.length}
                <details class="operation-details">
                  <summary>{message.fallbackDraft.operations.length} draft {message.fallbackDraft.operations.length === 1 ? "operation" : "operations"} <span>View draft</span></summary>
                  <div class="operation-list">
                    {#each message.fallbackDraft.operations as operation, index (`${message.id}-draft-${index}`)}
                      <details class="operation">
                        <summary><span class="operation-kind">{operation.op.toUpperCase()}</span>{operationLabel(operation)}</summary>
                        <pre>{JSON.stringify(operation, null, 2)}</pre>
                      </details>
                    {/each}
                  </div>
                </details>
              {/if}
            </div>
          {/if}
          {#if message.retry}
            {@const retry = message.retry}
            <div class="retry-actions">
              {#if retry.continuation}
                <button class="undo-button" type="button" disabled={loading || outOfCredits} onclick={() => onSubmit(retry.continuation!)}>Continue</button>
              {/if}
              <button class="undo-button" type="button" disabled={loading || outOfCredits} onclick={() => onSubmit(retry.prompt)}>Retry</button>
            </div>
          {/if}
        {/if}
      </article>
    {/each}
    {#if loading}
      <div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>{aiProgress}</div>
    {/if}
  </div>

  <form class="prompt-form" data-tutorial-target="ai-prompt" onsubmit={submit}>
    <div class="composer">
      <textarea
        aria-label="Describe a scene change"
        placeholder="What should change?"
        rows="2"
        value={prompt}
        disabled={loading}
        oninput={(event) => onPromptChange(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit(event);
          }
        }}
      ></textarea>
      <div class="prompt-actions">
        {#if credits}
          <span class="credits" class:empty={outOfCredits} title="Free AI credits reset every day at 00:00 UTC">
            {#if outOfCredits}Out of credits{resetIn(credits) ? ` · back in ${resetIn(credits)}` : ""}{:else}{credits.remaining}/{credits.limit} credits left today{/if}
            {#if onSupport}<button type="button" class="why" onclick={onSupport}>Why?</button>{/if}
          </span>
        {:else}
          <span>{loading ? "Working…" : "Enter to send · Shift+Enter for new line"}</span>
        {/if}
        <button type="submit" class="send" aria-label={loading ? "Working" : "Send"} title="Send (Enter)" disabled={loading || outOfCredits || !prompt.trim()}>
          {#if loading}<span class="spinner" aria-hidden="true"></span>{:else}<ArrowUp size={15} />{/if}
        </button>
      </div>
    </div>
  </form>
</section>

<style>
  .ai-panel{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--window-bg,#1c1c1f);color:#ebebec;font-family:'DM Sans',Inter,Segoe UI,sans-serif}
  .conversation{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
  .empty-state{display:grid;justify-items:start;gap:12px}
  .empty-state p{margin:0;color:#e3e3e6;font-size:12.5px;line-height:1.55}
  .suggestions{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
  .suggestions button{max-width:100%;padding:7px 11px;border:1px solid #ffffff17;border-radius:7px;background:#ffffff05;color:#e6e6e9;font-size:12px;line-height:1.35;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
  .suggestions button:hover:not(:disabled){border-color:#a99bff66;background:#a99bff10;color:#fff}
  .suggestions button:focus-visible{outline:2px solid var(--accent,#a99bff);outline-offset:1px}
  .loading-state{display:flex;align-items:center;gap:7px;padding:4px 0;color:#b0a6e8;font:10.5px 'DM Mono',monospace}
  .spinner{width:11px;height:11px;border:1px solid #655b94;border-top-color:#a99bff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .message{max-width:min(760px,100%);display:grid;grid-template-columns:62px minmax(0,1fr);align-items:baseline;column-gap:8px;row-gap:3px}
  .message-role{color:#8e87bd;font:8px 'DM Mono',monospace;letter-spacing:.08em}.user-message .message-role{color:#767682}
  .message-content,.summary{grid-column:2;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c7c7cc;font-size:11px;line-height:1.5}
  .summary{color:#e3e3e5;font-weight:500}
  .operation-details{grid-column:2;color:#92929c;font-size:9px}
  .preflight-details{grid-column:2;color:#92929c;font-size:9px}
  .preflight-details>summary{cursor:pointer;list-style:none;min-height:19px;color:#aaa3d8}.preflight-details>summary::-webkit-details-marker{display:none}.preflight-details>summary:before{content:'›';display:inline-block;margin-right:6px;color:#8b7cf6;font-size:14px}.preflight-details[open]>summary:before{transform:rotate(90deg)}
  .preflight-output{display:grid;gap:4px;margin:2px 0 5px 5px;padding-left:8px;border-left:1px solid #ffffff14}.preflight-output strong{margin-top:3px;color:#c8c8ce;font-size:8px}.preflight-output code{overflow-wrap:anywhere;color:#bfbfc6;font:8px/1.4 'DM Mono',monospace}.preflight-output span{color:#767682;font-size:8px}
  .operation-details>summary,.operation>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px;min-height:19px}
  .operation-details>summary::-webkit-details-marker,.operation>summary::-webkit-details-marker{display:none}
  .operation-details>summary:before,.operation>summary:before{content:'›';display:inline-block;color:#8b7cf6;font-size:14px;transition:transform .12s}
  .operation-details[open]>summary:before,.operation[open]>summary:before{transform:rotate(90deg)}
  .operation-details>summary span{margin-left:auto;color:#767682}
  .operation-list{display:grid;gap:2px;margin:2px 0 4px 5px;padding-left:8px;border-left:1px solid #ffffff14}
  .operation{color:#aaaab2}.operation-kind{min-width:43px;color:#a99bff;font:8px 'DM Mono',monospace}
  pre{max-height:180px;overflow:auto;margin:2px 0 6px 19px;padding:7px;background:#131315;border:1px solid #ffffff0d;border-radius:6px;color:#c6c6cc;font:9px/1.45 'DM Mono',monospace;white-space:pre-wrap;overflow-wrap:anywhere}
  .undo-button{margin:2px 0 4px 18px;padding:4px 9px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#d4d4d8;font-size:10px;cursor:pointer}
  .undo-button:hover{background:#2d2d33;color:#fff}
  .fallback-draft{grid-column:2;display:grid;gap:5px;color:#d2b98a;font-size:9px;line-height:1.4}
  .retry-actions{grid-column:2;display:flex;gap:6px;margin-top:5px}
  .prompt-form{padding:10px;border-top:1px solid var(--window-line,#ffffff0d)}
  .composer{display:flex;flex-direction:column;border:1px solid var(--field-border,#ffffff14);border-radius:9px;background:var(--field-bg,#161618);transition:border-color .12s}
  .composer:focus-within{border-color:#a99bff80}
  textarea{display:block;width:100%;min-height:46px;max-height:140px;resize:none;padding:10px 12px 4px;border:0;outline:none;background:transparent;color:#e6e6e9;font:12px/1.5 'DM Sans',sans-serif}
  textarea::placeholder{color:#74747f}textarea:disabled{opacity:.55}
  .prompt-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 6px 12px;color:#6e6e79;font-size:10.5px}
  .prompt-actions>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .credits{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}.credits.empty{color:#e5a345}
  .why{padding:0;border:0;background:none;color:#a99bff;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}.why:hover{color:#c4baff}
  .suggestions button:disabled{opacity:.45;cursor:default}
  .prompt-actions .send{display:grid;width:28px;height:28px;flex:none;place-items:center;padding:0;border:0;border-radius:7px;background:var(--accent-fill,#7c6cf0);color:#fff;cursor:pointer;transition:background .12s,opacity .12s}
  .prompt-actions .send:hover:not(:disabled){background:var(--accent-hover,#8b7cf6)}.prompt-actions .send:disabled{background:#ffffff12;color:#8d8d97;cursor:default}
  @media(max-height:600px){.conversation{padding-top:6px;padding-bottom:6px}.prompt-form{padding:6px 8px}.prompt-form textarea{min-height:36px}}
</style>
