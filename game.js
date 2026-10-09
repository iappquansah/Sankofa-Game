// ===== SANKOFA SANCTUARY: GAME LOGIC =====
const $ = id => document.getElementById(id);
let SIZE = 3, TOTAL = 9;

/* ---------- SAVE DATA ---------- */
const DEFAULT_SAVE = {
  streak: 0, bestStreak: 0, lastPlayed: null, restLeaves: 0,
  puzzleIndex: 0,      // total puzzles completed (drives order and the "deeper layer" cycle)
  sanctuary: [],       // reward indexes placed in the sanctuary
  journal: [],         // puzzle indexes restored at least once
  deep: [],            // puzzle indexes whose deeper fact is unlocked
  pb: {},              // personal best times (ms), key "puzzleIndex-size"
  daily: null,         // today's best Daily Challenge result
  muted: false
};
function loadSave() {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  try {
    const raw = localStorage.getItem("sankofa-save");
    return raw ? { ...fresh, ...JSON.parse(raw) } : fresh;
  } catch (e) { return fresh; }
}
function writeSave() {
  try { localStorage.setItem("sankofa-save", JSON.stringify(save)); } catch (e) {}
}
let save = loadSave();

/* ---------- DATES (calendar dates, not 24h math) ---------- */
let debugDate = null;
function nowDate() {
  if (debugDate) { const [y, m, d] = debugDate.split("-").map(Number); return new Date(y, m - 1, d); }
  return new Date();
}
function todayStr() {
  const d = nowDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function addDays(str, n) {
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
const doneToday = () => save.lastPlayed === todayStr();

/* ---------- STREAK ---------- */
function updateStreak() {
  const today = todayStr();
  if (save.lastPlayed === today) return;
  if (save.lastPlayed === null) {
    save.streak = 1;
  } else {
    const missed = daysBetween(save.lastPlayed, today) - 1;
    if (missed <= 0) save.streak += 1;
    else if (missed <= save.restLeaves) { save.restLeaves -= missed; save.streak += 1; }
    else save.streak = 1;                      // gentle reset, nothing is deleted
  }
  if (save.streak % 7 === 0 && save.restLeaves < 2) save.restLeaves += 1;
  save.bestStreak = Math.max(save.bestStreak, save.streak);
  save.lastPlayed = today;
}
// How many days were missed since last play (0 if none)
function missedDays() {
  if (!save.lastPlayed) return 0;
  return Math.max(0, daysBetween(save.lastPlayed, todayStr()) - 1);
}

/* ---------- AUDIO (sound effects are generated, no files needed) ---------- */
let audioCtx;
function tone(freq, dur, vol = 0.15, delay = 0) {
  if (save.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    const t = audioCtx.currentTime + delay;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) {}
}
const sfx = {
  tap: () => tone(520, 0.12),
  swap: () => { tone(392, 0.15); tone(523, 0.15, 0.12, 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.7, 0.15, i * 0.16))
};
// Generative calm music: soft pentatonic notes, no audio file needed
const PENTA = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
let musicTimer = null;
function startAmbient() {
  if (save.muted || musicTimer) return;
  const play = () => {
    tone(PENTA[Math.floor(Math.random() * PENTA.length)] / (Math.random() < 0.3 ? 2 : 1), 2.6, 0.05);
    musicTimer = setTimeout(play, 1200 + Math.random() * 2200);
  };
  play();
}
function stopAmbient() { clearTimeout(musicTimer); musicTimer = null; }
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

function updateMuteLabel() { $("muteBtn").classList.toggle("off", save.muted); }
$("muteBtn").onclick = () => {
  save.muted = !save.muted; writeSave(); updateMuteLabel();
  if (save.muted) stopAmbient(); else startAmbient();
};

/* ---------- SCREENS ---------- */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.body.dataset.screen = id;
  document.body.classList.toggle("nonav", !["home", "exploreScreen", "journalScreen", "raceMenu"].includes(id));
  window.scrollTo(0, 0);
  if (id === "home") applyScroll();
}
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---------- HOME ---------- */
/* ---------- SANCTUARY ENGINE: layered, scrollable diorama ---------- */
const SPR = "images/sanctuary/", WORLD = 2000, ZSTEP = 205, ZX0 = 110;
const ZONE_FILE = { history: "zone-history", culture: "zone-culture", nature: "zone-nature", tourism: "zone-landmarks", sports: "zone-sports", cars: "zone-cars", space: "zone-space", food: "zone-food", architecture: "zone-architecture" };
const PLANTS = [["baobab", "Baobab"], ["oil-palm", "Oil Palm"], ["mango-tree", "Mango Tree"], ["cocoa-plant", "Cocoa Tree"], ["bush", "Bush"], ["hibiscus", "Hibiscus"], ["flowers", "Wildflowers"], ["grass", "Tall Grass"]];
const PLANT_W = { "baobab-1": 50, "baobab-2": 90, "baobab-3": 140, "oil-palm": 90, "mango-tree": 100, "cocoa-plant": 70, bush: 62, hibiscus: 50, flowers: 42, grass: 38 };
const ANIMALS = [
  { f: "butterfly", n: "Butterfly", fly: 1 }, { f: "hornbill", n: "Hornbill", fly: 1 }, { f: "tortoise", n: "Tortoise" },
  { f: "grey-parrot", n: "Grey Parrot", fly: 1 }, { f: "antelope", n: "Antelope" }, { f: "monkey", n: "Mona Monkey" },
  { f: "elephant", n: "Elephant" }, { f: "fruit-bat", n: "Fruit Bat", fly: 1 }, { f: "toucan", n: "Toucan", fly: 1 }, { f: "zebra", n: "Zebra" }
];
const THEMES = {
  dawn: { sky: ["#f7c59f", "#ffe9bf"], far: "#c98b8b", mid: "#8d7a6b", gnd: ["#6aa04f", "#4a7c3a"], low: true },
  day: { sky: ["#79c2e8", "#d6f1fc"], far: "#86b9b4", mid: "#5e9c6a", gnd: ["#5fae4f", "#3b7d3a"] },
  evening: { sky: ["#e8765a", "#f6c27b"], far: "#9a5a7a", mid: "#6a4f6f", gnd: ["#4f8a45", "#2f5f35"], low: true },
  night: { sky: ["#14102b", "#2b2158"], far: "#2d2b5a", mid: "#1f3a45", gnd: ["#2a5a3f", "#173a2c"], night: true }
};
const themeNow = () => { const h = new Date().getHours(); return h < 5 || h >= 20 ? "night" : h < 8 ? "dawn" : h < 16 ? "day" : "evening"; };
const levelName = n => n < 5 ? "Seed" : n < 15 ? "Grove" : n < 30 ? "Haven" : "Sanctuary";
const packTotal = id => PUZZLES.filter(p => p.cat === id).length;
const packDone = id => save.journal.filter(i => PUZZLES[i] && PUZZLES[i].cat === id).length;
let lastScroll = null, lastN = -1, pendingScroll = 0;

function hillPath(base, amp, f1, f2, ph) {
  let d = `M0,200 L0,${base}`;
  for (let x = 0; x <= 2000; x += 25) d += ` L${x},${(base + amp * Math.sin(x * f1 + ph) + amp * 0.5 * Math.sin(x * f2 + ph * 2)).toFixed(1)}`;
  return d + " L2000,200 Z";
}
// A picture that falls back to a drawn shape (or nothing) if the file is missing
function sprite(file, w, fb) {
  const img = new Image();
  img.src = SPR + file + ".webp"; img.draggable = false; img.style.width = w + "px";
  img.onerror = () => { const r = fb ? fb() : null; r ? img.replaceWith(r) : img.remove(); };
  return img;
}
function treeFB(w) {
  const s = document.createElement("span");
  s.innerHTML = `<svg width="${w}" viewBox="0 0 40 50"><rect x="18" y="28" width="4" height="22" fill="#6b4a2f"/><circle cx="20" cy="20" r="16" fill="#4fbf7a"/><circle cx="14" cy="24" r="9" fill="#3ea565"/></svg>`;
  return s;
}
function sanctuaryGain(i, pidx) {
  const item = i % 3 === 2 ? ANIMALS[Math.floor(i / 3) % ANIMALS.length].n : PLANTS[(i - Math.floor((i + 1) / 3)) % PLANTS.length][1];
  const c = CATEGORIES.find(x => x.id === PUZZLES[pidx].cat);
  return `${item} · ${c.name} zone ${packDone(c.id)} of ${packTotal(c.id)}`;
}
function zoneTap(c, done, tot) {
  if (!done) return toast(`Solve a ${c.name} puzzle to start building here`);
  const mine = save.journal.filter(i => PUZZLES[i] && PUZZLES[i].cat === c.id);
  showCard(mine[mine.length - 1], false, null, "home", true);
  $("cardReward").textContent = `${c.name} zone: ${done} of ${tot} restored`;
}
function parallax() {
  const sc = $("scene").querySelector(".scroller"); if (!sc) return;
  $("scene").querySelectorAll(".hl").forEach(h => h.style.transform = `translateX(${-sc.scrollLeft * +h.dataset.f}px)`);
}
// function applyScroll() {
//   const sc = $("scene").querySelector(".scroller"); if (!sc) return;
//   sc.scrollLeft = pendingScroll; parallax();
// }

// function renderSanctuary(quiet) {
//   const scene = $("scene"), T = THEMES[themeNow()], n = save.sanctuary.length;
//   if (n !== lastN) { lastScroll = null; lastN = n; }           // recentre when something new is built
//   scene.classList.toggle("quiet", quiet);
//   scene.classList.toggle("night", !!T.night);
//   scene.style.background = `linear-gradient(${T.sky[0]}, ${T.sky[1]})`;

//   let sky = `<div class="orb${T.night ? " moon" : ""}${T.low ? " low" : ""}"></div>`;
//   if (T.night) for (let k = 0; k < 26; k++) sky += `<b class="star" style="left:${(k * 37) % 100}%;top:${(k * 53) % 55}%;animation-delay:${(k % 5) * 0.6}s"></b>`;
//   else for (let k = 0; k < 3; k++) sky += `<i class="cld" style="top:${8 + k * 11}%;animation-delay:${-k * 14}s"></i>`;
//   scene.innerHTML = `<div class="sky">${sky}</div>
//     <svg class="hl" data-f=".25" viewBox="0 0 2000 200" preserveAspectRatio="none"><path d="${hillPath(120, 22, 0.006, 0.017, 1)}" fill="${T.far}"/></svg>
//     <svg class="hl hl2" data-f=".55" viewBox="0 0 2000 200" preserveAspectRatio="none"><path d="${hillPath(135, 26, 0.009, 0.021, 3)}" fill="${T.mid}"/></svg>
//     <div class="scroller"><div class="world" style="width:${WORLD}px"><div class="gnd" style="background:linear-gradient(${T.gnd[0]},${T.gnd[1]})"></div></div></div>
//     <div class="lvl">${levelName(n)}</div>`;
//   const world = scene.querySelector(".world"), sc = scene.querySelector(".scroller");

//   // streak lanterns on a rope (green ones are Rest Leaves)
//   const L = Math.min(save.streak, 14), lv = Math.min(save.restLeaves, 2);
//   if (L + lv) {
//     let rope = "", lan = "";
//     for (let k = 0; k < L + lv; k++) {
//       const x = 40 + k * 140;
//       rope += `M${x},2 Q${x + 70},28 ${x + 140},2 `;
//       lan += `<i class="lan${k >= L ? " leaf" : ""}" style="left:${x + 140}px"></i>`;
//     }
//     world.insertAdjacentHTML("beforeend", `<svg class="rope" width="${WORLD}" height="34"><path d="${rope}" fill="none" stroke="rgba(255,244,224,.45)" stroke-width="1.5"/></svg>${lan}`);
//   }
//   if (T.night) for (let k = 0; k < 7; k++) world.insertAdjacentHTML("beforeend", `<i class="fly" style="left:${(k * 331) % 1900}px;top:${40 + (k * 17) % 35}%;animation-delay:${k * 0.5}s"></i>`);

//   // zones: one landmark per pack that builds up as you solve its puzzles
//   CATEGORIES.forEach((c, k) => {
//     const tot = packTotal(c.id); if (!tot) return;
//     const done = packDone(c.id), s = done >= tot ? 4 : done >= tot * 0.6 ? 3 : done >= tot * 0.35 ? 2 : done ? 1 : 0;
//     const z = document.createElement("div");
//     z.className = "zone s" + s; z.style.left = (ZX0 + k * ZSTEP) + "px";
//     if (s) z.appendChild(sprite(ZONE_FILE[c.id], 150, () => { const f = document.createElement("div"); f.className = "zoneFB"; f.textContent = c.name; return f; }));
//     else z.innerHTML = '<div class="plot"></div>';
//     z.insertAdjacentHTML("beforeend", `<span class="zname">${c.name}</span>`);
//     z.onclick = () => zoneTap(c, done, tot);
//     world.appendChild(z);
//   });

//   // plants and animals: every third puzzle brings an animal, the rest plant something
//   for (let i = Math.max(0, n - 40); i < n; i++) {
//     const age = n - 1 - i, b = 4 + (i * 37) % 15, box = document.createElement("div");
//     if (i % 3 === 2) {
//       const a = ANIMALS[Math.floor(i / 3) % ANIMALS.length];
//       box.className = "prop " + (a.fly ? "flyer" : "walker");
//       box.style.animationDuration = (a.fly ? 5 + i % 4 : 38 + i % 17) + "s";
//       if (a.fly) box.style.top = (14 + (i * 23) % 30) + "%"; else box.style.bottom = b + "%";
//       box.appendChild(sprite(a.f, a.fly ? 54 : 78, null));
//       box.onclick = ev => {
//         ev.stopPropagation(); toast(a.n); tone(520 + (i % 5) * 60, 0.12, 0.08);
//         box.classList.remove("hop"); void box.offsetWidth; box.classList.add("hop");
//       };
//     } else {
//       const p = PLANTS[(i - Math.floor((i + 1) / 3)) % PLANTS.length];
//       const file = p[0] === "baobab" ? (age < 3 ? "baobab-1" : age < 8 ? "baobab-2" : "baobab-3") : p[0];
//       box.className = "prop plant"; box.style.bottom = b + "%";
//       box.appendChild(sprite(file, PLANT_W[file], () => treeFB(PLANT_W[file])));
//       box.onclick = ev => { ev.stopPropagation(); toast(p[1]); };
//     }
//     box.style.left = (50 + (i * 211) % (WORLD - 140)) + "px"; box.style.zIndex = 30 - Math.round(b);
//     if (i === n - 1) box.classList.add("newest");
//     world.appendChild(box);
//   }

//   sc.onscroll = () => { lastScroll = sc.scrollLeft; parallax(); };
//   const last = save.journal.length ? PUZZLES[save.journal[save.journal.length - 1]] : null;
//   const ki = Math.max(0, CATEGORIES.findIndex(c => last && c.id === last.cat));
//   pendingScroll = lastScroll != null ? lastScroll : Math.max(0, ZX0 + ki * ZSTEP - (sc.clientWidth || 360) / 2);
//   applyScroll();
// }

/* ---------- SANCTUARY AS A VERTICAL CLIMB ---------- */
let climbTop = null, climbN = -1, climbFocus = null, climbIO = null;
let calib = false, calibPts = {};
const tierStage = (done, tot) => done >= tot ? 4 : done >= tot * 0.6 ? 3 : done >= tot * 0.35 ? 2 : done ? 1 : 0;
let lastSig = "";

// Optional zone artwork: removed automatically if the file doesn't exist
// function mapLayer(file, cls, onLoad) {
//   const img = new Image();
//   img.className = cls; img.alt = ""; img.draggable = false;
//   img.onload = () => onLoad && onLoad();
//   img.onerror = () => img.remove();
//   img.src = SPR + file + ".webp";
//   return img;
// }
// Zone artwork: created once, decoded once, then reused on every re-render
const layerCache = {};
function mapLayer(file, cls) {
  const key = file + "|" + cls;
  if (key in layerCache) return layerCache[key] || document.createComment("");
  const img = new Image();
  img.className = cls; img.alt = ""; img.draggable = false;
  img.decoding = "sync";
  img.onerror = () => { img.remove(); layerCache[key] = null; };
  img.src = SPR + file + ".webp";
  layerCache[key] = img;
  return img;
}

// Smooth S-curve through the node points
function smoothPath(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
    d += ` C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
  }
  return d;
}

// Node positions: custom per zone if provided, otherwise a zigzag
// function zonePositions(id, tot) {
//   const custom = ZONE_PATHS[id];
//   if (custom && custom.length >= tot) return custom.slice(0, tot);
//   return Array.from({ length: tot }, (_, j) => ({
//     x: j % 2 ? 70 : 30,
//     y: tot === 1 ? 50 : 76 - j * (50 / (tot - 1))
//   }));
// }

// Node positions: custom per zone if provided, otherwise a winding road.
// Returns percentages inside the zone, plus the zone height in px.
const NODE_STEP = 84;
function zonePositions(id, tot, k) {
  const H = Math.max(300, (tot - 1) * NODE_STEP + 112);
  const custom = ZONE_PATHS[id];
  if (custom && custom.length >= tot) return { H, pos: custom.slice(0, tot) };
  const pos = Array.from({ length: tot }, (_, j) => ({
    x: +Math.min(80, Math.max(20, 50 + 24 * Math.sin(j * 1.05 + k * 1.9) + 10 * Math.sin(j * 2.7 + k * 0.8))).toFixed(1),
    y: +((H / 2 + ((tot - 1) / 2 - j) * NODE_STEP) / H * 100).toFixed(1)
  }));
  return { H, pos };
}

function applyScroll() {
  const wrap = $("scene").querySelector(".climb"); if (!wrap) return;
  if (climbTop != null) wrap.scrollTop = climbTop;
  else {
    const t = wrap.querySelector(`[data-cat="${climbFocus}"]`);
    if (t) wrap.scrollTop = t.offsetTop;
  }
}

const ZONE_BG = { culture:"#8a3a6e", history:"#b4502a", nature:"#2f8a52", tourism:"#3a86c0", sports:"#c9662a", cars:"#5a4a66", space:"#1c1640", food:"#d0782a", architecture:"#4a3670" };

// ---------- Generated scenery (replaced automatically by map-<zone>.webp art if present) ----------
const ZONE_KIND = { culture:"acacia", history:"acacia", nature:"trees", tourism:"trees", sports:"city", cars:"city", space:"stars", food:"trees", architecture:"city" };
const KIND_GROUND = { trees:"#2f6b3a", acacia:"#8a7a3a", city:"#1f2540", stars:"#1c1640" };

function scenery(id, H, k) {
  const W = 400, rnd = mulberry32(hashStr("scn-" + id)), base = ZONE_BG[id], kind = ZONE_KIND[id] || "trees";
  const cm = (a, p, b) => `color-mix(in srgb, ${a} ${p}%, ${b})`;
  const hill = (y0, amp, f) => {
    const ph = rnd() * 6, y = x => y0 + amp * Math.sin(x * f + ph) + amp * .45 * Math.sin(x * f * 2.3 + ph * 1.7);
    let d = `M0,${H} L0,${y(0).toFixed(1)}`;
    for (let x = 10; x <= W; x += 10) d += ` L${x},${y(x).toFixed(1)}`;
    return { d: d + ` L${W},${H} Z`, y };
  };
  let s = `<defs>
    <radialGradient id="sg${id}" cx="${(.25 + rnd() * .5).toFixed(2)}" cy=".26" r=".6"><stop offset="0" stop-color="#fff3c4" stop-opacity=".6"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
    <linearGradient id="hz${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffecd2" stop-opacity="0"/><stop offset=".6" stop-color="#ffecd2" stop-opacity=".22"/><stop offset="1" stop-color="#ffecd2" stop-opacity="0"/></linearGradient>
    <radialGradient id="pl${id}" cx=".35" cy=".3"><stop offset="0" stop-color="#e3d9ff"/><stop offset="1" stop-color="#3a2a7a"/></radialGradient>
  </defs>`;

  if (kind === "stars") {
    s += `<rect width="${W}" height="${H}" fill="url(#sg${id})" opacity=".5"/>`;
    for (let i = 0; i < 80; i++) s += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${(rnd() * 1.3 + .3).toFixed(1)}" fill="#fff" opacity="${(.3 + rnd() * .7).toFixed(2)}"/>`;
    const px = 90 + rnd() * 220, py = H * .32;
    s += `<circle cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" r="34" fill="url(#pl${id})"/>
      <ellipse cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" rx="62" ry="12" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="3" transform="rotate(-18 ${px.toFixed(0)} ${py.toFixed(0)})"/>
      <circle cx="${(W - px).toFixed(0)}" cy="${(H * .7).toFixed(0)}" r="14" fill="url(#pl${id})" opacity=".8"/>`;
    return `<svg class="scenery" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s}</svg>`;
  }

  const g = KIND_GROUND[kind];
  const far = hill(H * .40, 12, .02), mid = hill(H * .56, 16, .025), near = hill(H * .76, 12, .035);
  s += `<rect width="${W}" height="${H}" fill="url(#sg${id})"/>`;
  s += `<path d="${far.d}" style="fill:${cm(base, 60, "#ffe6c4")}"/>`;

  if (kind === "city") {                               // skyline standing on the far ridge
    for (let x = -6; x < W; x += 20 + rnd() * 18) {
      const w = 14 + rnd() * 14, h = 30 + rnd() * 80, y = far.y(x) - h + 10;
      s += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" style="fill:${cm(base, 30, "#0e0a1c")}"/>`;
      for (let n = 0; n < 5; n++) s += `<rect x="${(x + 3 + rnd() * (w - 8)).toFixed(0)}" y="${(y + 6 + rnd() * (h - 12)).toFixed(0)}" width="2" height="3" fill="#ffd36a" opacity="${(.4 + rnd() * .5).toFixed(2)}"/>`;
    }
  }
  s += `<rect y="${(H * .34).toFixed(0)}" width="${W}" height="${(H * .22).toFixed(0)}" fill="url(#hz${id})"/>`;   // atmospheric haze
  s += `<path d="${mid.d}" style="fill:${cm(cm(g, 55, base), 82, "#10091e")}"/>`;

  for (let i = 0; i < 10; i++) {                       // trees on the middle ridge
    const x = rnd() * W, y = mid.y(x) + 2, z = 9 + rnd() * 11, tc = cm(g, 60, "#0b1a10");
    if (kind === "acacia") s += `<path d="M${x.toFixed(0)},${y.toFixed(0)} l1,${-z} l-3,-4 M${x.toFixed(0)},${(y - z).toFixed(0)} l4,-4" stroke="#2a1a10" stroke-width="1.6" fill="none"/><ellipse cx="${x.toFixed(0)}" cy="${(y - z - 4).toFixed(0)}" rx="${(z * 1.1).toFixed(0)}" ry="${(z * .35).toFixed(0)}" style="fill:${tc}"/>`;
    else if (kind === "trees") s += `<rect x="${(x - 1).toFixed(0)}" y="${(y - z * .6).toFixed(0)}" width="2" height="${(z * .7).toFixed(0)}" fill="#2a1a10"/><circle cx="${x.toFixed(0)}" cy="${(y - z).toFixed(0)}" r="${(z * .6).toFixed(0)}" style="fill:${tc}"/><circle cx="${(x - z * .35).toFixed(0)}" cy="${(y - z * .7).toFixed(0)}" r="${(z * .45).toFixed(0)}" style="fill:${tc}"/><circle cx="${(x + z * .4).toFixed(0)}" cy="${(y - z * .75).toFixed(0)}" r="${(z * .45).toFixed(0)}" style="fill:${tc}"/>`;
  }
  s += `<path d="${near.d}" style="fill:${cm(g, 82, "#10091e")}"/>`;
  for (let i = 0; i < 26; i++) {                        // grass tufts
    const x = rnd() * W, y = near.y(x) + 4 + rnd() * (H * .2);
    s += `<path d="M${x.toFixed(0)},${y.toFixed(0)} l-2,-7 M${x.toFixed(0)},${y.toFixed(0)} l0,-9 M${x.toFixed(0)},${y.toFixed(0)} l2,-7" stroke="${cm(g, 55, "#a8d878")}" stroke-width="1.2" fill="none" opacity=".6"/>`;
  }
  return `<svg class="scenery" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s}</svg>`;
}
// Bottom sheet for stops you haven't restored yet
function openSheet(o, c, state) {
  const img = $("sheetImg"), btn = $("sheetBtn");
  $("sheet").dataset.state = state;
  $("sheet").className = "category-" + c.id;
  img.style.backgroundImage = `url(${o.p.image})`;
  $("sheetKicker").textContent = c.name;

  if (state === "current") {
    $("sheetTitle").textContent = o.p.name;
    $("sheetText").textContent = "Rebuild the picture to unlock its story.";
    if (doneToday()) {
      btn.textContent = "Come back tomorrow"; btn.disabled = true; btn.onclick = null;
    } else {
      btn.textContent = "Play"; btn.disabled = false;
      btn.onclick = () => { closeSheet(); startAmbient(); startPuzzle(); };
    }
  } else {
    $("sheetTitle").textContent = "???";
    $("sheetText").textContent = "Keep your daily streak going to reach this stop.";
    btn.textContent = "Got it"; btn.disabled = false; btn.onclick = closeSheet;
  }
  $("sheet").classList.remove("hidden");
}
function closeSheet() { $("sheet").classList.add("hidden"); }
$("sheet").onclick = e => { if (e.target === $("sheet")) closeSheet(); };

