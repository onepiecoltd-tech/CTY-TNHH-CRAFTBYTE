// Nền bể cá cho Văn phòng AI. Phần vẽ và chuyển động cá được chuyển từ TrashQuarium (src/tank.ts, src/fish-motion.ts),
// bỏ phần săn sò, trứng và giao tiếp Tauri; danh sách cá là cố định. 30 FPS, tự dừng khi cửa sổ ẩn.
(function () {
  "use strict";
  // ---- chuyển động thân cá (từ fish-motion.ts) ----
  const STYLE = { coryphaena_hippurus: "tuna" };
  const swimStyle = (id) => STYLE[id] || "fish";
  function bodyWave(style, u, beat) {
    const back = 1 - u;
    if (style === "tuna") return 0.055 * Math.pow(back, 3) * Math.sin(beat - back * 2.2) - 0.006 * Math.pow(u, 3) * Math.sin(beat);
    return 0.055 * (0.06 + 0.94 * back * back) * Math.sin(beat - back * 3.6) - 0.012 * Math.pow(u, 3) * Math.sin(beat);
  }
  function finStretch(style, u, beat, fin) {
    const middle = Math.exp(-(((u - 0.58) / 0.17) ** 2));
    const tail = u < 0.22 ? 1 - u / 0.22 : 0;
    return 1 + 0.09 * middle * Math.sin(fin + u * 4) + 0.14 * tail * Math.sin(beat + 0.6);
  }
  const nextBurst = (burst, dt, roll, turned) => (turned || roll < dt * 0.18 ? 1 : Math.max(0, burst - dt * 0.9));

  // ---- đàn cá mặc định: [mã loài, cỡ tương đối] ----
  const FISH = [["cyprinus_carpio", 0.62], ["carassius_auratus", 0.5], ["amphiprion_ocellaris", 0.38], ["betta_splendens", 0.42], ["chaetodon_auriga", 0.4],
    ["danio_rerio", 0.3], ["holacanthus_ciliaris", 0.5], ["balistoides_conspicillum", 0.46], ["centropyge_loriculus", 0.36], ["chromobotia_macracanthus", 0.42], ["coryphaena_hippurus", 0.6]];
  const SLICES = 24, FPS = 30;
  let cv = null, ctx = null, running = false, raf = 0, last = 0, W = 0, H = 0, clock = 0, dpr = 1;
  let swimmers = [], bubbles = [], pellets = [], nextFood = 20, ocean = null, bgCanvas = null, baseUrl = "assets/";
  const sprites = new Map(), bounds = new Map(), baked = new Map();
  const swimTop = () => H * 0.12, swimBottom = () => H * 0.78;
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = cv.clientWidth || window.innerWidth; H = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); baked.clear();
    bgCanvas = document.createElement("canvas"); bgCanvas.width = cv.width; bgCanvas.height = cv.height;
    const bg = bgCanvas.getContext("2d"); bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ocean) { const s = Math.max(W / ocean.width, H / ocean.height), w = ocean.width * s, h = ocean.height * s; bg.drawImage(ocean, (W - w) / 2, (H - h) / 2, w, h); }
    else { const g = bg.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1b6a73"); g.addColorStop(1, "#08262c"); bg.fillStyle = g; bg.fillRect(0, 0, W, H); }
  }
  const fishLen = (s) => Math.min(Math.min(W, H) * 0.22 * s.size, W * 0.3);
  function pick(s) { s.tx = W * (0.06 + Math.random() * 0.88); s.ty = swimTop() + Math.random() * (swimBottom() - swimTop()); }

  function step(dt) {
    clock += dt;
    if (clock > nextFood) { nextFood = clock + 40 + Math.random() * 50; const x = W * (0.2 + Math.random() * 0.6); for (let i = 0; i < 4; i++) pellets.push({ x: x + (Math.random() - 0.5) * 40, y: H * 0.06, vy: 22 + Math.random() * 14, wobble: Math.random() * 6, bottomFor: 0 }); }
    const floor = H * 0.9;
    for (const p of pellets) { if (p.y < floor) { p.y = Math.min(floor, p.y + p.vy * dt); p.x += Math.sin(clock * 2 + p.wobble) * 8 * dt; } else p.bottomFor += dt; }
    pellets = pellets.filter((p) => p.bottomFor < 12);
    for (const s of swimmers) {
      const len = fishLen(s), cruise = (len * 0.35 + 18) * s.speed * (0.75 + 0.7 * s.burst);
      let food = null;
      if (pellets.length) { let best = W * 0.4; for (const p of pellets) { const d = Math.hypot(p.x - s.x, p.y - s.y); if (d < best) { best = d; food = p; } } }
      const mouth = s.x + (Math.sign(s.facing) || 1) * len * 0.42;
      if (food) {
        const dir = food.x >= s.x ? 1 : -1; s.tx = food.x - dir * len * 0.42; s.ty = food.y; s.chasing = true; s.burst = Math.max(s.burst, 0.45);
        if (Math.hypot(food.x - mouth, food.y - s.y) < len * 0.16 + 8) { pellets = pellets.filter((p) => p !== food); s.gulp = 1; if (bubbles.length < 24) bubbles.push({ x: mouth, y: s.y, r: 2 + Math.random() * 2, v: 30 + Math.random() * 20 }); }
      } else if (s.chasing) { s.chasing = false; pick(s); }
      const dx = s.tx - s.x, dy = s.ty - s.y, dist = Math.hypot(dx, dy);
      if (!s.chasing && dist < len * 0.4) pick(s);
      const steer = Math.min(1, dt * (s.chasing ? 2 : 0.8));
      s.vx += ((dx / (dist || 1)) * cruise - s.vx) * steer; s.vy += ((dy / (dist || 1)) * cruise * (s.chasing ? 0.9 : 0.45) - s.vy) * steer;
      s.x += s.vx * dt; s.y += s.vy * dt; s.phase += dt * (2 + Math.abs(s.vx) / 40);
      s.tail += dt * (3 + Math.hypot(s.vx, s.vy) / 26 + 5 * s.burst); s.fin += dt * (7 + 3 * s.burst);
      const want = s.vx > 8 ? 1 : s.vx < -8 ? -1 : Math.sign(s.facing) || 1, turned = want !== (Math.sign(s.facing) || 1);
      s.facing += (want - s.facing) * Math.min(1, dt * 11); s.gulp = Math.max(0, s.gulp - dt * 2.8);
      if (s.gulp === 0 && Math.random() < dt * 0.02) s.gulp = 0.7;
      s.burst = nextBurst(s.burst, dt, Math.random(), turned);
    }
    if (bubbles.length < 16 && Math.random() < dt * 1.3) bubbles.push({ x: W * (0.05 + Math.random() * 0.9), y: H * 0.9, r: 2 + Math.random() * 4, v: 25 + Math.random() * 35 });
    for (const b of bubbles) { b.y -= b.v * dt; b.x += Math.sin((b.y + b.r * 50) / 30) * 0.3; }
    bubbles = bubbles.filter((b) => b.y > H * 0.05);
  }

  function visBounds(id, img) {
    let b = bounds.get(id); if (b) return b; b = { x: 0, y: 0, w: img.width, h: img.height };
    try {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= x0 && y1 >= y0) b = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch (e) { /* giữ nguyên ảnh */ }
    bounds.set(id, b); return b;
  }
  function bake(id, img, len) {
    const key = id + "|" + Math.round(len * dpr); let hit = baked.get(key); if (hit) return hit; if (baked.size > 80) baked.clear();
    const b = visBounds(id, img); let w = len, h = len * (b.h / b.w); if (h > len * 0.8) { w *= (len * 0.8) / h; h = len * 0.8; }
    const pad = Math.ceil(len * 0.12), c = document.createElement("canvas"); c.width = Math.ceil((w + pad * 2) * dpr); c.height = Math.ceil((h + pad * 2) * dpr);
    c.getContext("2d").drawImage(img, b.x, b.y, b.w, b.h, pad * dpr, pad * dpr, w * dpr, h * dpr);
    const sh = document.createElement("canvas"); sh.width = c.width; sh.height = c.height; const sg = sh.getContext("2d"), far = c.width + 50;
    sg.shadowColor = "rgba(0,20,25,0.35)"; sg.shadowBlur = len * 0.08 * dpr; sg.shadowOffsetX = far; sg.shadowOffsetY = len * 0.05 * dpr;
    sg.drawImage(img, b.x, b.y, b.w, b.h, pad * dpr - far, pad * dpr, w * dpr, h * dpr);
    hit = { canvas: c, shadow: sh, pad, w, h }; baked.set(key, hit); return hit;
  }
  function drawFish(s, img, len) {
    const { canvas: src, shadow, pad, w, h } = bake(s.id, img, len), tw = w + pad * 2, th = h + pad * 2;
    ctx.drawImage(shadow, -tw / 2, -th / 2, tw, th);
    const sliceW = src.width / SLICES, destW = tw / SLICES, style = swimStyle(s.id), power = 1 + 0.7 * s.burst;
    ctx.rotate(Math.sin(s.tail + 1.2) * 0.025 * power);
    const uAt = (x) => Math.min(1, Math.max(0, (x + w / 2) / w)), waveAt = (x) => bodyWave(style, uAt(x), s.tail) * w * power;
    let left = waveAt(-tw / 2);
    for (let i = 0; i < SLICES; i++) {
      const x0 = -tw / 2 + i * destW, right = waveAt(x0 + destW), u = uAt(x0 + destW / 2), head = u > 0.78 ? (u - 0.78) / 0.22 : 0;
      const sh2 = th * finStretch(style, u, s.tail, s.fin) * (1 + 0.16 * Math.sin(s.gulp * Math.PI) * head);
      ctx.save(); ctx.transform(1, (right - left) / destW, 0, 1, x0, left); ctx.drawImage(src, i * sliceW, 0, sliceW, src.height, 0, -sh2 / 2, destW + 0.6, sh2); ctx.restore(); left = right;
    }
  }
  function fallback(len) { ctx.fillStyle = "#f2b36b"; ctx.beginPath(); ctx.ellipse(0, 0, len * 0.38, len * 0.18, 0, 0, Math.PI * 2); ctx.moveTo(-len * 0.32, 0); ctx.lineTo(-len * 0.5, -len * 0.14); ctx.lineTo(-len * 0.5, len * 0.14); ctx.fill(); }

  function draw() {
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    ctx.fillStyle = "rgba(220,245,255,0.35)"; for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
    for (const p of pellets) { const fade = p.bottomFor > 9 ? 1 - (p.bottomFor - 9) / 3 : 1; ctx.globalAlpha = Math.max(0, fade); ctx.fillStyle = "#c9782f"; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    for (const s of [...swimmers].sort((a, b) => a.y - b.y)) {
      const len = fishLen(s), img = sprites.get(s.id), bob = Math.sin(s.phase * 0.7) * len * 0.02;
      ctx.save(); ctx.translate(s.x, s.y + bob); ctx.rotate(Math.atan2(s.vy, Math.abs(s.vx) + 1) * 0.35 * Math.sign(s.facing || 1));
      const turn = Math.abs(s.facing); ctx.scale((Math.sign(s.facing) || 1) * Math.max(0.22, turn), 1 + 0.08 * (1 - turn));
      if (img) drawFish(s, img, len); else fallback(len);
      ctx.restore();
    }
  }
  function frame(now) {
    if (!running) return; raf = requestAnimationFrame(frame);
    if (document.hidden || now - last < 1000 / FPS - 1) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.033); last = now; step(dt); draw();
  }
  async function start(canvas, opts) {
    if (running) return; cv = canvas; ctx = cv.getContext("2d"); baseUrl = (opts && opts.base) || baseUrl;
    if (!ocean) ocean = await load(baseUrl + "ocean.webp");
    if (!sprites.size) await Promise.all(FISH.map(async ([id]) => { const i = await load(baseUrl + "fish/" + id + ".webp"); if (i) sprites.set(id, i); }));
    resize(); window.addEventListener("resize", resize);
    if (!swimmers.length) swimmers = FISH.map(([id, size], i) => ({ id, size, x: W * (0.1 + Math.random() * 0.8), y: swimTop() + Math.random() * (swimBottom() - swimTop()), vx: 0, vy: 0, tx: 0, ty: 0, facing: i % 2 ? 1 : -1, phase: Math.random() * 6, tail: Math.random() * 6, fin: Math.random() * 6, burst: 0, gulp: 0, chasing: false, speed: 0.8 + Math.random() * 0.4 })).map((s) => (pick(s), s));
    running = true; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); }
  window.Aqua = { start, stop, get running() { return running; }, get count() { return swimmers.length; }, get loaded() { return sprites.size; } };
})();
