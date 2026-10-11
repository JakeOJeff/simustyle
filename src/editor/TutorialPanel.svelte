<script lang="ts">
  import { chapters } from "./tutorial/chapters";
  import { tutorial } from "./tutorial/tutorialState.svelte";

  let chapter = $derived(chapters.find((item) => item.id === tutorial.chapterId) ?? null);
  let totalSteps = $derived(chapters.reduce((total, item) => total + item.steps.length, 0));
  let completedSteps = $derived(Object.values(tutorial.progress).reduce((total, steps) => total + steps.length, 0));

  function beginChapter(id: string) {
    const item = chapters.find((candidate) => candidate.id === id);
    const done = tutorial.progress[id] ?? [];
    tutorial.goTo(id, Math.max(0, item ? item.steps.findIndex((_, index) => !done.includes(index)) : 0));
  }

  function parts(text: string): { code: boolean; text: string }[] {
    return text.split("`").map((part, index) => ({ code: index % 2 === 1, text: part }));
  }
</script>

<div class="tutorial-page">
  <header class="tutorial-header">
    <span class="tutorial-eyebrow">OPTIONAL INTERACTIVE GUIDE</span>
    <h1>Learn SimuStyle by doing</h1>
    <p>Choose a chapter and follow the highlighted control. Each step checks off as you do it and moves on by itself, so you can close this panel and keep going from the guide card.</p>
    <div class="overall-progress"><span>{completedSteps} of {totalSteps} steps</span><progress value={completedSteps} max={totalSteps}></progress><button type="button" onclick={() => tutorial.resetProgress()} disabled={!completedSteps && !tutorial.chapterId}>Reset</button></div>
  </header>

  <div class="tutorial-layout">
    <nav class="chapter-list" aria-label="Tutorial chapters">
      {#each chapters as item (item.id)}
        {@const done = tutorial.progress[item.id]?.length ?? 0}
        <button type="button" class:active={tutorial.chapterId === item.id} onclick={() => beginChapter(item.id)}>
          <span class="chapter-title">{item.title}</span>
          <small>{done}/{item.steps.length} complete</small>
        </button>
      {/each}
    </nav>

    <section class="tutorial-content" aria-label="Chapter contents">
      {#if chapter}
        {@const step = chapter.steps[tutorial.stepIndex]}
        {@const done = tutorial.progress[chapter.id]?.includes(tutorial.stepIndex) ?? false}
        <div class="tutorial-topline"><button class="back-button" type="button" onclick={() => tutorial.goTo(null)}>All chapters</button><span>Chapter {chapters.findIndex((item) => item.id === chapter.id) + 1} of {chapters.length}</span></div>
        <h2>{chapter.title}</h2>
        <p class="chapter-summary">{chapter.summary}</p>
        <div class="step-progress"><progress value={(tutorial.progress[chapter.id]?.length ?? 0)} max={chapter.steps.length}></progress><span>Step {tutorial.stepIndex + 1} of {chapter.steps.length}</span></div>
        {#if step}
          <article class="step-card">
            <span class="step-label">{step.tasks.length ? "DO THIS IN THE EDITOR" : "READ THIS"}</span>
            <h3>{step.title}</h3>
            <p>{#each parts(step.instruction) as part}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</p>
            {#if step.tasks.length}
              <ul class="task-list">
                {#each step.tasks as task, index}<li class:complete={tutorial.taskDone[index]}><span aria-hidden="true">{tutorial.taskDone[index] ? "✓" : "○"}</span>{task.label}</li>{/each}
              </ul>
              <p class="auto-note">This step completes automatically when you do it. The highlighted control shows where to start.</p>
            {/if}
            {#if done}<p class="done-note" role="status">You've completed this step before.</p>{/if}
          </article>
        {/if}
        <div class="step-map" aria-label="Chapter steps">
          {#each chapter.steps as item, index}
            <button type="button" class:current={tutorial.stepIndex === index} class:complete={tutorial.progress[chapter.id]?.includes(index) ?? false} aria-label="Step {index + 1}: {item.title}" onclick={() => tutorial.goTo(chapter.id, index)}>{index + 1}</button>
          {/each}
        </div>
        {#if (tutorial.progress[chapter.id]?.length ?? 0) === chapter.steps.length}<p class="chapter-done" role="status">Chapter complete. Choose another chapter or revisit any step.</p>{/if}
      {:else}
        <div class="chapter-welcome">
          <span class="step-label">PICK UP WHERE YOU LIKE</span>
          <h2>Choose a chapter</h2>
          <p>Every chapter is self-contained. Start at the beginning or jump to a feature. The guide highlights the control to use and advances as soon as you've done what it asks.</p>
          <div class="chapter-cards">
            {#each chapters as item (item.id)}
              {@const done = tutorial.progress[item.id]?.length ?? 0}
              <button type="button" onclick={() => beginChapter(item.id)}>
                <span>{item.title}</span><small>{item.summary}</small><progress value={done} max={item.steps.length}></progress>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .tutorial-page{height:100%;overflow:auto;background:#19191d;color:#d9d9dd;font:11px/1.55 'DM Sans',sans-serif}
  .tutorial-header{padding:22px 24px 15px;border-bottom:1px solid #ffffff12;background:#1c1c20}
  .tutorial-eyebrow,.step-label{color:#a99bff;font:9px 'DM Mono',monospace;letter-spacing:.14em}
  h1{margin:7px 0 5px;color:#f2f2f4;font-size:19px;line-height:1.25;font-weight:600;letter-spacing:-.025em}
  .tutorial-header>p{max-width:650px;margin:0;color:#9c9ca6}
  .overall-progress{display:flex;align-items:center;gap:10px;margin-top:13px;color:#aaaab3;font-size:10px}.overall-progress progress{flex:1}.overall-progress button,.tutorial-content button{border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#d4d4d8;padding:6px 10px;font:11px 'DM Sans',sans-serif;cursor:pointer}.overall-progress button:disabled{opacity:.4;cursor:default}
  progress{height:5px;accent-color:#8b7cf6}
  .tutorial-layout{display:grid;grid-template-columns:185px minmax(0,1fr);min-height:calc(100% - 146px)}
  .chapter-list{display:flex;flex-direction:column;gap:3px;padding:12px 9px;border-right:1px solid #ffffff10;background:#17171a}
  .chapter-list button{display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid transparent;border-radius:6px;background:transparent;text-align:left;color:#bdbdc4;cursor:pointer}.chapter-list button:hover{background:#232327}.chapter-list button.active{border-color:#7c6cf066;background:#3b3566;color:#e1dbff}.chapter-list small{color:#767683;font-size:9px}
  .tutorial-content{min-width:0;padding:18px clamp(16px,4vw,34px) 30px}.tutorial-topline{display:flex;justify-content:space-between;align-items:center;color:#767683;font:9px 'DM Mono',monospace}.tutorial-content .back-button{padding:3px 7px;background:transparent;color:#aaa4c9}
  h2{margin:13px 0 2px;color:#f0f0f2;font-size:16px;font-weight:600}.chapter-summary{margin:0;color:#9999a2}.step-progress{display:flex;align-items:center;gap:10px;margin:17px 0 9px;color:#82828d;font-size:9px}.step-progress progress{flex:1}
  .step-card{padding:18px;border:1px solid #ffffff14;border-radius:9px;background:#1e1e22}.step-card h3{margin:9px 0 7px;color:#f2f2f3;font-size:14px;font-weight:600}.step-card p{max-width:650px;margin:0;color:#b0b0b8;line-height:1.7}.step-card code{padding:0 3px;border-radius:3px;background:#ffffff10;color:#bfe6ff;font:10px 'DM Mono',monospace}.step-card .done-note{margin-top:12px;color:#9fd3ae}.tutorial-content button:hover:not(:disabled){background:#2d2d33;border-color:#ffffff1f;color:#fff}
  .task-list{display:grid;gap:5px;margin:13px 0 0;padding:0;list-style:none}.task-list li{display:flex;gap:8px;color:#cbcbd0}.task-list li span{width:12px;color:#8f8aa6}.task-list li.complete{color:#9fd3ae}.task-list li.complete span{color:#9fd3ae}.step-card .auto-note{margin-top:12px;color:#8f8aa6;font-size:10px}
  .step-map{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.step-map button{width:25px;height:25px;padding:0;border-radius:50%;font:9px 'DM Mono',monospace}.step-map button.current{border-color:#a99bff;background:#3b3566;color:#fff}.step-map button.complete{border-color:#527b5b;color:#a9dfb5}.chapter-done{color:#9fd3ae}
  .chapter-welcome{max-width:750px;margin:auto}.chapter-welcome h2{margin-top:8px}.chapter-welcome>p{max-width:650px;color:#9999a2}.chapter-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:18px}.chapter-cards button{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-height:92px;text-align:left}.chapter-cards button span{color:#e6e6e9;font-size:11px}.chapter-cards button small{flex:1;color:#92929c;line-height:1.45}.chapter-cards progress{width:100%}
  @media(max-width:600px){.tutorial-layout{grid-template-columns:1fr}.chapter-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-right:0;border-bottom:1px solid #ffffff10}.chapter-list button{min-width:0}.chapter-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tutorial-header{padding:16px}.tutorial-content{padding:16px}}
</style>