function renderSanctuary(quiet) {
    const sig = [save.puzzleIndex, save.journal.length, save.sanctuary.length, doneToday(), quiet].join("|");
  if (sig === lastSig && $("scene").querySelector(".climb")) return;   // nothing changed, leave the map alone
  lastSig = sig;
  const scene = $("scene"), n = save.sanctuary.length;
  const cur = save.puzzleIndex % PUZZLES.length, today = doneToday();
  if (n !== climbN) { climbTop = null; climbN = n; }          // recentre when something new is built

  scene.removeAttribute("style");
  scene.className = "climbScene" + (quiet ? " quiet" : "");
  // scene.innerHTML = '<div class="climb"></div><nav class="rail" aria-label="Sanctuary zones"></nav>';
  // const wrap = scene.querySelector(".climb"), rail = scene.querySelector(".rail");
  //   scene.innerHTML = '<div class="climb"></div><div class="zoneHud"><span class="zIcon"></span><b></b><em></em><i class="zBar"><u></u></i></div>';
  // const wrap = scene.querySelector(".climb"), hud = scene.querySelector(".zoneHud");

    scene.innerHTML = '<div class="climb"></div>';
  const wrap = scene.querySelector(".climb");
  const zoneList = [...CATEGORIES].reverse().filter(x => packTotal(x.id));
  const lastP = save.journal.length ? PUZZLES[save.journal[save.journal.length - 1]] : null;
  climbFocus = today && lastP ? lastP.cat : PUZZLES[cur].cat;

  // reversed: first zone at the bottom, you climb upward
  [...CATEGORIES].reverse().forEach(c => {
    const list = PUZZLES.map((p, i) => ({ p, i })).filter(o => o.p.cat === c.id);
    if (!list.length) return;
    const k = CATEGORIES.indexOf(c), tot = list.length, done = packDone(c.id);
    const hasCur = list.some(o => o.i === cur), stage = tierStage(done, tot), open = done || hasCur;

    const tier = document.createElement("section");
    tier.className = `tier category-${c.id} s${stage}` + (open ? "" : " locked") + (done >= tot ? " complete" : "");
    tier.dataset.cat = c.id;

        const ri = zoneList.indexOf(c), me = ZONE_BG[c.id];
    const up = ZONE_BG[(zoneList[ri - 1] || c).id], dn = ZONE_BG[(zoneList[ri + 1] || c).id];
    tier.style.background = `linear-gradient(180deg, color-mix(in srgb, ${up}, ${me}) 0%, ${me} 28%, ${me} 72%, color-mix(in srgb, ${me}, ${dn}) 100%)`;
    // Object.assign(tier.dataset, { name: c.name, done, tot, file: ZONE_FILE[c.id] });

    // calibration: tap along your artwork to record node positions
    tier.addEventListener("click", e => {
      if (!calib) return;
      const r = tier.getBoundingClientRect();
      const pt = { x: +((e.clientX - r.left) / r.width * 100).toFixed(1), y: +((e.clientY - r.top) / r.height * 100).toFixed(1) };
      (calibPts[c.id] = calibPts[c.id] || []).push(pt);
      const line = `${c.id}: ${JSON.stringify(calibPts[c.id]).replace(/"/g, "")},`;
      console.log(line);
      try { navigator.clipboard.writeText(line); } catch (err) {}
      toast(`${c.name}: point ${calibPts[c.id].length}`);
    });

    // optional illustrated terrain (map-<zone>.webp)
    // tier.appendChild(mapLayer("map-" + c.id, "terrain"));
        // tier.appendChild(mapLayer("map-" + c.id, "terrain", () => tier.classList.add("hasPath")));
        //     // optional illustrated terrain (map-<zone>.webp)
    tier.appendChild(mapLayer("map-" + c.id, "terrain"));

    // // header
    // const head = document.createElement("header"); head.className = "tierHead";
    // head.appendChild(sprite(ZONE_FILE[c.id], 34, null));
    // head.insertAdjacentHTML("beforeend",
    //   `<h3>${c.name}</h3><span class="cnt">${done}/${tot}</span>` + (done >= tot ? '<span class="crest">Restored</span>' : ""));
    // tier.appendChild(head);
    // tier.insertAdjacentHTML("beforeend", `<div class="tierBar"><i style="width:${Math.round(done / tot * 100)}%"></i></div>`);

    // // landmark: stands behind the path and grows with every puzzle restored
    // const lm = document.createElement("div"); lm.className = "landmark";
    // if (stage) lm.appendChild(sprite(ZONE_FILE[c.id], 230, () => { const f = document.createElement("div"); f.className = "zoneFB"; f.textContent = c.name; return f; }));
    // else lm.innerHTML = '<div class="plot">Ready to build</div>';
    // lm.onclick = () => zoneTap(c, done, tot);
    // tier.appendChild(lm);

    // path: dotted fallback line, replaced by illustrated path art (path-<zone>.webp) if it exists
    // const pos = zonePositions(c.id, tot);
    // tier.insertAdjacentHTML("beforeend",
    //   `<svg class="trail" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${smoothPath(pos)}"/></svg>`);
        const { H, pos } = zonePositions(c.id, tot, k);
    tier.style.height = H + "px"; tier.style.minHeight = "0";
        // tier.insertAdjacentHTML("afterbegin", scenery(c.id, H, k));
    // the road enters and leaves every zone at the centre, so zones join into one road
    const d = smoothPath([{ x: 50, y: 101 }, ...pos, { x: 50, y: -1 }]);
    // tier.insertAdjacentHTML("beforeend",
    //   `<svg class="trail" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="roadBed" d="${d}"/><path d="${d}"/></svg>`);
        tier.insertAdjacentHTML("beforeend",
      `<svg class="trail" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="rShade" d="${d}"/><path class="rEdge" d="${d}"/><path class="rSurf" d="${d}"/><path class="rLine" d="${d}"/></svg>`);
    tier.appendChild(mapLayer("path-" + c.id, "pathArt", () => tier.classList.add("hasPath")));

    // sanctuary life: each restored puzzle in this zone adds a plant, every third an animal
    const doneList = list.filter(o => save.journal.includes(o.i));
    doneList.forEach((o, j) => {
      const el = document.createElement("div");
      if (j % 3 === 2) {
        const a = ANIMALS[(k + j) % ANIMALS.length];
        el.className = "prop2 " + (a.fly ? "flyer2" : "walker2");
        // if (a.fly) el.style.top = (18 + (j * 13) % 14) + "%"; else el.style.bottom = (1 + (j * 5 + k) % 6) + "%";
        if (a.fly) el.style.top = (8 + (j * 29 + k * 7) % 80) + "%"; else el.style.bottom = (4 + (j * 37 + k * 11) % 88) + "%";
        el.appendChild(sprite(a.f, a.fly ? 40 : 58, null));
        el.onclick = ev => { ev.stopPropagation(); toast(a.n); tone(520 + (j % 5) * 60, 0.12, 0.08); };
      } else {
        const p = PLANTS[(k + j) % PLANTS.length];
        const file = p[0] === "baobab" ? "baobab-2" : p[0], w = Math.round(PLANT_W[file] * 0.75);
        // el.className = "prop2 plant2"; el.style.bottom = (1 + (j * 5 + k) % 6) + "%";
        el.className = "prop2 plant2"; el.style.bottom = (4 + (j * 37 + k * 11) % 88) + "%";
        el.appendChild(sprite(file, w, () => treeFB(w)));
        el.onclick = ev => { ev.stopPropagation(); toast(p[1]); };
      }
      el.style.left = (6 + (j * 31 + k * 17) % 84) + "%";
      if (lastP && lastP.cat === c.id && j === doneList.length - 1) el.classList.add("newest");
      tier.appendChild(el);
    });

    // puzzle nodes
    list.forEach((o, j) => {
      const state = save.journal.includes(o.i) ? "done" : (o.i === cur ? "current" : "locked");
      const node = document.createElement("button");
      node.className = "node " + state;
      node.style.left = pos[j].x + "%"; node.style.top = pos[j].y + "%";
      node.setAttribute("aria-label", state === "locked" ? `${c.name} puzzle, locked` : o.p.name);
      const pin = document.createElement("div"); pin.className = "pin";
      pin.appendChild(sprite("zone-map", 20, () => { const s = document.createElement("span"); s.textContent = "📍"; return s; }));
      const card = document.createElement("div"); card.className = "nCard";
      if (state !== "locked") card.style.backgroundImage = `url(${o.p.image})`;
      const nm = document.createElement("span"); nm.className = "nName";
      nm.textContent = state === "locked" ? "???" : o.p.name;
      node.append(pin, card, nm);
      // node.onclick = () => {
      //   if (state === "done") showCard(o.i, false, null, "home", save.deep.includes(o.i));
      //   else if (state === "current") {
      //     if (doneToday()) toast("Today's puzzle is done. Come back tomorrow");
      //     else { startAmbient(); startPuzzle(); }
      //   } else toast("Keep your daily streak going to reach this puzzle");
      // };
            node.onclick = () => {
        if (state === "done") showCard(o.i, false, null, "home", save.deep.includes(o.i));
        else openSheet(o, c, state);
      };
      tier.appendChild(node);
    });

    wrap.appendChild(tier);
    // rail.insertAdjacentHTML("beforeend", `<i data-cat="${c.id}" class="${done >= tot ? "full" : done ? "part" : ""}" title="${c.name}"></i>`);
  });

  // // side rail: tap a dot to jump, active dot follows the tier in view
  // rail.querySelectorAll("i").forEach(d => d.onclick = () => {
  //   const t = wrap.querySelector(`[data-cat="${d.dataset.cat}"]`);
  //   if (t) wrap.scrollTo({ top: t.offsetTop, behavior: "smooth" });
  // });
  // if (climbIO) climbIO.disconnect();
  // climbIO = new IntersectionObserver(es => es.forEach(e => {
  //   if (e.isIntersecting) rail.querySelectorAll("i").forEach(d => d.classList.toggle("on", d.dataset.cat === e.target.dataset.cat));
  // }), { root: wrap, threshold: 0.6 });
  // wrap.querySelectorAll(".tier").forEach(t => climbIO.observe(t));

  // wrap.onscroll = () => { climbTop = wrap.scrollTop; };
  // applyScroll();
  //   const updateHud = () => {
  //   const mid = wrap.scrollTop + wrap.clientHeight / 2;
  //   const t = [...wrap.children].find(x => x.offsetTop + x.offsetHeight > mid) || wrap.lastElementChild;
  //   if (!t || hud.dataset.cat === t.dataset.cat) return;
  //   hud.dataset.cat = t.dataset.cat;
  //   hud.querySelector("b").textContent = t.dataset.name;
  //   hud.querySelector("em").textContent = `${t.dataset.done}/${t.dataset.tot}`;
  //   hud.querySelector("u").style.width = Math.round(t.dataset.done / t.dataset.tot * 100) + "%";
  //   const ic = hud.querySelector(".zIcon"); ic.innerHTML = ""; ic.appendChild(sprite(t.dataset.file, 24, null));
  //   hud.classList.toggle("done", +t.dataset.done >= +t.dataset.tot);
  // };
//   wrap.onscroll = () => { climbTop = wrap.scrollTop; updateHud(); };
//   applyScroll(); updateHud();
// }
    wrap.onscroll = () => { climbTop = wrap.scrollTop; };
  applyScroll();
}


