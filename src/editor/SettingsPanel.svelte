<script lang="ts">
  export interface AISettingsInput {
    model: string;
    baseUrl: string;
    apiKey: string;
  }

  interface Props {
    model: string;
    baseUrl: string;
    hasApiKey: boolean;
    saving?: boolean;
    error?: string;
    onSave: (settings: AISettingsInput) => void | Promise<void>;
    onRemoveKey: () => void | Promise<void>;
    onClose?: () => void;
  }

  let { model, baseUrl, hasApiKey, saving = false, error = "", onSave, onRemoveKey, onClose }: Props = $props();
  let editedModel = $state("");
  let editedBaseUrl = $state("");
  let apiKey = $state("");
  let localError = $state("");
  let notice = $state("");
  let busy = $state(false);

  $effect(() => {
    editedModel = model;
    editedBaseUrl = baseUrl;
  });

  const pending = $derived(saving || busy);
  const keyConfigured = $derived(hasApiKey);

  function validate(): string {
    if (!editedModel.trim()) return "Enter a model name.";
    if (!editedBaseUrl.trim()) return "Enter an API base URL.";
    try {
      const url = new URL(editedBaseUrl.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return "The API URL must use HTTPS or HTTP.";
      if (!url.hostname) return "Enter a complete API base URL.";
    } catch {
      return "Enter a valid API base URL, such as https://api.openai.com/v1.";
    }
    return "";
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    localError = validate();
    notice = "";
    if (localError) return;

    busy = true;
    try {
      await onSave({ model: editedModel.trim(), baseUrl: editedBaseUrl.trim().replace(/\/+$/, ""), apiKey: apiKey.trim() });
      apiKey = "";
      localError = "";
      notice = "AI settings saved.";
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "Could not save AI settings.";
    } finally {
      busy = false;
    }
  }

  async function removeKey() {
    if (pending || !keyConfigured) return;
    localError = "";
    notice = "";
    busy = true;
    try {
      await onRemoveKey();
      notice = "Saved API key removed.";
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "Could not remove the saved API key.";
    } finally {
      busy = false;
    }
  }
</script>

<section class="settings-panel" aria-label="AI settings">
  <header class="settings-header">
    <div>
      <div class="eyebrow">PREFERENCES</div>
      <h2>AI connection</h2>
      <p>Choose the model and API endpoint used by the scene assistant.</p>
    </div>
    {#if onClose}<button class="close-button" type="button" aria-label="Close settings" onclick={onClose}>×</button>{/if}
  </header>

  <form onsubmit={save}>
    <label class="setting-field">
      <span>MODEL</span>
      <input bind:value={editedModel} autocomplete="off" placeholder="gpt-4o-mini" disabled={pending} />
      <small>The model name accepted by your API provider.</small>
    </label>

    <label class="setting-field">
      <span>API BASE URL</span>
      <input bind:value={editedBaseUrl} type="url" inputmode="url" autocomplete="url" placeholder="https://api.openai.com/v1" disabled={pending} />
      <small>Use the provider’s API root, including <code>/v1</code> when required.</small>
    </label>

    <label class="setting-field">
      <span>API KEY</span>
      <input bind:value={apiKey} type="password" autocomplete="new-password" placeholder={keyConfigured ? "Saved; enter a new key to replace" : "Paste your API key"} disabled={pending} />
      <small>{keyConfigured ? "A key is saved securely on this device." : "The key is stored securely by the desktop app."} It is never shown again.</small>
    </label>

    {#if keyConfigured}
      <button class="remove-key" type="button" onclick={removeKey} disabled={pending}>Remove saved key</button>
    {/if}

    {#if localError || error}
      <div class="feedback error" role="alert">{localError || error}</div>
    {:else if notice}
      <div class="feedback success" role="status">{notice}</div>
    {/if}

    <footer class="settings-actions">
      <span class="key-status"><i class:configured={keyConfigured} aria-hidden="true"></i>{keyConfigured ? "KEY SAVED" : "NO KEY SAVED"}</span>
      <button class="save-button" data-tutorial-target="ai-settings-save" type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
    </footer>
  </form>
</section>

<style>
  .settings-panel{width:min(460px,100%);padding:20px;background:#18181b;color:#ebebec;border:1px solid #ffffff1a;border-radius:12px;box-shadow:0 18px 50px #0009;font-family:'DM Sans',Inter,Segoe UI,sans-serif}
  .settings-header{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px}
  .eyebrow{color:#a99bff;font:9px 'DM Mono',monospace;letter-spacing:.13em}
  h2{margin:5px 0 4px;color:#f1f1f3;font-size:16px;font-weight:600}
  .settings-header p{margin:0;color:#888894;font-size:11px;line-height:1.5}
  .close-button{width:28px;height:28px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#a1a1aa;font-size:17px;cursor:pointer}.close-button:hover{background:#2d2d33;color:#fff}
  form{display:grid;gap:15px}
  .setting-field{display:grid;gap:6px;color:#a8a8b0;font:9px 'DM Mono',monospace;letter-spacing:.05em}
  .setting-field input{width:100%;height:34px;box-sizing:border-box;padding:0 10px;border:1px solid #ffffff14;border-radius:6px;outline:none;background:#121214;color:#e6e6e9;font:11px 'DM Sans',sans-serif;letter-spacing:normal}
  .setting-field input::placeholder{color:#696974}.setting-field input:focus{border-color:#a99bff88}.setting-field input:disabled{opacity:.55}
  .setting-field small{color:#767682;font:9px/1.45 'DM Sans',sans-serif;letter-spacing:normal}.setting-field code{color:#aaa5c6;font:9px 'DM Mono',monospace}
  .remove-key{justify-self:start;padding:0;border:0;background:none;color:#c18d94;font:10px 'DM Sans',sans-serif;cursor:pointer}.remove-key:hover:not(:disabled){color:#ecabb4}.remove-key:disabled{opacity:.45;cursor:default}
  .feedback{padding:8px 10px;border-radius:6px;font-size:10px;line-height:1.45}.feedback.error{border:1px solid #a44e5b44;background:#53292f30;color:#e3a2aa}.feedback.success{border:1px solid #58967844;background:#25473530;color:#9bd1b3}
  .settings-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:11px;border-top:1px solid #ffffff10}
  .key-status{display:flex;align-items:center;gap:6px;color:#757581;font:8px 'DM Mono',monospace;letter-spacing:.07em}.key-status i{width:6px;height:6px;border-radius:50%;background:#6f6f7b}.key-status i.configured{background:#7fc69b;box-shadow:0 0 8px #5cbb8255}
  .save-button{height:30px;padding:0 14px;border:1px solid transparent;border-radius:6px;background:#7c6cf0;color:#fff;font-weight:600;font-size:11px;cursor:pointer}.save-button:hover:not(:disabled){background:#8b7cf6}.save-button:disabled{opacity:.48;cursor:default}
</style>
