// ===== RACE A FRIEND (peer-to-peer using PeerJS) =====
window.raceActive = false;
(function () {
  const $ = id => document.getElementById(id);
  const MOVES = { 3: 40, 4: 90, 5: 180 }, MAXP = 6;
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = ms => { const s = ms / 1000; return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s"; };
  const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

  /* ---------- state ---------- */
  let peer = null, conns = [], hostConn = null, isHost = false, joined = false;
  let myId = "", room = "", players = {}, winner = null, phase = "lobby";
  let cfg = { size: 3, pidx: -1 }, t0 = 0, finished = false, myMs = null, roundId = 0;

  /* ---------- styles ---------- */
  document.head.insertAdjacentHTML("beforeend", `<style>
    .rbar{display:grid;grid-template-columns:96px 1fr 58px;gap:8px;align-items:center;font-size:.85rem;width:min(92vw,420px);text-align:left}
    #raceBars{display:flex;flex-direction:column;gap:6px}
    .track{height:10px;background:rgba(255,255,255,.15);border-radius:6px;overflow:hidden}
    .track i{display:block;height:100%;background:var(--gold);transition:width .3s}
    #raceCount{position:absolute;inset:0;display:grid;place-items:center;background:var(--bg);font-size:5rem;font-weight:700;color:var(--gold);z-index:5;border-radius:8px}
    #raceResult{position:fixed;inset:0;background:rgba(0,0,0,.75);display:grid;place-items:center;padding:16px;z-index:25}
    .rrow{display:flex;justify-content:space-between;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.12)}
    #roomCode{letter-spacing:.2em;color:var(--gold)}
    #raceMenu input,#raceLobby select{padding:12px;border-radius:10px;border:0;font-size:1rem;text-align:center;max-width:90vw}
    #playerList{list-style:none;padding:0;margin:0;font-size:1.1rem;display:flex;flex-direction:column;gap:6px}
  </style>`);

  /* ---------- screens ---------- */
  const puzzleOptions = PUZZLES.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("");
  document.body.insertAdjacentHTML("beforeend", `
  <section id="raceMenu" class="screen hidden">
    <h2>🏁 Race a Friend</h2>
    <p class="message">Same puzzle, same shuffle. First to finish wins.</p>
    <input id="raceName" placeholder="Your name" maxlength="14">
    <button id="raceCreate">Create a race</button>
    <p class="message">or join a friend</p>
    <div class="row"><input id="raceCode" placeholder="CODE" maxlength="5" style="text-transform:uppercase"><button id="raceJoin" class="secondary">Join</button></div>
    <p id="raceMsg" class="message"></p>
    <button id="raceMenuBack" class="secondary">Home</button>
  </section>
  <section id="raceLobby" class="screen hidden">
    <h2>Room <span id="roomCode"></span></h2>
    <button id="shareRoom" class="secondary">Invite a friend</button>
    <div class="row">
      <select id="optSize"><option value="3">3×3 · Easy</option><option value="4">4×4 · Medium</option><option value="5">5×5 · Hard</option></select>
      <select id="optPuzzle"><option value="-1">Random puzzle</option>${puzzleOptions}</select>
    </div>
    <ul id="playerList"></ul>
    <p id="lobbyMsg" class="message"></p>
    <div class="row"><button id="raceStart">Start race</button><button id="raceLeave" class="secondary">Leave</button></div>
  </section>
  <div id="raceResult" class="hidden"><div class="cardBox">
    <h2 id="rrTitle"></h2><div id="rrList"></div><p id="rrWait" class="message"></p>
    <div class="row"><button id="rrLobby">Back to lobby</button><button id="rrLeave" class="secondary">Leave</button></div>
  </div></div>`);

  const raceBtn = document.createElement("button");
  raceBtn.id = "raceBtn"; raceBtn.className = "secondary"; raceBtn.textContent = "🏁 Race a Friend";
  
  $("puzzleLayout").insertAdjacentHTML("beforebegin", '<div id="raceBars"></div>');
  $("boardWrap").insertAdjacentHTML("beforeend", '<div id="raceCount" class="hidden"></div>');
  try { $("raceName").value = localStorage.getItem("sankofa-name") || ""; } catch (e) {}

  const say = m => { $("raceMsg").textContent = m; };
  const getName = () => {
    const n = $("raceName").value.trim() || "Player" + (10 + Math.floor(Math.random() * 90));
    try { localStorage.setItem("sankofa-name", n); } catch (e) {}
    return n;
  };

  /* ---------- connection: HOST ---------- */
  function createRoom() {
    if (typeof Peer === "undefined") return say("Racing needs an internet connection.");
    cleanup(); isHost = true; myId = "host"; room = newCode();
    const name = getName(); say("Creating room…");
    peer = new Peer("sankofa-" + room);
    peer.on("open", () => {
      players = { host: { name, n: 0, ms: null } };
      phase = "lobby"; winner = null; cfg = { size: +$("optSize").value, pidx: -1 };
      openLobby();
    });
    peer.on("connection", onGuest);
    peer.on("error", e => {
      if (e.type === "unavailable-id") createRoom();
      else say("Couldn't reach the matchmaking server. Check your internet.");
    });
  }
  function onGuest(c) {
    c.on("data", m => hostData(c, m));
    c.on("close", () => {
      conns = conns.filter(x => x !== c);
      if (c._pid && players[c._pid]) { delete players[c._pid]; hostBroadcast(); }
    });
  }
  function hostData(c, m) {
    if (m.t === "join") {
      if (phase !== "lobby" || Object.keys(players).length >= MAXP) { c.send({ t: "full" }); return; }
      c._pid = c.peer;
      players[c._pid] = { name: String(m.name || "Player").slice(0, 14), n: 0, ms: null };
      conns.push(c); c.send({ t: "welcome", id: c._pid }); hostBroadcast();
    } else if (!players[c._pid]) { return; }
    else if (m.t === "prog") { players[c._pid].n = m.n; hostBroadcast(); }
    else if (m.t === "done") { players[c._pid].ms = m.ms; if (!winner) winner = c._pid; hostBroadcast(); }
  }
  function hostBroadcast() {
    const m = { t: "state", players, winner, phase, cfg };
    conns.forEach(c => { if (c.open) c.send(m); });
    renderAll();
  }
  function hostStart() {
    cfg.size = +$("optSize").value; cfg.pidx = +$("optPuzzle").value;
    const pidx = cfg.pidx < 0 ? Math.floor(Math.random() * PUZZLES.length) : cfg.pidx;
    SIZE = cfg.size; TOTAL = SIZE * SIZE;
    const order0 = scramble(MOVES[cfg.size]);
    Object.values(players).forEach(p => { p.n = 0; p.ms = null; });
    winner = null; phase = "race";
    const m = { t: "start", size: cfg.size, pidx, order: order0 };
    conns.forEach(c => { if (c.open) c.send(m); });
    beginRound(m); hostBroadcast();
  }
  function hostBackToLobby() {
    Object.values(players).forEach(p => { p.n = 0; p.ms = null; });
    winner = null; phase = "lobby"; endRaceUI(); openLobby(); hostBroadcast();
  }

  /* ---------- connection: GUEST ---------- */
  function joinRoom() {
    const code = $("raceCode").value.trim().toUpperCase();
    if (typeof Peer === "undefined") return say("Racing needs an internet connection.");
    if (code.length < 4) return say("Enter your friend's room code.");
    cleanup(); isHost = false; room = code;
    const name = getName(); say("Connecting…");
    peer = new Peer();
    peer.on("open", id => {
      myId = id;
      hostConn = peer.connect("sankofa-" + room, { reliable: true });
      hostConn.on("open", () => hostConn.send({ t: "join", name }));
      hostConn.on("data", guestData);
      hostConn.on("close", () => { if (room) { leave(true); say("The host left the room."); } });
    });
    peer.on("error", e => say(e.type === "peer-unavailable" ? "Room not found. Check the code." : "Couldn't connect. Check your internet."));
  }
  function guestData(m) {
    if (m.t === "full") { leave(true); say("Room is full, or the race already started."); }
    else if (m.t === "welcome") { myId = m.id; }
    else if (m.t === "state") {
      players = m.players; winner = m.winner; cfg = m.cfg;
      if (finished && players[myId] && players[myId].ms == null) players[myId].ms = myMs;
      if (!joined) { joined = true; phase = m.phase; openLobby(); }
      else if (m.phase === "lobby" && phase !== "lobby") { phase = "lobby"; endRaceUI(); openLobby(); }
      renderAll();
    } else if (m.t === "start") { beginRound(m); }
  }

  /* ---------- the race itself ---------- */
  async function beginRound(m) {
    const my = ++roundId;
    exploreMode = false; phase = "race"; window.raceActive = true; finished = false; myMs = null; winner = null;
    puzzle = PUZZLES[m.pidx];
    if (!puzzle.sq) puzzle.sq = await squareImage(puzzle.image);
    SIZE = m.size; TOTAL = SIZE * SIZE; twist = "Classic"; counter = 99;
    order = m.order.slice(); lastMove = null; solved = true;     // locked until GO
    board.className = "";
    board.style.gridTemplateColumns = board.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;
    setupMemory(false);
    $("refImg").src = puzzle.sq; $("refName").textContent = puzzle.name;
    $("puzzleHint").textContent = "Race! Slide tiles into the gap. First to finish wins.";
    $("backBtn").textContent = "Leave race";
    $("raceResult").classList.add("hidden");
    renderBoard(); showScreen("puzzleScreen"); renderAll();
    const cd = $("raceCount"); cd.classList.remove("hidden");
    for (const s of ["3", "2", "1", "GO!"]) {
      if (my !== roundId || !window.raceActive) return;
      // cd.textContent = s; sfx.tap(); await sleep(s === "GO!" ? 500 : 1000);
      cd.textContent = s; cd.style.animation = "none"; void cd.offsetWidth; cd.style.animation = "";
sfx.tap(); await sleep(s === "GO!" ? 500 : 1000);
    }
    if (my !== roundId || !window.raceActive) return;
    cd.classList.add("hidden"); solved = false; t0 = Date.now(); renderBoard();
  }
  function report(m) {
    if (isHost) {
      const p = players.host; if (!p) return;
      if (m.t === "prog") p.n = m.n; else { p.ms = m.ms; if (!winner) winner = "host"; }
      hostBroadcast();
    } else if (hostConn && hostConn.open) { hostConn.send(m); }
  }
  // called by game.js after every tile slide while racing
  window.raceMove = function () {
    const n = order.filter((v, i) => v === i && v !== TOTAL - 1).length;
    report({ t: "prog", n });
    if (correctCount(order) === TOTAL) {
      solved = true; renderBoard(); board.classList.add("solved");
      myMs = Date.now() - t0; finished = true;
      if (players[myId]) players[myId].ms = myMs;
      sfx.win(); buzz([30, 60, 30]);
      report({ t: "done", ms: myMs });
      renderAll();
    }
  };

  /* ---------- drawing ---------- */
  const rank = (a, b) => {
    const A = a[1], B = b[1];
    if (A.ms != null && B.ms != null) return A.ms - B.ms;
    if (A.ms != null) return -1; if (B.ms != null) return 1;
    return B.n - A.n;
  };
  function renderAll() {
    $("playerList").innerHTML = Object.entries(players).map(([id, p]) =>
      `<li>${id === "host" ? "👑" : "🙂"} ${esc(p.name)}${id === myId ? " (you)" : ""}</li>`).join("");
    $("optSize").value = cfg.size; $("optPuzzle").value = cfg.pidx;
    $("optSize").disabled = $("optPuzzle").disabled = !isHost;
    $("raceStart").classList.toggle("hidden", !isHost);
    $("lobbyMsg").textContent = isHost
      ? "Share the code or invite link, then press Start when everyone has joined."
      : "Waiting for the host to start…";
    if (phase !== "race") return;
    const total = TOTAL - 1, list = Object.entries(players).sort(rank);
    $("raceBars").innerHTML = list.map(([id, p]) =>
      `<div class="rbar"><span>${winner === id ? "🏆 " : ""}${esc(p.name)}${id === myId ? " (you)" : ""}</span>
       <div class="track"><i style="width:${p.ms != null ? 100 : Math.round(100 * p.n / total)}%"></i></div>
       <b>${p.ms != null ? fmt(p.ms) : p.n + "/" + total}</b></div>`).join("");
    if (winner && winner !== myId && !finished && players[winner])
      $("puzzleHint").textContent = `🏁 ${players[winner].name} finished first! Keep going.`;
    if (finished) showResult(list);
  }
  function showResult(list) {
    const place = list.findIndex(([id]) => id === myId) + 1;
    $("rrTitle").textContent = winner === myId ? "🏆 You won!" : "You finished in place " + place;
    $("rrList").innerHTML = list.map(([id, p], i) =>
      `<div class="rrow"><span>${i + 1}. ${esc(p.name)}${id === myId ? " (you)" : ""}</span>
       <b>${p.ms != null ? fmt(p.ms) : "racing… " + p.n + "/" + (TOTAL - 1)}</b></div>`).join("");
    $("rrLobby").classList.toggle("hidden", !isHost);
    $("rrWait").textContent = isHost ? "" : "The host can start a rematch.";
    $("raceResult").classList.remove("hidden");
  }
  function openLobby() { $("roomCode").textContent = room; showScreen("raceLobby"); renderAll(); }
  function endRaceUI() {
    window.raceActive = false; finished = false; roundId++;
    $("raceResult").classList.add("hidden"); $("raceBars").innerHTML = "";
    $("raceCount").classList.add("hidden"); $("backBtn").textContent = "Home";
    board.className = ""; solved = false;
  }
  function cleanup() {
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null; conns = []; hostConn = null; joined = false; players = {}; winner = null; phase = "lobby";
  }
  function leave(toMenu) {
    room = ""; cleanup(); endRaceUI();
    if (toMenu) { say(""); showScreen("raceMenu"); }
  }

  /* ---------- buttons ---------- */
  $("tabRace").onclick = () => { say(""); showScreen("raceMenu"); };
  $("raceMenuBack").onclick = () => { refreshHome(); showScreen("home"); };
  $("raceCreate").onclick = createRoom;
  $("raceJoin").onclick = joinRoom;
  $("raceStart").onclick = hostStart;
  $("raceLeave").onclick = () => { leave(false); refreshHome(); showScreen("home"); };
  $("rrLeave").onclick = () => { leave(false); refreshHome(); showScreen("home"); };
  $("rrLobby").onclick = hostBackToLobby;
  $("optSize").onchange = $("optPuzzle").onchange = () => {
    if (!isHost) return;
    cfg.size = +$("optSize").value; cfg.pidx = +$("optPuzzle").value; hostBroadcast();
  };
  $("shareRoom").onclick = () => {
    const url = location.origin + location.pathname + "?room=" + room;
    const text = `Race me in Sankofa Sanctuary! Room code: ${room}`;
    if (navigator.share) navigator.share({ title: "Sankofa Sanctuary", text, url }).catch(() => {});
    else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank");
  };
  const oldBack = $("backBtn").onclick;
  $("backBtn").onclick = () => { if (window.raceActive) leave(false); oldBack(); };

  // invite links like ?room=ABCDE open the join screen
  const q = new URLSearchParams(location.search).get("room");
  if (q) { $("raceCode").value = q.toUpperCase(); showScreen("raceMenu"); }
})();