function renderWeek() {
  const t = todayStr(), row = $("weekRow");
  row.innerHTML = "";
  for (let k = 6; k >= 0; k--) {
    const day = addDays(t, -k);
    const off = save.lastPlayed ? daysBetween(day, save.lastPlayed) : -1;
    const done = off >= 0 && off < save.streak;
    const [y, m, d] = day.split("-").map(Number);
    row.insertAdjacentHTML("beforeend",
      `<div class="wd${done ? " done" : ""}${k === 0 ? " today" : ""}"><i></i><span>${"SMTWTFS"[new Date(y, m - 1, d).getDay()]}</span></div>`);
  }
}
function refreshHome() {
  const missed = missedDays(), broken = missed > save.restLeaves, done = doneToday();
  $("streakNum").textContent = save.streak;
  $("leafNum").textContent = save.restLeaves;
  $("leafChip").classList.toggle("hidden", save.restLeaves < 1);

  let pill = "";
  if (done) pill = "Done for today. See you tomorrow";
  else if (save.lastPlayed && broken) pill = "Welcome back. A new streak starts today";
  else if (missed > 0) pill = `A Rest Leaf covers your ${missed} missed day${missed > 1 ? "s" : ""}`;
  $("statePill").textContent = pill;
  $("statePill").classList.toggle("hidden", !pill);

  const c = save.puzzleIndex, pack = CATEGORIES.find(x => x.id === PUZZLES[c % PUZZLES.length].cat);
  $("beginBtn").textContent = done ? "Play again" : "Play today's puzzle";
  $("beginBtn").classList.toggle("secondary", done);
  // $("playSub").textContent = done ? "Just for calm. Your streak is safe"
  //   : `${pack ? pack.name : ""} · ${levelFor(c)[1]}×${levelFor(c)[1]} · ${twistFor(c).n}`;
    $("playSub").textContent = "";

  renderWeek();
  renderSanctuary(broken && !!save.lastPlayed && !done);
  $("dbgInfo").textContent = `date: ${todayStr()} · leaves: ${save.restLeaves}`;
  updateMuteLabel();
}

