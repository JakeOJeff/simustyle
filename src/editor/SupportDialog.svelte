<script lang="ts" module>
  import type { CreditStatus } from "../ai/client";

  export const DONATE_URL = "https://razorpay.me/@paulynshemy";

  /** Time until the daily reset, like "5h 12m"; empty once it has passed. */
  export function resetIn(credits: CreditStatus): string {
    const minutes = Math.ceil((Date.parse(credits.resetsAt) - Date.now()) / 60_000);
    if (!Number.isFinite(minutes) || minutes <= 0) return "";
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }
</script>

<script lang="ts">
  import { Heart, X } from "@lucide/svelte";

  interface Props {
    /** Today's balance on the hosted site; null on the desktop app or when AI is off. */
    credits: CreditStatus | null;
    /** True when the dialog opened because the credits ran out. */
    outOfCredits?: boolean;
    onClose: () => void;
  }

  let { credits, outOfCredits = false, onClose }: Props = $props();
</script>

<div class="support-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose(); }} onkeydown={(event) => { if (event.key === "Escape") onClose(); }}>
  <div class="support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title">
    <button class="close" type="button" aria-label="Close" onclick={onClose}><X size={15} /></button>
    <div class="badge" aria-hidden="true"><Heart size={18} fill="currentColor" /></div>
    {#if outOfCredits && credits}
      <p class="notice">
        {credits.globalExhausted ? "Today's shared AI budget is used up." : `You've used all ${credits.limit} of today's AI credits.`}
        They come back at 00:00 UTC{resetIn(credits) ? `, in ${resetIn(credits)}` : ""}.
      </p>
    {/if}
    <h2 id="support-title">SimuStyle is free, forever</h2>
    <p>No subscriptions, no paywalls, no ads. I build SimuStyle on my own and pay for the hosting and every AI request out of my own pocket.</p>
    <p>
      That's why the AI has a daily limit: everyone gets {credits?.limit ?? "a set number of"} free credits a day, reset at 00:00 UTC.
      One credit is one AI step, and a request usually takes two or three.
    </p>
    <p>If SimuStyle is useful to you, a donation of any size keeps the AI running for everyone.</p>
    <div class="actions">
      <a class="donate" href={DONATE_URL} target="_blank" rel="noopener noreferrer"><Heart size={14} fill="currentColor" /> Donate</a>
      <button type="button" class="later" onclick={onClose}>Maybe later</button>
    </div>
    {#if credits}<p class="footnote">The desktop app can use your own API key with no daily limit.</p>{/if}
  </div>
</div>

<style>
  .support-overlay{position:fixed;inset:0;z-index:45;display:grid;place-items:center;padding:20px;background:#0a0a0cc9;backdrop-filter:blur(4px)}
  .support-dialog{position:relative;width:min(400px,100%);padding:24px;border:1px solid #ffffff1a;border-radius:12px;background:#18181b;box-shadow:0 18px 50px #0009;color:#c9c9cf;font:12.5px/1.6 'DM Sans',sans-serif}
  .close{position:absolute;top:10px;right:10px;display:grid;width:28px;height:28px;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:#8e8e99;cursor:pointer}
  .close:hover{background:#ffffff0d;color:#fff}
  .badge{display:grid;width:36px;height:36px;place-items:center;margin-bottom:14px;border-radius:10px;background:#f472b61f;color:#f472b6}
  h2{margin:0 0 10px;color:#f0f0f2;font-size:16px;font-weight:600}
  p{margin:0 0 10px}
  .notice{padding:8px 10px;border:1px solid #e5a34540;border-radius:8px;background:#e5a34512;color:#f0c987}
  .actions{display:flex;gap:8px;margin-top:16px}
  .donate,.later{display:inline-flex;height:34px;align-items:center;justify-content:center;gap:7px;padding:0 16px;border-radius:8px;font:600 12.5px 'DM Sans',sans-serif;cursor:pointer;text-decoration:none}
  .donate{border:0;background:#7c6cf0;color:#fff}.donate:hover{background:#8b7cf6}
  .later{border:1px solid #ffffff14;background:transparent;color:#c9c9cf}.later:hover{background:#ffffff0d;color:#fff}
  .donate:focus-visible,.later:focus-visible,.close:focus-visible{outline:2px solid var(--accent,#a99bff);outline-offset:2px}
  .footnote{margin:14px 0 0;color:#7b7b88;font-size:11px}
</style>
