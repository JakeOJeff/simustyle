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

// Card glow follows the pointer.
for (const card of document.querySelectorAll<HTMLElement>(".card")) {
  card.addEventListener("pointermove", (event) => {
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
}

// Fade sections in as they enter the viewport.
const revealTargets = document.querySelectorAll<HTMLElement>(".section-head, .card, .split > *, .platform, .final, .strip");
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
    element.style.transitionDelay = element.classList.contains("card") ? `${(index % 3) * 70}ms` : "";
    observer.observe(element);
  });
}

// The installer is Windows-only; say so plainly to visitors on other systems.
const isWindows = /Windows/i.test(navigator.userAgent);
const note = document.getElementById("cta-note");
if (note && !isWindows) note.textContent = "No account needed · Runs in any modern desktop browser · Desktop app available for Windows";

// Load three.js after first paint so the headline and buttons show immediately.
const canvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const start = () => import("./heroScene").then(({ startHeroScene }) => startHeroScene(canvas, reducedMotion)).catch(() => {
    canvas.remove();
  });
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 600 });
  else setTimeout(start, 50);
}
