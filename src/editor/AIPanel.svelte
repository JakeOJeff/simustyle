<script lang="ts">
  import type { SceneOp } from "../scene/types";

  export interface AIPanelMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    /** A short result summary shown on one line above the operation details. */
    summary?: string;
    operations?: SceneOp[];
  }

  interface Props {
    messages: readonly AIPanelMessage[];
    loading: boolean;
    prompt: string;
    onPromptChange: (prompt: string) => void;
    onSubmit: (prompt: string) => void;
    onUndo: (messageId: string) => void;
  }

  let { messages, loading, prompt, onPromptChange, onSubmit, onUndo }: Props = $props();

  function submit(event: Event) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || loading) return;
    onSubmit(value);
  }

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
  <header class="ai-header">
    <div class="ai-title"><span class="ai-mark" aria-hidden="true">✦</span><span>SCENE ASSISTANT</span></div>
    <span class="ai-caption">Describe a change to your scene</span>
  </header>

  <div class="conversation" aria-live="polite" aria-relevant="additions text">
    {#if messages.length === 0 && !loading}
      <div class="empty-state">Try “Add a tower of colorful blocks”</div>
    {/if}
    {#each messages as message (message.id)}
      <article class="message" class:user-message={message.role === "user"}>
        <div class="message-role">{message.role === "user" ? "YOU" : "ASSISTANT"}</div>
        {#if message.role === "user"}
          <p class="message-content">{message.content}</p>
        {:else}
          <p class="summary" title={message.summary ?? message.content}>{message.summary ?? message.content}</p>
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
        {/if}
      </article>
    {/each}
    {#if loading}
      <div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>Planning scene changes…</div>
    {/if}
  </div>

  <form class="prompt-form" onsubmit={submit}>
    <textarea
      aria-label="Describe a scene change"
      placeholder="What would you like to build or change?"
      rows="2"
      value={prompt}
      disabled={loading}
      oninput={(event) => onPromptChange(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          submit(event);
        }
      }}
    ></textarea>
    <div class="prompt-actions">
      <span>Ctrl + Enter to send</span>
      <button type="submit" disabled={loading || !prompt.trim()}>{loading ? "Working…" : "Generate changes"}<span aria-hidden="true"> ↗</span></button>
    </div>
  </form>
</section>

<style>
  .ai-panel{height:100%;min-height:0;display:flex;flex-direction:column;background:#17181f;color:#e9e8ef;font-family:'DM Sans',Inter,Segoe UI,sans-serif}
  .ai-header{height:34px;min-height:34px;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid #ffffff0c}
  .ai-title{display:flex;align-items:center;gap:7px;color:#d7d5df;font:9px 'DM Mono',monospace;letter-spacing:.1em}
  .ai-mark{font-size:13px;color:#a99cff}.ai-caption{color:#777583;font-size:10px}
  .conversation{flex:1;min-height:0;overflow:auto;padding:9px 12px;display:flex;flex-direction:column;gap:8px}
  .empty-state,.loading-state{display:flex;align-items:center;gap:7px;color:#858391;font:10px 'DM Mono',monospace}
  .empty-state{min-height:30px}.loading-state{padding:4px 0;color:#b0a6e8}
  .spinner{width:11px;height:11px;border:1px solid #655b94;border-top-color:#b5a6ff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .message{max-width:min(760px,100%);display:grid;grid-template-columns:62px minmax(0,1fr);align-items:baseline;column-gap:8px;row-gap:3px}
  .message-role{color:#8e87bd;font:8px 'DM Mono',monospace;letter-spacing:.08em}.user-message .message-role{color:#777583}
  .message-content,.summary{grid-column:2;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c6c4cf;font-size:11px;line-height:1.5}
  .summary{color:#e0deea;font-weight:500}
  .operation-details{grid-column:2;color:#92909e;font-size:9px}
  .operation-details>summary,.operation>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px;min-height:19px}
  .operation-details>summary::-webkit-details-marker,.operation>summary::-webkit-details-marker{display:none}
  .operation-details>summary:before,.operation>summary:before{content:'›';display:inline-block;color:#9a8bf0;font-size:14px;transition:transform .12s}
  .operation-details[open]>summary:before,.operation[open]>summary:before{transform:rotate(90deg)}
  .operation-details>summary span{margin-left:auto;color:#777583}
  .operation-list{display:grid;gap:2px;margin:2px 0 4px 5px;padding-left:8px;border-left:1px solid #ffffff14}
  .operation{color:#aaa8b4}.operation-kind{min-width:43px;color:#a99cff;font:8px 'DM Mono',monospace}
  pre{max-height:180px;overflow:auto;margin:2px 0 6px 19px;padding:7px;background:#111217;border:1px solid #ffffff0d;border-radius:4px;color:#c4c0d2;font:9px/1.45 'DM Mono',monospace;white-space:pre-wrap;overflow-wrap:anywhere}
  .undo-button{margin:2px 0 4px 18px;padding:4px 7px;border:1px solid #ffffff16;border-radius:4px;background:#24232d;color:#bcb5e4;font-size:9px;cursor:pointer}
  .undo-button:hover{background:#302d3d}
  .prompt-form{padding:7px 10px 8px;border-top:1px solid #ffffff10;background:#15161c}
  textarea{display:block;width:100%;min-height:39px;max-height:90px;resize:vertical;padding:7px 9px;border:1px solid #ffffff14;border-radius:5px;outline:none;background:#101116;color:#e5e3ec;font:10px/1.45 'DM Sans',sans-serif}
  textarea::placeholder{color:#696775}textarea:focus{border-color:#7768be}textarea:disabled{opacity:.55}
  .prompt-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px;color:#666573;font:8px 'DM Mono',monospace}
  .prompt-actions button{height:25px;padding:0 9px;border:1px solid #51467b;border-radius:4px;background:#29253c;color:#c4baff;font-size:9px;cursor:pointer}
  .prompt-actions button:hover:not(:disabled){background:#37304f}.prompt-actions button:disabled{opacity:.4;cursor:default}
  @media(max-height:600px){.ai-header{height:29px;min-height:29px}.conversation{padding-top:5px;padding-bottom:5px}.prompt-form{padding:5px 8px}.prompt-form textarea{min-height:32px}}
</style>
