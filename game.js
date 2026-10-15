const $ = id => document.getElementById(id);
let SIZE = 3, TOTAL = 9;

const DEFAULT_SAVE = {
  streak: 0, bestStreak: 0, lastPlayed: null, restLeaves: 0,
  puzzleIndex: 0,
  sanctuary: [],
  journal: [],
  deep: [],
  pb: {},
  daily: null,
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

const PLAY_ORDER = CATEGORIES.flatMap(c =>
  PUZZLES.map((p, i) => ({ p, i })).filter(o => o.p.cat === c.id).map(o => o.i)
);
const puzzleAt = n => PLAY_ORDER[n % PLAY_ORDER.length];

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

function updateStreak() {
  const today = todayStr();
  if (save.lastPlayed === today) return;
  if (save.lastPlayed === null) {
    save.streak = 1;
  } else {
    const missed = daysBetween(save.lastPlayed, today) - 1;
    if (missed <= 0) save.streak += 1;
    else if (missed <= save.restLeaves) { save.restLeaves -= missed; save.streak += 1; }
    else save.streak = 1;
  }
  if (save.streak % 7 === 0 && save.restLeaves < 2) save.restLeaves += 1;
  save.bestStreak = Math.max(save.bestStreak, save.streak);
  save.lastPlayed = today;
}
function missedDays() {
  if (!save.lastPlayed) return 0;
  return Math.max(0, daysBetween(save.lastPlayed, todayStr()) - 1);
}

/* ---------- AUDIO: soft kalimba-style plucks, reverb and a gentle generative loop ---------- */
let actx, master, verb, sfxBus, musicBus = null;
function mkBus(vol) { const b = actx.createGain(); b.gain.value = vol; b.connect(master); b.connect(verb); return b; }
function audio() {
  if (actx) return actx;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  master = actx.createGain(); master.gain.value = 0.9;
  const comp = actx.createDynamicsCompressor();
  master.connect(comp); comp.connect(actx.destination);
  verb = actx.createConvolver();                         // small generated reverb, no file needed
  const len = Math.floor(actx.sampleRate * 1.8), buf = actx.createBuffer(2, len, actx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  verb.buffer = buf;
  const wet = actx.createGain(); wet.gain.value = 0.28; verb.connect(wet); wet.connect(master);
  sfxBus = mkBus(1);
  return actx;
}
function pluck(freq, vol = 0.12, delay = 0, decay = 0.9, out) {
  if (save.muted) return;
  try {
    const c = audio(); if (c.state === "suspended") c.resume();
    const t = c.currentTime + delay, g = c.createGain(), f = c.createBiquadFilter();
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = "sine"; o1.frequency.value = freq;
    o2.type = "sine"; o2.frequency.value = freq * 4; g2.gain.value = 0.12;   // bright "tine" overtone
    f.type = "lowpass"; f.frequency.value = 3200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(f); f.connect(out || sfxBus);
    o1.start(t); o2.start(t); o1.stop(t + decay + 0.1); o2.stop(t + decay + 0.1);
  } catch (e) {}
}
// old calls like tone(520, 0.12, 0.08) keep working
const tone = (freq, dur, vol = 0.15, delay = 0) => pluck(freq, vol * 1.5, delay, Math.max(0.25, Math.min(dur * 1.2, 1.2)));
const sfx = {
  tap:  () => pluck(330, 0.10, 0, 0.18),
  swap: () => { pluck(392, 0.12, 0, 0.35); pluck(587.33, 0.09, 0.07, 0.45); },
  win:  () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => pluck(f, 0.13, i * 0.14, 1.4))
};

const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];      // C pentatonic
const CHORDS = [[130.81, 196, 293.66], [110, 164.81, 261.63], [98, 146.83, 220], [130.81, 196, 329.63]];
let musicTimer = null, padTimer = null, chordN = 0;
function startAmbient() {
  if (save.muted || musicTimer) return;
  try { audio(); if (actx.state === "suspended") actx.resume(); } catch (e) { return; }
  musicBus = mkBus(0); musicBus.gain.setTargetAtTime(0.9, actx.currentTime, 0.8);
  const pad = () => {                                   // slow soft chords underneath
    if (!musicBus) return;
    const t = actx.currentTime, chord = CHORDS[chordN++ % CHORDS.length];
    chord.forEach(f => [f, f * 1.004].forEach(ff => {
      const o = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
      o.type = "sine"; o.frequency.value = ff; lp.type = "lowpass"; lp.frequency.value = 800;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 3);
      g.gain.linearRampToValueAtTime(0.0001, t + 9.5);
      o.connect(g); g.connect(lp); lp.connect(musicBus); o.start(t); o.stop(t + 9.6);
    }));
    padTimer = setTimeout(pad, 8000);
  };
  const play = () => {                                  // loose, unhurried plucks on top
    if (!musicBus) return;
    if (Math.random() < 0.75) {
      pluck(SCALE[Math.floor(Math.random() * SCALE.length)], 0.045, 0, 1.6, musicBus);
      if (Math.random() < 0.25) pluck(SCALE[Math.floor(Math.random() * SCALE.length)], 0.03, 0.35, 1.4, musicBus);
    }
    musicTimer = setTimeout(play, 1400 + Math.random() * 2400);
  };
  pad(); play();
}
function stopAmbient() {
  clearTimeout(musicTimer); clearTimeout(padTimer); musicTimer = padTimer = null;
  if (musicBus) {
    const b = musicBus; musicBus = null;
    try { b.gain.setTargetAtTime(0, actx.currentTime, 0.2); } catch (e) {}
    setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 1500);
  }
}
// pause sound while the app is in the background
document.addEventListener("visibilitychange", () => {
  if (!actx) return;
  if (document.hidden) actx.suspend(); else if (!save.muted) actx.resume();
});
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

