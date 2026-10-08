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
  muted: false
};
function loadSave() {
  try {
    const raw = localStorage.getItem("sankofa-save");
    return raw ? { ...DEFAULT_SAVE, ...JSON.parse(raw) } : { ...DEFAULT_SAVE };
  } catch (e) { return { ...DEFAULT_SAVE }; }
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
}
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---------- HOME ---------- */
function skyColor() {
  const h = new Date().getHours();
  if (h < 6 || h >= 19) return "linear-gradient(#1d2a4a, #2b3a5c)";   // night / twilight blue
  if (h < 11) return "linear-gradient(#f7e2a0, #f2d27a)";              // morning gold
  if (h < 17) return "linear-gradient(#bfe3f0, #a8d5a2)";              // afternoon
  return "linear-gradient(#f0b27a, #e8a86b)";                           // evening
}
function renderSanctuary(quiet) {
  const scene = $("scene");
  scene.innerHTML = '<div class="ground"></div>';
  scene.style.background = skyColor();
  const hr = new Date().getHours(), night = hr < 6 || hr >= 19;
  scene.insertAdjacentHTML("beforeend", `<div class="orb${night ? " moon" : ""}"></div>`);
  for (let k = 0; k < 4; k++) scene.insertAdjacentHTML("beforeend", night
    ? `<span class="fly" style="left:${15 + k * 22}%;top:${18 + (k % 2) * 25}%;animation-delay:${k * 0.7}s">✨</span>`
    : `<span class="cloud" style="top:${6 + k * 7}%;animation-delay:${-k * 9}s">☁️</span>`);
  scene.classList.toggle("quiet", quiet);
  if (save.sanctuary.length === 0) {
    scene.insertAdjacentHTML("beforeend", '<div class="empty">Your sanctuary is waiting for its first seed.</div>');
  }
  save.sanctuary.forEach((r, i) => {
    const slot = SLOTS[i % SLOTS.length];
    const reward = REWARDS[r % REWARDS.length];
    const lap = Math.floor(i / SLOTS.length) * 3;           // nudge repeats so they don't overlap
    const el = document.createElement("div");
    el.className = "item";
    el.textContent = reward.emoji;
    const age = save.sanctuary.length - 1 - i;            // newer friends start small and grow each day
    el.style.fontSize = (20 + Math.min(age, 8) * 2.5) + "px";
    if (age === 0) el.classList.add("newest");
    el.style.left = Math.min(95, slot.x + lap) + "%";
    el.style.top = slot.y + "%";
    el.onclick = () => toast(reward.twi ? `${reward.name} · ${reward.twi}` : reward.name);
    scene.appendChild(el);
  });
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
  $("playSub").textContent = done ? "Just for calm. Your streak is safe"
    : `${pack ? pack.name : ""} · ${levelFor(c)[1]}×${levelFor(c)[1]} · ${twistFor(c).n}`;

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
function scramble(moves) {
  let a;
  do {
    a = [...Array(TOTAL).keys()];
    let e = TOTAL - 1, prev = -1;
    for (let k = 0; k < moves; k++) {
      const nb = neighbors(e).filter(q => q !== prev), q = nb[Math.floor(Math.random() * nb.length)];
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
  exploreMode = !!opts;
  replay = exploreMode || doneToday();
  counter = exploreMode ? 99 : Math.max(0, replay ? save.puzzleIndex - 1 : save.puzzleIndex);
  puzzleIdx = exploreMode ? opts.idx : counter % PUZZLES.length; puzzle = PUZZLES[puzzleIdx];
  if (!puzzle.sq) puzzle.sq = await squareImage(puzzle.image);
  const [, size, moves] = exploreMode ? [0, opts.size, { 3: 40, 4: 90, 5: 180 }[opts.size]] : levelFor(counter),
    tw = exploreMode ? TWISTS[0] : twistFor(counter);
  SIZE = size; TOTAL = size * size; twist = tw.n;
  $("refImg").src = puzzle.sq || puzzle.image; $("refName").textContent = puzzle.name;
  order = scramble(moves); lastMove = null; solved = false;
  board.className = "";
  board.style.gridTemplateColumns = board.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;
  setupMemory(twist === "Memory");
  $("puzzleHint").textContent = "Breathe in… 🌬️";
  setTimeout(() => { if (!solved) $("puzzleHint").textContent = `Today: ${tw.n} (${SIZE}×${SIZE}). ${tw.d}`; }, 2500);
  renderBoard(); showScreen("puzzleScreen");
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
    //d.style.backgroundImage = `url(${puzzle.sq || puzzle.image})`;
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
$("backBtn").onclick = () => { clearTimeout(memTimer); if (exploreMode) { renderExplore(); showScreen("exploreScreen"); } else { refreshHome(); showScreen("home"); } };

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
    const r = puzzleIdx % REWARDS.length;
    save.sanctuary.push(r);
    reward = REWARDS[r];
    save.puzzleIndex++;
    writeSave();
  }
  setTimeout(() => exploreMode ? showCard(puzzleIdx, false, null, "explore", true) : showCard(puzzleIdx, cycle >= 1, reward, "home"), 1600);
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
  $("cardReward").textContent = reward ? `A new friend joined your sanctuary: ${reward.emoji} ${reward.name}` : "";
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
  bar.innerHTML = tabs.map(c => `<button class="packTab${exCat === c.id ? " on" : ""}" data-id="${c.id}">${c.name}<em>${c.n}</em></button>`).join("");
  bar.querySelectorAll(".packTab").forEach(b => b.onclick = () => { exCat = b.dataset.id; renderExplore(); });
  const on = bar.querySelector(".on");
  if (on) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;

  $("sizeSeg").querySelectorAll(".segBtn").forEach(b => {
    b.classList.toggle("on", +b.dataset.s === exSize);
    b.onclick = () => { exSize = +b.dataset.s; renderExplore(); };
  });

  const list = $("exList"); list.innerHTML = "";
  let shown = 0;
  PUZZLES.forEach((p, i) => {
    if (exCat !== "all" && p.cat !== exCat) return;
    shown++;
    // const card = document.createElement("div"); card.className = "exCard";
    // const img = document.createElement("div"); img.className = "exImg"; img.style.backgroundImage = `url(${p.image})`;
    // const info = document.createElement("div"); info.className = "exInfo";
    // const name = document.createElement("b"); name.textContent = p.name;
    // const tag = document.createElement("small"); tag.textContent = names[p.cat] || "";
    // info.append(name, tag); card.append(img, info);

    const card = document.createElement("div"); card.className = "exCard";
card.style.backgroundImage = `url(${p.image})`;
const name = document.createElement("span"); name.className = "exName"; name.textContent = p.name;
card.append(name);

    if (save.journal.includes(i)) card.insertAdjacentHTML("beforeend",
      '<div class="exDone"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></div>');
    card.onclick = () => startPuzzle({ idx: i, size: exSize });
    list.appendChild(card);
  });
  $("exCount").textContent = `${shown} puzzle${shown === 1 ? "" : "s"}`;
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

/* ---------- START ---------- */
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHome(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
refreshHome();
showScreen("home");
if (!save.seenTutorial) $("tutorial").classList.remove("hidden");