// Any photo or artwork works: it is centre-cropped to a square automatically
function squareImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(s, 900);
        const c = document.createElement("canvas"); c.width = c.height = out;
        c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, out, out);
        resolve(c.toDataURL("image/png"));
      } catch (e) { resolve(src); }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/* ---------- PUZZLE: classic sliding puzzle (one hidden tile, slide tiles into the gap) ---------- */
const board = $("board");
let puzzle, puzzleIdx = 0, counter = 0, replay = false, solved = false, twist = "Classic";
let order = [], lastMove = null, memTimer;

// ----- Seeded shuffles + Daily Challenge helpers -----
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Same puzzle, size and shuffle for everyone on the same calendar date
function dailyInfo() {
  const date = todayStr(), seed = hashStr("sankofa-" + date), dow = nowDate().getDay();
  return { date, idx: seed % PUZZLES.length, size: (dow === 0 || dow === 6) ? 4 : 3, seed };
}
const fmtTime = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
let startTime = 0, tick = null, dailyRun = false, lastShareText = "";

// Difficulty ladder: [from puzzle #, grid size, scramble moves]. Grows as you keep your habit.
const LEVELS = [[0, 3, 14], [2, 3, 30], [4, 3, 60], [7, 4, 50], [10, 4, 90], [14, 4, 140], [20, 5, 180]];
// A different twist every day, cycling.
const TWISTS = [
  { n: "Classic", d: "Slide tiles into the empty space to rebuild the picture." },
  { n: "Numbered", d: "Tiles carry numbers today, a little help." },
  { n: "Memory", d: "The goal picture fades after a few seconds. Tap Peek whenever you need it." },
  { n: "Pure", d: "No helpers today: no gold glow, no counter. Trust your eye." }
];
const levelFor = c => LEVELS.filter(l => c >= l[0]).pop();
const twistFor = c => TWISTS[c % TWISTS.length];
const challengeText = c => `${twistFor(c).n} · ${levelFor(c)[1]}×${levelFor(c)[1]}`;