function updateMuteLabel() { $("muteBtn").classList.toggle("off", save.muted); }
$("muteBtn").onclick = () => {
  save.muted = !save.muted; writeSave(); updateMuteLabel();
  if (save.muted) stopAmbient(); else startAmbient();
};
function fitTabbar() {
  const h = $("tabbar").offsetHeight;
  if (h) document.documentElement.style.setProperty("--tabH", h + "px");
}
window.addEventListener("resize", fitTabbar);
window.addEventListener("load", fitTabbar);

function placePlay() {
  const pb = document.querySelector("#home .playBlock"), tb = $("tabbar"), home = $("home");
  if (!pb || !tb || !home || !tb.offsetHeight) return;
  const fromBottom = home.getBoundingClientRect().bottom - tb.getBoundingClientRect().top + 14;
  pb.style.setProperty("bottom", fromBottom + "px", "important");
  const climb = document.querySelector("#home .climb");
  if (climb) climb.style.setProperty("padding-bottom", (fromBottom + pb.offsetHeight + 24) + "px", "important");
}
window.addEventListener("resize", placePlay);
window.addEventListener("load", () => { placePlay(); setTimeout(placePlay, 300); });

/* ---------- SCREENS (with slide transitions in tab order) ---------- */
const TAB_ORDER = ["home", "exploreScreen", "raceMenu", "journalScreen"];   // same order as the tab keys
let prevScreen = null;
function showScreen(id) {
  const a = TAB_ORDER.indexOf(prevScreen), b = TAB_ORDER.indexOf(id);
  document.body.dataset.dir = a >= 0 && b >= 0 ? (b > a ? "fwd" : "back") : "deep";
  prevScreen = id;
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.body.dataset.screen = id;
  document.body.classList.toggle("nonav", !["home", "exploreScreen", "journalScreen", "raceMenu"].includes(id));
  window.scrollTo(0, 0);
  if (id === "home") applyScroll();
  fitTabbar();
  placePlay();
}
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

const SPR = "images/sanctuary/";
const PLANTS = [["baobab", "Baobab"], ["oil-palm", "Oil Palm"], ["mango-tree", "Mango Tree"], ["cocoa-plant", "Cocoa Tree"], ["bush", "Bush"], ["hibiscus", "Hibiscus"], ["flowers", "Wildflowers"], ["grass", "Tall Grass"]];
const PLANT_W = { "baobab-1": 50, "baobab-2": 90, "baobab-3": 140, "oil-palm": 90, "mango-tree": 100, "cocoa-plant": 70, bush: 62, hibiscus: 50, flowers: 42, grass: 38 };
const ANIMALS = [
  { f: "butterfly", n: "Butterfly", fly: 1 }, { f: "hornbill", n: "Hornbill", fly: 1 }, { f: "tortoise", n: "Tortoise" },
  { f: "grey-parrot", n: "Grey Parrot", fly: 1 }, { f: "antelope", n: "Antelope" }, { f: "monkey", n: "Mona Monkey" },
  { f: "elephant", n: "Elephant" }, { f: "fruit-bat", n: "Fruit Bat", fly: 1 }, { f: "toucan", n: "Toucan", fly: 1 }, { f: "zebra", n: "Zebra" }
];
const packTotal = id => PUZZLES.filter(p => p.cat === id).length;
const packDone = id => save.journal.filter(i => PUZZLES[i] && PUZZLES[i].cat === id).length;

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

