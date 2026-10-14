// Runs actual editor interactions through Chrome DevTools, without extra dependencies.
// Start `npm run dev`, then run `node scripts/editor-browser-audit.mjs [base URL]`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const port = 9224;
const artifacts = path.resolve(".browser-audit");
await mkdir(artifacts, { recursive: true });
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(artifacts, "profile")}`, "--no-first-run", "--no-default-browser-check", "--enable-unsafe-swiftshader", "about:blank"], { windowsHide: true, stdio: "ignore" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const results = [];
let socket;
let sequence = 0;
const pending = new Map();
let session;
async function cdp(method, params = {}, target = session) {
  const id = ++sequence;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, replMode: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await delay(50); }
  throw new Error(`Condition did not become true: ${expression}`);
}
async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)}); node.click(); })()`);
  await delay(70);
}
async function textButton(text) {
  await evaluate(`(() => { const node = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)}); if (!node || node.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)}); node.click(); })()`);
  await delay(70);
}
async function key(key, options = {}) {
  await evaluate(`document.body.focus(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(options.code ?? key)}, bubbles: true, cancelable: true, ...${JSON.stringify(options)} }));`);
  await delay(70);
}
async function snapshot() { return await evaluate("JSON.parse(JSON.stringify(window.auditTutorial.snapshot))"); }
async function select(id, ctrl = false) {
  await evaluate(`(() => { const id = ${JSON.stringify(id)}; const entity = window.auditTutorial.snapshot.scene.entities.find(entity => entity.id === id); const node = [...document.querySelectorAll('.hierarchy .select-button')].find(node => node.querySelector('.entity-name')?.textContent === entity?.name); if (!node) throw new Error('No hierarchy row: ' + id); node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ${ctrl} })); })()`);
  await delay(70);
}
async function newScene() { await click('[data-tutorial-target="scene-menu"]'); await click('[data-tutorial-target="file-new"]'); }
async function load(scene) {
  await evaluate(`(() => { const input = document.querySelector('input[type=file]'); const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(scene))}], 'audit.scene.json', {type:'application/json'})); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await delay(150);
}
async function change(selector, value, event = "change") {
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
  await delay(70);
}
async function test(name, fn) {
  const errorStart = errors.length;
  try { await fn(); assert.equal(errors.length, errorStart, JSON.stringify(errors.slice(errorStart))); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}

try {
  let version;
  for (let n = 0; n < 100; n++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await delay(100); }
  }
  assert.ok(version, "Headless Chrome did not start");
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id); clearTimeout(call.timeout);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" }, null);
  ({ sessionId: session } = await cdp("Target.attachToTarget", { targetId, flatten: true }, null));
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  // Keep an audit run stable if another workspace task edits files while Vite is serving.
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `const NativeSocket = window.WebSocket; window.WebSocket = class extends NativeSocket { constructor(url, protocols) { if (protocols === 'vite-hmr') return new class extends EventTarget { readyState = 0; send() {} close() {} }; super(url, protocols); } };` });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: `${base}/editor/` });
  await until("!!document.querySelector('.viewport canvas')");
  await evaluate("window.auditTutorial = (await import('/src/editor/tutorial/tutorialState.svelte.ts')).tutorial");
  await until("!!window.auditTutorial.snapshot");

  await test("create every primitive, light, camera and undo/redo", async () => {
    await newScene();
    const initial = (await snapshot()).scene;
    for (const label of ["Cube", "Sphere", "Cylinder", "Capsule", "Cone", "Plane", "Point light", "Sun light", "Spot light", "Camera", "Empty group"]) {
      await textButton("Add"); await textButton(label);
    }
    const created = (await snapshot()).scene;
    assert.equal(created.entities.length, initial.entities.length + 11);
    for (let n = 0; n < 11; n++) await key("z", {ctrlKey: true});
    assert.deepEqual((await snapshot()).scene, initial);
    for (let n = 0; n < 11; n++) await key("y", {ctrlKey: true});
    assert.deepEqual((await snapshot()).scene, created);
  });

  await test("delete a multiselection in one undo step", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    const cube = (await snapshot()).selectedIds[0];
    await textButton("Add"); await textButton("Sphere");
    const sphere = (await snapshot()).selectedIds[0];
    await select(cube); await select(sphere, true);
    const initial = (await snapshot()).scene;
    await key("Delete"); assert.equal((await snapshot()).scene.entities.length, initial.entities.length - 2);
    await key("z", {ctrlKey: true}); assert.deepEqual((await snapshot()).scene, initial);
  });

  await test("group, duplicate the tree, delete and restore", async () => {
    await newScene(); await click('[aria-label="Add Cube"]'); const cube = (await snapshot()).selectedIds[0];
    await textButton("Add"); await textButton("Sphere"); const sphere = (await snapshot()).selectedIds[0];
    await select(cube); await select(sphere, true); await key("g", {ctrlKey: true});
    const group = (await snapshot()).selectedIds[0];
    const before = (await snapshot()).scene;
    await key("d", {ctrlKey:true}); const copy = (await snapshot()).selectedIds[0];
    assert.equal((await snapshot()).scene.entities.filter(entity => entity.parent === copy).length, 2);
    await key("z", {ctrlKey:true}); assert.deepEqual((await snapshot()).scene, before);
    await select(group); await key("g", {ctrlKey:true, shiftKey:true});
    assert.ok(!(await snapshot()).scene.entities.some(entity => entity.id === group));
    await key("z", {ctrlKey:true}); assert.deepEqual((await snapshot()).scene, before);
  });

  await test("slider release and keyboard edits each undo correctly", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    const initial = (await snapshot()).scene;
    const selector = '.inspector #field-roughness';
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await delay(70);
    const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const y = rect.y + rect.height / 2;
    await cdp("Input.dispatchMouseEvent", {type:"mousePressed", x:rect.x + rect.width * 0.3, y, button:"left", clickCount:1});
    await delay(30);
    await cdp("Input.dispatchMouseEvent", {type:"mouseMoved", x:rect.x + rect.width * 0.75, y, button:"left", buttons:1});
    await delay(30);
    await cdp("Input.dispatchMouseEvent", {type:"mouseReleased", x:rect.x - 40, y:y + 90, button:"left", clickCount:1});
    await delay(100);
    assert.notDeepEqual((await snapshot()).scene, initial);
    await key("z", {ctrlKey:true}); assert.deepEqual((await snapshot()).scene, initial);
    await change(selector, 0.42, "input");
    await key("z", {ctrlKey:true}); assert.deepEqual((await snapshot()).scene, initial);
  });

  await test("script drafts save from Ctrl+S and clear when opening another scene with the same IDs", async () => {
    await newScene(); await click('[aria-label="Add Cube"]'); const id = (await snapshot()).selectedIds[0];
    await click('[data-tutorial-target="script-button"]');
    await change('.script-editor textarea', 'when game starts\n  say "draft"', "input");
    await evaluate("window.auditDownloads=[]; HTMLAnchorElement.prototype.click=function(){window.auditDownloads.push(this.href)}");
    await evaluate("const input=document.querySelector('.script-editor textarea');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))");
    await delay(200);
    assert.match((await snapshot()).scene.entities.find(entity => entity.id === id).components.Script.source, /draft/);
    await change('.script-editor textarea', 'when game starts\n  say "old draft"', "input");
    const imported = (await snapshot()).scene;
    imported.name = "Imported";
    imported.entities.find(entity => entity.id === id).components.Script.source = 'when game starts\n  say "imported"';
    await load(imported);
    assert.equal((await snapshot()).activeTab, "scene");
    await select(id); await click('[data-tutorial-target="script-button"]');
    assert.match(await evaluate("document.querySelector('.script-editor textarea').value"), /imported/);
  });

  await test("malformed import leaves the existing scene intact", async () => {
    await newScene(); const initial = (await snapshot()).scene;
    await load({...initial, entities:[{id:"bad",name:"Bad",parent:null,components:{Transform:null,Camera:null}}]});
    assert.deepEqual((await snapshot()).scene, initial);
    assert.match(await evaluate("document.body.innerText"), /Scene file is invalid/);
  });

  await test("Play, pause, step, edit lock and Stop restore the authoring scene", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    const initial = (await snapshot()).scene;
    await click('[data-tutorial-target="play"]'); await until("window.auditTutorial.snapshot.playState === 'playing'");
    await change('.inspector input[aria-label="position x"]', 99);
    assert.deepEqual((await snapshot()).scene.entities.find(entity => entity.id === "box_1").components.Transform, initial.entities.find(entity => entity.id === "box_1").components.Transform);
    await click('[data-tutorial-target="play"]'); assert.equal((await snapshot()).playState, "paused");
    await click('[data-tutorial-target="step"]'); assert.equal((await snapshot()).playState, "paused");
    await click('[data-tutorial-target="stop"]'); assert.deepEqual((await snapshot()).scene, initial);
  });

  await test("Stop cancels delayed Play initialization", async () => {
    await newScene();
    await evaluate("window.auditPhysics=await import(performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/src/runtime/physics.ts')).at(-1)?.name ?? '/src/runtime/physics.ts');window.auditCreate=window.auditPhysics.PhysicsRuntime.create;window.auditPhysics.PhysicsRuntime.create=async function(scene){await new Promise(resolve=>window.auditFinish=resolve);return window.auditCreate.call(this,scene)}");
    const initial = (await snapshot()).scene;
    await click('[data-tutorial-target="play"]'); await until("typeof window.auditFinish === 'function'");
    await click('[data-tutorial-target="stop"]');
    await evaluate("window.auditFinish();window.auditPhysics.PhysicsRuntime.create=window.auditCreate");
    await delay(500);
    assert.equal((await snapshot()).playState, "stopped"); assert.deepEqual((await snapshot()).scene, initial);
  });

  await test("timeline preview stops when simulation starts", async () => {
    await newScene(); await click('[aria-label="Add Cube"]'); await click('[aria-label="Animate"]');
    await key("k");
    const previewButton = await evaluate("[...document.querySelectorAll('.timeline button')].map(node=>({label:node.getAttribute('aria-label'),title:node.title,text:node.textContent.trim()}))");
    const label = previewButton.find(node=>node.label?.startsWith("Play"))?.label;
    assert.ok(label, "No preview play button");
    await click(`.timeline [aria-label=${JSON.stringify(label)}]`);
    await click('[data-tutorial-target="play"]'); await until("window.auditTutorial.snapshot.playState==='playing'");
    await click('[data-tutorial-target="stop"]'); await delay(300);
    assert.equal((await snapshot()).timelineTime, 0);
  });

  await test("blank, invalid and out-of-range numeric inputs preserve the scene and reset the display", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    const initial = (await snapshot()).scene;
    for (const value of ["", "not a number"]) {
      await change('.inspector [aria-label="position x"]', value);
      assert.deepEqual((await snapshot()).scene, initial);
      assert.equal(Number(await evaluate("document.querySelector('.inspector [aria-label=\"position x\"]').value")), initial.entities[1].components.Transform.position[0]);
    }
    await change('.inspector #field-roughness + input', 2);
    assert.deepEqual((await snapshot()).scene, initial);
    assert.equal(await evaluate("document.querySelector('.inspector #field-roughness + input').value"), "0.6");
  });

  await test("save during Play writes the pre-play scene", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    await click('[data-tutorial-target="script-button"]');
    await change('.script-editor textarea', 'when game starts\n  move me up 5', "input");
    await click('[data-tutorial-target="script-apply"]');
    await textButton("Scene");
    const initial = (await snapshot()).scene;
    await evaluate("window.auditDownloads=[]");
    await click('[data-tutorial-target="play"]'); await until("window.auditTutorial.snapshot.playState==='playing'");
    await key("s", {ctrlKey:true});
    await until("window.auditDownloads.length===1");
    const saved = await evaluate("(await (await fetch(window.auditDownloads[0])).json())");
    assert.deepEqual(saved.entities.find(entity=>entity.id==='box_1').components.Transform, initial.entities.find(entity=>entity.id==='box_1').components.Transform);
    await click('[data-tutorial-target="stop"]');
  });

  await test("blocked browser storage does not break panel controls", async () => {
    await evaluate("window.auditStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Test storage quota','QuotaExceededError')}");
    try { await click('[aria-label="Animate"]'); await click('[aria-label="Animate"]'); }
    finally { await evaluate("Storage.prototype.setItem=window.auditStorage"); }
  });

  await test("delayed AI replies preserve edits made while loading", async () => {
    await newScene();
    await evaluate(`window.auditFetch=window.fetch;window.auditReply={summary:'Added a box',ops:[{op:'create',id:'ai_box',name:'AI Box',parent:null,components:{Transform:{position:[0,0.5,0]},Mesh:{},Material:{}}}]};window.auditAICalls=0;window.fetch=async function(url,options){if(String(url).endsWith('/api/ai/chat')){window.auditAICalls++;if(window.auditAICalls===1)await new Promise(resolve=>window.auditAIRelease=resolve);return new Response(JSON.stringify({content:JSON.stringify(window.auditReply)}),{status:200,headers:{'Content-Type':'application/json'}})}return window.auditFetch(url,options)};`);
    try {
      await click('[data-tutorial-target="shelf-generate"]');
      await change('.ai-panel textarea', 'Add a box', "input");
      await click('.ai-panel [aria-label="Send"]'); await until("typeof window.auditAIRelease==='function'");
      await click('[aria-label="Add Cube"]');
      const changed = (await snapshot()).scene;
      await evaluate("window.auditAIRelease()"); await until("!!document.querySelector('.ai-panel [aria-label=\"Send\"]')");
      assert.deepEqual((await snapshot()).scene, changed);
      assert.match(await evaluate("document.body.innerText"), /scene changed/i);
    } finally { await evaluate("window.fetch=window.auditFetch"); }
  });

  await test("AI undo refuses to discard newer edits and works after undoing them", async () => {
    await newScene();
    await evaluate("window.auditFetch=window.fetch;window.fetch=async function(url,options){if(String(url).endsWith('/api/ai/chat'))return new Response(JSON.stringify({content:JSON.stringify(window.auditReply)}),{status:200,headers:{'Content-Type':'application/json'}});return window.auditFetch(url,options)}");
    try {
      if (!(await snapshot()).panelOpen.ai) await click('[data-tutorial-target="shelf-generate"]');
      await change('.ai-panel textarea', 'Add a box', "input"); await click('.ai-panel [aria-label="Send"]');
      await until("window.auditTutorial.snapshot.scene.entities.some(entity=>entity.id==='ai_box')");
      await click('[aria-label="Add Cube"]'); const withEdit = (await snapshot()).scene;
      await evaluate("[...document.querySelectorAll('.ai-panel .undo-button')].at(-1).click()"); await delay(70);
      assert.deepEqual((await snapshot()).scene, withEdit);
      await key("z", {ctrlKey:true});
      await evaluate("[...document.querySelectorAll('.ai-panel .undo-button')].at(-1).click()"); await delay(70);
      assert.ok(!(await snapshot()).scene.entities.some(entity=>entity.id==='ai_box'));
    } finally { await evaluate("window.fetch=window.auditFetch"); }
  });

  await test("GLB and HTML exports contain the selected scene", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    await evaluate("window.auditDownloads=[]");
    await click('.export-menu summary');
    await click('[data-tutorial-target="export-glb"]'); await until("window.auditDownloads.length===1");
    const magic = await evaluate("Array.from(new Uint8Array(await (await fetch(window.auditDownloads[0])).arrayBuffer()).slice(0,4))");
    assert.deepEqual(magic, [103,108,84,70]);
    await click('.export-menu summary');
    await click('[data-tutorial-target="export-html"]'); await until("window.auditDownloads.length===2");
    assert.match(await evaluate("await (await fetch(window.auditDownloads[1])).text()"), /box_1/);
  });

  await test("WebM export records a one-second video and restores stopped playback", async () => {
    await evaluate("window.auditDownloads=[]");
    await click('.export-menu summary');
    await change('.video-options input', 1, "input");
    await click('[data-tutorial-target="export-video"]');
    await until("window.auditDownloads.length===1 || !!document.querySelector('.export-popover p[role=alert]')");
    assert.equal(await evaluate("document.querySelector('.export-popover p[role=alert]')?.textContent ?? ''"), "");
    const type = await evaluate("(await (await fetch(window.auditDownloads[0])).blob()).type");
    assert.match(type, /video\/webm/);
    assert.equal((await snapshot()).playState, "stopped");
  });

  await test("script tabs and hierarchy work for scene, constructor and prototype-named IDs", async () => {
    const scene = (await snapshot()).scene;
    scene.entities = ['scene','constructor','toString','__proto__'].map(id=>({id,name:id,parent:id==='__proto__'?'constructor':null,components:{Transform:{},Mesh:{},Script:{source:'when game starts\n  say "hello"'}}}));
    await load(scene);
    assert.equal(await evaluate("document.querySelectorAll('.hierarchy .select-button').length"), 4);
    for (const id of ['scene','constructor','toString','__proto__']) {
      await select(id); await click('[data-tutorial-target="script-button"]');
      assert.equal((await snapshot()).activeTab, `script:${id}`);
      assert.match(await evaluate("document.querySelector('.script-editor textarea').value"), /hello/);
      await change('.script-editor textarea', 'when game starts\n  say "edited"', 'input');
      await click('[data-tutorial-target="script-apply"]');
      assert.match((await snapshot()).scene.entities.find(entity=>entity.id===id).components.Script.source, /edited/);
      await textButton('Scene');
    }
  });

  await test("removing an animated component prevents preview from restoring it", async () => {
    await newScene(); await click('[aria-label="Add Cube"]');
    const scene = (await snapshot()).scene;
    scene.entities.find(entity=>entity.id==='box_1').components.Animator={tracks:[{component:'Material',field:'color',keys:[{time:0,value:'#ff0000'}]}]};
    await load(scene); await select('box_1');
    await click('[aria-label="Remove Material"]');
    assert.equal((await snapshot()).scene.entities.find(entity=>entity.id==='box_1').components.Material, undefined);
    await change('.timeline [aria-label="Playhead time in seconds"]', 1);
    assert.equal(await evaluate("document.querySelector('[data-tutorial-target=\"inspector-Material\"]')"), null);
    await key('z', {ctrlKey:true});
    assert.ok((await snapshot()).scene.entities.find(entity=>entity.id==='box_1').components.Material);
  });

  const capture = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(artifacts, "editor.png"), Buffer.from(capture.data, "base64"));
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({base,results,errors}, null, 2));
  assert.ok(results.every(result=>result.passed), "Browser audit has failures; see .browser-audit/results.json");
  assert.equal(errors.length, 0, "Browser raised uncaught exceptions");
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await cdp("Browser.close", {}, null).catch(()=>{}); socket.close(); }
  browser.kill();
  for (const call of pending.values()) clearTimeout(call.timeout);
}