const rowOf = p => Math.floor(p / SIZE), colOf = p => p % SIZE;
const adjacent = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1;
const neighbors = p => [...Array(TOTAL).keys()].filter(q => adjacent(p, q));
const correctCount = arr => arr.filter((v, i) => v === i).length;

// Scramble with real slides from the finished picture, so it is always solvable
function scramble(moves, rnd = Math.random) {
  let a;
  do {
    a = [...Array(TOTAL).keys()];
    let e = TOTAL - 1, prev = -1;
    for (let k = 0; k < moves; k++) {
      const nb = neighbors(e).filter(q => q !== prev), q = nb[Math.floor(rnd() * nb.length)];
      [a[e], a[q]] = [a[q], a[e]]; prev = e; e = q;
    }
  } while (correctCount(a) > TOTAL - 3);
  return a;
}
function setupMemory(on) {
  clearTimeout(memTimer); $("refImg").classList.remove("faded");
  $("peekBtn").classList.toggle("hidden", !on);
  if (on) memTimer = setTimeout(() => $("refImg").classList.add("faded"), 6000);
}
$("peekBtn").onclick = () => setupMemory(true) || ($("refImg").classList.remove("faded"), clearTimeout(memTimer),
  memTimer = setTimeout(() => $("refImg").classList.add("faded"), 2500));