let climbTop = null, climbN = -1, climbFocus = null;
let calib = false, calibPts = {};
const tierStage = (done, tot) => done >= tot ? 4 : done >= tot * 0.6 ? 3 : done >= tot * 0.35 ? 2 : done ? 1 : 0;
let lastSig = "";

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

function smoothPath(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
    d += ` C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
  }
  return d;
}

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

// Opens the map with the current stop above the Play button.
// Uses offsets (not screen position) so the screen-slide animation can't shift it.
function applyScroll() {
  const wrap = $("scene").querySelector(".climb"); if (!wrap) return;
  if (climbTop != null) { wrap.scrollTop = climbTop; return; }
  const node = wrap.querySelector(".node.current");
  if (node && node.offsetParent) {
    const y = node.offsetParent.offsetTop + node.offsetTop;
    wrap.scrollTop = Math.max(0, y - wrap.clientHeight * 0.4);
  }
}

const ZONE_BG = { culture:"#8a3a6e", history:"#b4502a", nature:"#2f8a52", tourism:"#3a86c0", sports:"#c9662a", cars:"#5a4a66", space:"#1c1640", food:"#d0782a", architecture:"#4a3670" };

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
  if (sig === lastSig && $("scene").querySelector(".climb")) return;
  lastSig = sig;
  const scene = $("scene"), n = save.sanctuary.length;
  const cur = puzzleAt(save.puzzleIndex), today = doneToday();
  if (n !== climbN) { climbTop = null; climbN = n; }

  scene.removeAttribute("style");
  scene.className = "climbScene" + (quiet ? " quiet" : "");

  scene.innerHTML = '<div class="climb"></div>';
  const wrap = scene.querySelector(".climb");
  const zoneList = [...CATEGORIES].reverse().filter(x => packTotal(x.id));
  const lastP = save.journal.length ? PUZZLES[save.journal[save.journal.length - 1]] : null;
  climbFocus = today && lastP ? lastP.cat : PUZZLES[cur].cat;

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

    tier.appendChild(mapLayer("map-" + c.id, "terrain"));

    const { H, pos } = zonePositions(c.id, tot, k);
    tier.style.height = H + "px"; tier.style.minHeight = "0";
    const d = smoothPath([{ x: 50, y: 101 }, ...pos, { x: 50, y: -1 }]);
    tier.insertAdjacentHTML("beforeend",
      `<svg class="trail" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="rShade" d="${d}"/><path class="rEdge" d="${d}"/><path class="rSurf" d="${d}"/><path class="rLine" d="${d}"/></svg>`);
    tier.appendChild(mapLayer("path-" + c.id, "pathArt", () => tier.classList.add("hasPath")));

    list.forEach((o, j) => {
      const state = save.journal.includes(o.i) ? "done" : (o.i === cur ? "current" : "locked");
      const preview = state === "locked" && j === 0;
      const node = document.createElement("button");
      node.className = "node " + state + (preview ? " preview" : "");
      node.style.left = pos[j].x + "%"; node.style.top = pos[j].y + "%";
      node.setAttribute("aria-label", state === "locked" ? `${c.name} puzzle, locked` : o.p.name);
      const pin = document.createElement("div"); pin.className = "pin";
      pin.appendChild(sprite("zone-map", 20, () => { const s = document.createElement("span"); s.textContent = "📍"; return s; }));
      const card = document.createElement("div"); card.className = "nCard";
      if (state !== "locked" || preview) card.style.backgroundImage = `url(${o.p.image})`;
      const nm = document.createElement("span"); nm.className = "nName";
      nm.textContent = (state === "locked" && !preview) ? "???" : o.p.name;
      node.append(pin, card, nm);
      node.onclick = () => {
        if (state === "done") showCard(o.i, false, null, "home", save.deep.includes(o.i));
        else openSheet(o, c, state);
      };
      tier.appendChild(node);
    });

    wrap.appendChild(tier);
  });

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

  const c = save.puzzleIndex, pack = CATEGORIES.find(x => x.id === PUZZLES[puzzleAt(c)].cat);
  $("beginBtn").textContent = done ? "Play again" : "Play today's puzzle";
  $("beginBtn").classList.toggle("secondary", done);
  $("playSub").textContent = "";

  renderWeek();
  renderSanctuary(broken && !!save.lastPlayed && !done);
  $("dbgInfo").textContent = `date: ${todayStr()} · leaves: ${save.restLeaves}`;
  placePlay();
  updateMuteLabel();
}

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

const board = $("board");
let puzzle, puzzleIdx = 0, counter = 0, replay = false, solved = false, twist = "Classic";
let moveCount = 0, parMoves = 30;
let order = [], lastMove = null, memTimer;

function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function dailyInfo() {
  const date = todayStr(), seed = hashStr("sankofa-" + date), dow = nowDate().getDay();
  return { date, idx: seed % PUZZLES.length, size: (dow === 0 || dow === 6) ? 4 : 3, seed };
}
const fmtTime = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
let startTime = 0, tick = null, dailyRun = false, lastShareText = "";

const LEVELS = [[0, 3, 14], [2, 3, 30], [4, 3, 60], [7, 4, 50], [10, 4, 90], [14, 4, 140], [20, 5, 180]];
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
  puzzleIdx = exploreMode ? opts.idx : puzzleAt(counter); puzzle = PUZZLES[puzzleIdx];
  if (!puzzle.sq) puzzle.sq = await squareImage(puzzle.image);
  const [, size, moves] = exploreMode ? [0, opts.size, { 3: 40, 4: 90, 5: 180 }[opts.size]] : levelFor(counter),
    tw = exploreMode ? TWISTS[0] : twistFor(counter);
  SIZE = size; TOTAL = size * size; twist = tw.n;
  parMoves = moves; moveCount = 0;
  $("refImg").src = puzzle.sq || puzzle.image; $("refName").textContent = puzzle.name;
  order = scramble(moves, opts && opts.seed != null ? mulberry32(opts.seed) : Math.random); lastMove = null; solved = false;
  board.className = "";
  board.style.gridTemplateColumns = board.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;
  setupMemory(twist === "Memory");
  if (exploreMode) {
    $("puzzleHint").textContent = "";
  } else {
    $("puzzleHint").textContent = "Breathe in… 🌬️";
    setTimeout(() => { if (!solved) $("puzzleHint").textContent = `Today: ${tw.n} (${SIZE}×${SIZE}). ${tw.d}`; }, 2500);
  }
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
    if (t === TOTAL - 1 && !solved) c += " void";
    else {
      if (t === pos && twist !== "Pure") c += " ok";
      if (counter < 3 && !solved && adjacent(pos, e)) c += " near";
      if (lastMove && lastMove.to === pos) c += " slide";
    }
    d.className = c;
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
  if (!adjacent(pos, e)) { sfx.tap(); return; }
  [order[pos], order[e]] = [order[e], order[pos]];
  moveCount++;
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
  setTimeout(() => showWin(() => {
    exploreMode ? showCard(puzzleIdx, false, null, "explore", true) : showCard(puzzleIdx, cycle >= 1, reward, "home");
    if (note) $("cardReward").textContent = note;
  }), 1600);
}

/* ---------- WIN SCREEN ---------- */
const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.4l2.9 6.2 6.7.8-4.9 4.6 1.3 6.7L12 17.4l-6 3.3 1.3-6.7L2.4 9.4l6.7-.8z"/></svg>';
// 3 stars = close to the shortest solution, 2 = good, 1 = finished
const starsFor = m => { const r = m / Math.max(1, parMoves); return r <= 1.5 ? 3 : r <= 2.6 ? 2 : 1; };
function showWin(next) {
  const ms = Date.now() - startTime, n = starsFor(moveCount), box = $("winStars");
  $("winName").textContent = puzzle.name;
  $("winTime").textContent = fmtTime(ms);
  $("winMoves").textContent = moveCount;
  box.innerHTML = "";
  for (let k = 0; k < 3; k++) {
    const s = document.createElement("span");
    s.className = "winStar" + (k < n ? " on" : "");
    s.style.setProperty("--d", (0.35 + k * 0.28) + "s");
    s.innerHTML = STAR_SVG;
    box.appendChild(s);
    if (k < n) setTimeout(() => tone([659.25, 783.99, 1046.5][k], 0.6, 0.1), 350 + k * 280);
  }
  $("winBtn").onclick = () => { $("win").classList.add("hidden"); next(); };
  $("win").classList.remove("hidden");
}

/* ---------- HERITAGE CARD (collectible) ---------- */
let cardReturn = "home", cardText = "", cardPuzzle = null;
function showCard(idx, deep, reward, returnTo, both) {
  const p = PUZZLES[idx], cat = CATEGORIES.find(c => c.id === p.cat);
  cardPuzzle = p; cardReturn = returnTo;
  cardText = both ? `${p.fact1} ${p.fact2}` : (deep ? p.fact2 : p.fact1);
  $("card").dataset.cat = p.cat;
  $("cardCat").textContent = cat ? cat.name : "";
  $("cardImg").src = p.image;
  $("cardTitle").textContent = p.name;
  $("cardFact").textContent = cardText;
  $("cardSource").textContent = p.visit ? "📍 " + p.visit : "";
  $("cardReward").textContent = "";
  $("card").classList.remove("hidden");
}
$("cardContinue").onclick = () => {
  $("card").classList.add("hidden");
  if (cardReturn === "explore") { renderExplore(); showScreen("exploreScreen"); }
  else if (cardReturn === "journal") { renderJournal(); showScreen("journalScreen"); }
  else { refreshHome(); showScreen("home"); }
};

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

function renderJournal() {
  const grid = $("journalGrid"); grid.innerHTML = "";
  const total = PUZZLES.length, got = save.journal.length;
  $("jCount").textContent = `${got} of ${total} restored`;
  $("jBarFill").style.width = Math.round(got / total * 100) + "%";

  let n = 0;
  CATEGORIES.forEach(c => {
    const list = PUZZLES.map((p, i) => ({ p, i })).filter(o => o.p.cat === c.id);
    if (!list.length) return;
    const done = list.filter(o => save.journal.includes(o.i)).length;

    const sec = document.createElement("section");
    sec.className = "jSec" + (done === list.length ? " full" : "");
    sec.dataset.cat = c.id;
    sec.innerHTML = `<header class="jSecHead"><h3>${c.name}</h3><span class="jCnt">${done}/${list.length}</span></header><div class="jRow"></div>`;
    const row = sec.querySelector(".jRow");

    list.forEach(o => {
      const d = document.createElement("div");
      d.style.setProperty("--d", Math.min(n++, 14) * 30 + "ms");
      if (save.journal.includes(o.i)) {
        d.className = "jItem";
        d.style.backgroundImage = `url(${o.p.image})`;
        d.innerHTML = `<span class="jName">${o.p.name}</span>`;
        d.onclick = () => showCard(o.i, false, null, "journal", save.deep.includes(o.i));
      } else {
        d.className = "jItem locked";
        d.textContent = "?";
      }
      row.appendChild(d);
    });
    grid.appendChild(sec);
  });
}

$("tabJournal").onclick = () => { renderJournal(); showScreen("journalScreen"); };
$("journalBack").onclick = () => { refreshHome(); showScreen("home"); };

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
    card.dataset.cat = p.cat;
    card.style.backgroundImage = `url(${p.image})`;
    const name = document.createElement("span"); name.className = "exName"; name.textContent = p.name;
    card.append(name);
    card.onclick = () => startPuzzle({ idx: i, size: exSize });
    list.appendChild(card);
  });
}
$("tabExplore").onclick = () => { renderExplore(); showScreen("exploreScreen"); };
$("tabHome").onclick = () => { refreshHome(); showScreen("home"); };
$("exBack").onclick = () => { refreshHome(); showScreen("home"); };

/* ---------- HOW TO PLAY: a 2×2 puzzle you really slide ---------- */
const HAND = '<svg class="tutHand" viewBox="0 0 24 24"><g fill="#fff" stroke="#2a1a05" stroke-width="1.2" stroke-linejoin="round"><path d="M7 14h12.2v3.5A5.5 5.5 0 0 1 13.7 23h-1.2A5.5 5.5 0 0 1 7 17.5z"/><rect x="9.2" y="2" width="3.6" height="13" rx="1.8"/><rect x="13" y="9" width="3.2" height="7" rx="1.6"/><rect x="16.2" y="10.2" width="3" height="6.5" rx="1.5"/><circle cx="6.8" cy="15.2" r="1.9"/></g><rect x="9.6" y="13" width="9.4" height="4" fill="#fff"/></svg>';
const TUT_START = [3, 0, 2, 1], TUT_PATH = [1, 3];       // two guided slides solve it
let tutOrder = [], tutN = 0, tutImg = "";
async function openTutorial() {
  tutOrder = TUT_START.slice(); tutN = 0;
  tutImg = await squareImage(PUZZLES[0].image);
  renderTut(); $("tutorial").classList.remove("hidden");
}
function renderTut() {
  const tb = $("tutBoard"), done = tutN >= TUT_PATH.length;
  tb.innerHTML = ""; tb.classList.toggle("solved", done);
  tutOrder.forEach((t, pos) => {
    const d = document.createElement("div"), isHint = !done && pos === TUT_PATH[tutN];
    d.className = "tutTile" + (t === 3 && !done ? " void" : "") + (isHint ? " hint" : "");
    d.style.backgroundImage = `url(${tutImg})`;
    d.style.backgroundSize = "200% 200%";
    d.style.backgroundPosition = `${(t % 2) * 100}% ${Math.floor(t / 2) * 100}%`;
    if (isHint) d.insertAdjacentHTML("beforeend", HAND);
    d.onclick = () => tutTap(pos);
    tb.appendChild(d);
  });
  $("tutStep").textContent = done ? "All done" : `Step ${tutN + 1} of ${TUT_PATH.length}`;
  $("tutTitle").textContent = done ? "You're ready!" : "Slide a tile";
  $("tutText").textContent = done ? "Rebuild the picture, learn its story, grow your sanctuary and keep your daily streak."
    : tutN === 0 ? "Tap the tile with the hand. It's next to the empty space." : "Nice! Now slide this one into the gap.";
  $("tutOk").classList.toggle("hidden", !done);
  $("tutSkip").classList.toggle("hidden", done);
}
function tutTap(pos) {
  if (tutN >= TUT_PATH.length) return;
  if (pos !== TUT_PATH[tutN]) { sfx.tap(); return; }
  const gap = tutOrder.indexOf(3);
  [tutOrder[pos], tutOrder[gap]] = [tutOrder[gap], tutOrder[pos]];
  tutN++; buzz(12);
  if (tutN >= TUT_PATH.length) { sfx.win(); confetti(); } else sfx.swap();
  renderTut();
}
const closeTut = () => { save.seenTutorial = true; writeSave(); $("tutorial").classList.add("hidden"); };
$("tutOk").onclick = $("tutSkip").onclick = closeTut;
$("helpBtn").onclick = openTutorial;

document.addEventListener("click", e => {
  if (e.target.closest("button") && !e.target.closest("#tabbar")) tone(660, 0.07, 0.07);
});

$("beginBtn").onclick = () => { startAmbient(); startPuzzle(); };

let titleTaps = 0, tapTimer;
$("title").onclick = () => {
  titleTaps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => titleTaps = 0, 1500);
  if (titleTaps >= 5) { $("debug").classList.toggle("hidden"); titleTaps = 0; }
};
$("dbgSet").onclick = () => { debugDate = $("dbgDate").value.trim() || null; refreshHome(); };
$("dbgNext").onclick = () => { debugDate = addDays(todayStr(), 1); $("dbgDate").value = debugDate; refreshHome(); };
$("dbgSolve").onclick = () => {
  if ($("puzzleScreen").classList.contains("hidden") || solved) return;
  order = [...Array(TOTAL).keys()]; onWin();
};
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

document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHome(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
CATEGORIES.forEach(c => mapLayer("map-" + c.id, "terrain"));
refreshHome();
showScreen("home");
if (!save.seenTutorial) openTutorial();