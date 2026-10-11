import {
  AmbientLight, BoxGeometry, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, GridHelper, Group,
  IcosahedronGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, Scene, SphereGeometry,
  TorusGeometry, TorusKnotGeometry, WebGLRenderer, type BufferGeometry
} from "three";

interface Floater {
  mesh: Mesh;
  baseY: number;
  phase: number;
  spin: [number, number];
}

interface Bouncer {
  mesh: Mesh;
  height: number;
  period: number;
  phase: number;
}

/** A slow, decorative editor-like scene behind the landing hero: a grid floor, floating primitives, and bouncing balls. */
export function startHeroScene(canvas: HTMLCanvasElement, reducedMotion: boolean): void {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.fog = new Fog(0x0e0e11, 14, 38);
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);

  scene.add(new AmbientLight(0xb8b0ff, 0.55));
  const key = new DirectionalLight(0xffffff, 2.1);
  key.position.set(6, 10, 7);
  scene.add(key);
  const rim = new PointLight(0x8b7cf6, 60, 30);
  rim.position.set(-6, 4, -4);
  scene.add(rim);
  const warm = new PointLight(0xf0b37e, 22, 22);
  warm.position.set(7, 2, 3);
  scene.add(warm);

  const grid = new GridHelper(80, 80, 0x4b4380, 0x24232e);
  grid.position.y = -2.2;
  scene.add(grid);

  const accent = new MeshStandardMaterial({ color: 0x8b7cf6, roughness: 0.35, metalness: 0.15 });
  const pale = new MeshStandardMaterial({ color: 0xe9e6ff, roughness: 0.45 });
  const dark = new MeshStandardMaterial({ color: 0x2c2a3a, roughness: 0.6, metalness: 0.2 });
  const warmMat = new MeshStandardMaterial({ color: 0xf0b37e, roughness: 0.4 });
  const green = new MeshStandardMaterial({ color: 0x83cfa0, roughness: 0.4 });

  const world = new Group();
  scene.add(world);

  // Kept to the sides so the headline in the middle stays readable.
  const floaters: Floater[] = [];
  const addFloater = (geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number, scale = 1) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    world.add(mesh);
    floaters.push({ mesh, baseY: y, phase: Math.random() * Math.PI * 2, spin: [0.15 + Math.random() * 0.25, 0.1 + Math.random() * 0.2] });
  };
  addFloater(new TorusKnotGeometry(0.75, 0.24, 140, 20), accent, -7.2, 1.4, -2);
  addFloater(new BoxGeometry(1.4, 1.4, 1.4), pale, 7.4, 2.2, -3);
  addFloater(new IcosahedronGeometry(0.9, 0), dark, -5.2, -0.6, 2.5);
  addFloater(new TorusGeometry(0.85, 0.28, 24, 60), warmMat, 6.2, -0.3, 1.8);
  addFloater(new ConeGeometry(0.7, 1.4, 32), green, -9.5, 3.4, -7);
  addFloater(new CylinderGeometry(0.55, 0.55, 1.4, 32), accent, 10, 3.8, -8);
  addFloater(new SphereGeometry(0.6, 32, 16), pale, 3.6, 4.6, -9, 1.2);
  addFloater(new BoxGeometry(1, 1, 1), accent, -3.8, 4.8, -10, 1.1);

  // Balls bouncing on the floor, as if the physics simulation were running.
  const bouncers: Bouncer[] = [];
  const ball = new SphereGeometry(0.42, 32, 16);
  [[-3.2, 4.5, 0x8b7cf6], [3.4, 6, 0xe9e6ff], [-11, -5, 0xf0b37e], [12, -4, 0x83cfa0], [0.4, -12, 0x8b7cf6]].forEach(([x, z, color], index) => {
    const mesh = new Mesh(ball, new MeshStandardMaterial({ color, roughness: 0.3 }));
    mesh.position.set(x, 0, z);
    world.add(mesh);
    bouncers.push({ mesh, height: 1.6 + index * 0.45, period: 1.1 + index * 0.17, phase: index * 0.37 });
  });

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (event) => {
    pointer.tx = event.clientX / window.innerWidth - 0.5;
    pointer.ty = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Pull back on narrow screens so the side objects stay in frame.
    camera.fov = width < 700 ? 60 : 42;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);

  renderer.setClearColor(0x0e0e11, 0);

  const render = (seconds: number) => {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    const orbit = seconds * 0.04;
    camera.position.set(Math.sin(orbit) * 2 + pointer.x * 2.4, 2.4 - pointer.y * 1.4, 14 + Math.cos(orbit) * 1.2);
    camera.lookAt(0, 1, 0);

    for (const { mesh, baseY, phase, spin } of floaters) {
      mesh.position.y = baseY + Math.sin(seconds * 0.8 + phase) * 0.35;
      mesh.rotation.x += spin[0] * 0.01;
      mesh.rotation.y += spin[1] * 0.01;
    }
    for (const { mesh, height, period, phase } of bouncers) {
      // A ballistic arc per bounce, with a quick squash on contact.
      const t = ((seconds / period + phase) % 1);
      const arc = 4 * t * (1 - t);
      mesh.position.y = -2.2 + 0.42 + arc * height;
      const squash = t < 0.06 || t > 0.94 ? 0.82 : 1;
      mesh.scale.set(2 - squash, squash, 2 - squash);
    }
    renderer.render(scene, camera);
  };

  if (reducedMotion) {
    render(4);
    window.addEventListener("resize", () => render(4));
    return;
  }
  renderer.setAnimationLoop((time) => {
    if (visible && !document.hidden) render(time / 1000);
  });
}