let exploreMode = false;
async function startPuzzle(opts) {
  exploreMode = !!opts; dailyRun = !!(opts && opts.daily); clearInterval(tick);
  replay = exploreMode || doneToday();
  counter = exploreMode ? 99 : Math.max(0, replay ? save.puzzleIndex - 1 : save.puzzleIndex);
  puzzleIdx = exploreMode ? opts.idx : counter % PUZZLES.length; puzzle = PUZZLES[puzzleIdx];
  if (!puzzle.sq) puzzle.sq = await squareImage(puzzle.image);
  const [, size, moves] = exploreMode ? [0, opts.size, { 3: 40, 4: 90, 5: 180 }[opts.size]] : levelFor(counter),
    tw = exploreMode ? TWISTS[0] : twistFor(counter);
  SIZE = size; TOTAL = size * size; twist = tw.n;
  $("refImg").src = puzzle.sq || puzzle.image; $("refName").textContent = puzzle.name;
  order = scramble(moves, opts && opts.seed != null ? mulberry32(opts.seed) : Math.random); lastMove = null; solved = false;
  board.className = "";
  board.style.gridTemplateColumns = board.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;
  setupMemory(twist === "Memory");
  $("puzzleHint").textContent = "Breathe in… 🌬️";
  setTimeout(() => { if (!solved) $("puzzleHint").textContent = `Today: ${tw.n} (${SIZE}×${SIZE}). ${tw.d}`; }, 2500);
  renderBoard(); showScreen("puzzleScreen");
  startTime = Date.now();
  if (dailyRun) tick = setInterval(() => { if (!solved) $("puzzleHint").textContent = "Daily Challenge · " + fmtTime(Date.now() - startTime); }, 500);
}
function renderBoard() {
  board.innerHTML = "";
  board.classList.toggle("pure", twist === "Pure");

  board.style.setProperty('--puzzle-img', `url(${puzzle.sq || puzzle.image})`);

  const e = order.indexOf(TOTAL - 1);
  order.forEach((t, pos) => {
    const d = document.createElement("div");
    let c = "tile";
    if (t === TOTAL - 1 && !solved) c += " void";                    // the empty space
    else {
      if (t === pos && twist !== "Pure") c += " ok";                  // right place
      if (counter < 3 && !solved && adjacent(pos, e)) c += " near";   // early days: show which can move
      if (lastMove && lastMove.to === pos) c += " slide";
    }
    d.className = c;
    // d.style.backgroundImage = `url(${puzzle.sq || puzzle.image})`;
    d.style.backgroundSize = `${SIZE * 100}% ${SIZE * 100}%`;
    d.style.backgroundPosition = `${colOf(t) * 100 / (SIZE - 1)}% ${rowOf(t) * 100 / (SIZE - 1)}%`;
    if (twist === "Numbered" && !solved) d.textContent = t + 1;
    if (c.includes("slide")) { d.style.setProperty("--dx", lastMove.dx * 100 + "%"); d.style.setProperty("--dy", lastMove.dy * 100 + "%"); }
    d.onclick = () => onTileClick(pos);
    board.appendChild(d);
  });
  $("progress").textContent = twist === "Pure" ? "" :
    `${order.filter((v, i) => v === i && v !== TOTAL - 1).length} / ${TOTAL - 1} in place`;
}
function onTileClick(pos) {
  if (solved) return;
  const e = order.indexOf(TOTAL - 1);
  if (!adjacent(pos, e)) { sfx.tap(); return; }                       // only tiles touching the gap can slide
  [order[pos], order[e]] = [order[e], order[pos]];
  lastMove = { to: e, dx: colOf(pos) - colOf(e), dy: rowOf(pos) - rowOf(e) };
  sfx.swap(); buzz(12);
  renderBoard();
  if (window.raceActive) { raceMove(); return; }
  if (correctCount(order) === TOTAL) { lastMove = null; onWin(); }
}
$("backBtn").onclick = () => { clearTimeout(memTimer); clearInterval(tick); if (exploreMode) { renderExplore(); showScreen("exploreScreen"); } else { refreshHome(); showScreen("home"); } };

