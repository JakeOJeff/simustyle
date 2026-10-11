import "./landing.css";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Solid nav once the page scrolls past the hero's top edge.
const nav = document.getElementById("nav")!;
const shot = document.querySelector<HTMLElement>(".shot");
function onScroll() {
  nav.classList.toggle("scrolled", window.scrollY > 12);
  // The screenshot starts tilted back and flattens as it scrolls into view.
  if (shot && !reducedMotion) {
    const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.55)));
    shot.style.transform = `rotateX(${14 * (1 - progress)}deg) scale(${0.96 + 0.04 * progress})`;
  }
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Fade sections in as they enter the viewport.
const revealTargets = document.querySelectorAll<HTMLElement>(".section-head, .card, .split > *, .parse, .steps li, .assistant > *, .platform");
if (!reducedMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  revealTargets.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.transitionDelay = element.classList.contains("card") ? `${(index % 4) * 70}ms` : "";
    observer.observe(element);
  });
}

// AI Parse demo: replays the three Parse stages whenever the demo is on screen.
// Without motion (or JS) the HTML already shows the finished result.
const parseDemo = document.getElementById("parse-demo");
if (parseDemo && !reducedMotion && "IntersectionObserver" in window) {
  const status = document.getElementById("parse-status")!;
  const steps = [...document.querySelectorAll<HTMLElement>(".steps li")];
  const localFixes = [...parseDemo.querySelectorAll<HTMLElement>(".fix.local")];
  const aiFixes = [...parseDemo.querySelectorAll<HTMLElement>(".fix.ai")];
  let timers: number[] = [];
  let onScreen = false;
  const at = (ms: number, action: () => void) => { timers.push(window.setTimeout(action, ms)); };
  const setStep = (name: string | null) => steps.forEach((step) => step.classList.toggle("active", step.dataset.step === name));
  const setStatus = (text: string, busy: boolean) => { status.textContent = text; status.classList.toggle("busy", busy); };

  const play = () => {
    timers.forEach(clearTimeout);
    timers = [];
    parseDemo.classList.add("playing", "pressed");
    parseDemo.classList.remove("thinking");
    for (const line of [...localFixes, ...aiFixes]) line.classList.remove("done");
    setStep(null);
    setStatus("8 lines · 8 problems", true);

    at(700, () => {
      parseDemo.classList.remove("pressed");
      setStep("local");
      setStatus("Fixing typos locally · no AI call", true);
      localFixes.forEach((line, index) => at(index * 260, () => line.classList.add("done")));
    });
    at(1900, () => {
      setStep("ai");
      parseDemo.classList.add("thinking");
      setStatus(`AI is rewriting ${aiFixes.length} broken lines…`, true);
    });
    at(3400, () => {
      parseDemo.classList.remove("thinking");
      aiFixes.forEach((line, index) => at(index * 240, () => line.classList.add("done")));
    });
    at(4900, () => {
      setStep("check");
      setStatus("✓ 8 of 8 lines valid", false);
    });
    // Hold the result, then replay while it stays on screen.
    at(10500, () => { if (onScreen) play(); });
  };

  new IntersectionObserver(([entry]) => {
    const wasOnScreen = onScreen;
    onScreen = entry.isIntersecting;
    if (onScreen && !wasOnScreen) play();
  }, { threshold: 0.45 }).observe(parseDemo);
}

// The installer is Windows-only; say so plainly to visitors on other systems.
const isWindows = /Windows/i.test(navigator.userAgent);
const note = document.getElementById("cta-note");
if (note && !isWindows) note.textContent = "Free · No account needed · Desktop app for Windows";

// Load three.js after first paint so the headline and buttons show immediately.
const canvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const start = () => import("./heroScene").then(({ startHeroScene }) => startHeroScene(canvas, reducedMotion)).catch(() => {
    canvas.remove();
  });
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 600 });
  else setTimeout(start, 50);
}