function confetti() {
  const em = ["✨", "🌟", "🌺", "🍃", "🟡"];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement("span");
    s.className = "confetti"; s.textContent = em[i % em.length];
    s.style.left = Math.random() * 100 + "vw"; s.style.animationDelay = Math.random() * 0.8 + "s";
    document.body.appendChild(s); setTimeout(() => s.remove(), 4000);
  }
}
function onWin() {
  solved = true;
  renderBoard(); board.classList.add("solved"); confetti();
  sfx.win(); buzz([30, 60, 30]);
  const cycle = Math.floor(counter / PUZZLES.length);
  let reward = null;
  if (!replay) {
    updateStreak();
    if (!save.journal.includes(puzzleIdx)) save.journal.push(puzzleIdx);
    if (cycle >= 1 && !save.deep.includes(puzzleIdx)) save.deep.push(puzzleIdx);
       save.sanctuary.push(puzzleIdx % REWARDS.length);
    reward = { name: sanctuaryGain(save.sanctuary.length - 1, puzzleIdx) };
    save.puzzleIndex++;
    writeSave();
  }
  let note = "";
  if (exploreMode) {
    const ms = Date.now() - startTime, key = puzzleIdx + "-" + SIZE, old = save.pb[key];
    clearInterval(tick);
    if (old == null || ms < old) save.pb[key] = ms;
    note = `Time ${fmtTime(ms)} · ` + (old == null ? "first clear" : ms < old ? "new best!" : "best " + fmtTime(old));
    lastShareText = "";
    if (dailyRun) {
      if (!save.daily || save.daily.date !== todayStr() || ms < save.daily.ms) save.daily = { date: todayStr(), ms, size: SIZE };
      lastShareText = `Sankofa Sanctuary Daily #${daysBetween("2026-10-01", todayStr()) + 1}\n${SIZE}×${SIZE} · ${fmtTime(ms)}\n${location.origin}${location.pathname}`;
    }
    writeSave();
  } else lastShareText = "";
  setTimeout(() => {
    exploreMode ? showCard(puzzleIdx, false, null, "explore", true) : showCard(puzzleIdx, cycle >= 1, reward, "home");
    if (note) $("cardReward").textContent = note;
  }, 1600);
}

/* ---------- HERITAGE CARD ---------- */
let cardReturn = "home", cardText = "", cardPuzzle = null;
function showCard(idx, deep, reward, returnTo, both) {
  const p = PUZZLES[idx];
  cardPuzzle = p; cardReturn = returnTo;
  cardText = both ? `${p.fact1} ${p.fact2}` : (deep ? p.fact2 : p.fact1);
  $("cardImg").src = p.image;
  $("cardTitle").textContent = p.name;
  $("cardFact").textContent = cardText;
  $("cardSource").textContent = p.visit ? "📍 " + p.visit : "";
 $("cardReward").textContent = reward ? "Your sanctuary grew: " + reward.name : "";
  $("card").classList.remove("hidden");
}
$("cardContinue").onclick = () => {
  $("card").classList.add("hidden");
  if (cardReturn === "explore") { renderExplore(); showScreen("exploreScreen"); }
  else if (cardReturn === "journal") { renderJournal(); showScreen("journalScreen"); }
  else { refreshHome(); showScreen("home"); }
};

/* ---------- SHARE CARD ---------- */
function wrapText(ctx, text, x, y, maxW, lineH) {
  let line = "";
  text.split(" ").forEach(word => {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = word + " "; y += lineH; }
    else line = test;
  });
  ctx.fillText(line, x, y);
}
$("shareBtn").onclick = async () => {
  if (lastShareText) {
    if (navigator.share) { try { await navigator.share({ text: lastShareText }); } catch (e) {} }
    else { try { await navigator.clipboard.writeText(lastShareText); toast("Result copied"); } catch (e) {} }
    return;
  }
  const img = new Image(); img.src = cardPuzzle.sq || await squareImage(cardPuzzle.image);
  try { await img.decode(); } catch (e) {}
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1400;
  const x = c.getContext("2d");
  x.fillStyle = "#2b3a2f"; x.fillRect(0, 0, 1080, 1400);
  x.drawImage(img, 90, 90, 900, 900);
  x.fillStyle = "#d9a441"; x.font = "bold 64px sans-serif"; x.fillText(cardPuzzle.name, 90, 1070);
  x.fillStyle = "#f5ead6"; x.font = "34px sans-serif"; wrapText(x, cardText, 90, 1130, 900, 46);
  x.fillStyle = "#d9a441"; x.font = "bold 36px sans-serif";
  x.fillText(`Day ${save.streak} streak · Sankofa Sanctuary`, 90, 1340);
  c.toBlob(async blob => {
    const file = new File([blob], "sankofa-sanctuary.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Sankofa Sanctuary" }); } catch (e) {}
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "sankofa-sanctuary.png"; a.click();
    }
  });
};

/* ---------- JOURNAL ---------- */
function renderJournal() {
  const grid = $("journalGrid"); grid.innerHTML = "";
  PUZZLES.forEach((p, i) => {
    const d = document.createElement("div");
    if (save.journal.includes(i)) {
      d.className = "jItem"; d.style.backgroundImage = `url(${p.image})`;
      d.onclick = () => showCard(i, false, null, "journal", save.deep.includes(i));
    } else { d.className = "jItem locked"; d.textContent = "?"; }
    grid.appendChild(d);
  });
}
$("tabJournal").onclick = () => { renderJournal(); showScreen("journalScreen"); };
$("journalBack").onclick = () => { refreshHome(); showScreen("home"); };

/* ---------- EXPLORE (free play by pack and size) ---------- */
let exCat = "all", exSize = 3;
function renderExplore() {
  const names = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));
  const packs = CATEGORIES.map(c => ({ ...c, n: PUZZLES.filter(p => p.cat === c.id).length })).filter(c => c.n);
  const tabs = [{ id: "all", name: "All", n: PUZZLES.length }, ...packs];
  const bar = $("packTabs");
  bar.innerHTML = tabs.map(c => `<button class="packTab${exCat === c.id ? " on" : ""}" data-id="${c.id}">${c.name}</button>`).join("");
  bar.querySelectorAll(".packTab").forEach(b => b.onclick = () => { exCat = b.dataset.id; renderExplore(); });
  const on = bar.querySelector(".on");
  if (on) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;

  $("sizeSeg").querySelectorAll(".segBtn").forEach(b => {
    b.classList.toggle("on", +b.dataset.s === exSize);
    b.onclick = () => { exSize = +b.dataset.s; renderExplore(); };
  });

  const list = $("exList"); list.innerHTML = "";
  const dc = dailyInfo(), best = save.daily && save.daily.date === dc.date ? save.daily.ms : null;
  const banner = document.createElement("div");
  banner.className = "dailyCard";
  banner.innerHTML = `<div><small>Daily Challenge</small><b>Same puzzle for everyone · ${dc.size}×${dc.size}</b></div><span class="dailyGo">${best != null ? "Best " + fmtTime(best) : "Play"}</span>`;
  banner.onclick = () => startPuzzle({ idx: dc.idx, size: dc.size, seed: dc.seed, daily: true });
  list.appendChild(banner);
  let shown = 0;
  PUZZLES.forEach((p, i) => {
    if (exCat !== "all" && p.cat !== exCat) return;
    shown++;
    const card = document.createElement("div"); card.className = "exCard";
    card.style.backgroundImage = `url(${p.image})`;
    const name = document.createElement("span"); name.className = "exName"; name.textContent = p.name;
    card.append(name);
    // if (save.journal.includes(i)) card.insertAdjacentHTML("beforeend",
    //   '<div class="exDone"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></div>');
    card.onclick = () => startPuzzle({ idx: i, size: exSize });
    list.appendChild(card);
  });
  // $("exCount").textContent = `${shown} puzzle${shown === 1 ? "" : "s"}`;
}
$("tabExplore").onclick = () => { renderExplore(); showScreen("exploreScreen"); };
$("tabHome").onclick = () => { refreshHome(); showScreen("home"); };
$("exBack").onclick = () => { refreshHome(); showScreen("home"); };

/* ---------- CREDITS + HOW TO PLAY ---------- */
$("helpBtn").onclick = () => $("tutorial").classList.remove("hidden");
$("tutOk").onclick = () => { save.seenTutorial = true; writeSave(); $("tutorial").classList.add("hidden"); };

// Every button gives a soft click (audio feedback on all interactions)
document.addEventListener("click", e => { if (e.target.closest("button")) tone(660, 0.07, 0.07); });

/* ---------- HOME BUTTONS ---------- */
$("beginBtn").onclick = () => { startAmbient(); startPuzzle(); };

/* ---------- DEBUG PANEL (tap title 5 times) ---------- */
let titleTaps = 0, tapTimer;
$("title").onclick = () => {
  titleTaps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => titleTaps = 0, 1500);
  if (titleTaps >= 5) { $("debug").classList.toggle("hidden"); titleTaps = 0; }
};
$("dbgSet").onclick = () => { debugDate = $("dbgDate").value.trim() || null; refreshHome(); };
$("dbgNext").onclick = () => { debugDate = addDays(todayStr(), 1); $("dbgDate").value = debugDate; refreshHome(); };
// Solve the puzzle that is on screen right now
$("dbgSolve").onclick = () => {
  if ($("puzzleScreen").classList.contains("hidden") || solved) return;
  order = [...Array(TOTAL).keys()]; onWin();
};
// Finish a whole day instantly: move to the next day, open its puzzle and solve it
$("dbgAuto").onclick = async () => {
  if (doneToday()) { debugDate = addDays(todayStr(), 1); $("dbgDate").value = debugDate; }
  await startPuzzle();
  order = [...Array(TOTAL).keys()]; onWin();
};
$("dbgLeaf").onclick = () => { save.restLeaves++; writeSave(); refreshHome(); };
$("dbgReset").onclick = () => { localStorage.clear(); save = loadSave(); debugDate = null; refreshHome(); };
$("dbgCalib").onclick = () => {
  calib = !calib; calibPts = {};
  document.body.classList.toggle("calib", calib);
  $("dbgCalib").textContent = "Path points: " + (calib ? "on" : "off");
  if (calib) toast("Tap each stop, bottom to top");
};

/* ---------- START ---------- */
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHome(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
CATEGORIES.forEach(c => mapLayer("map-" + c.id, "terrain"));
refreshHome();
showScreen("home");
if (!save.seenTutorial) $("tutorial").classList.remove("hidden");