  /* ==========================================================
   App constants + state
   ========================================================== */

  const STORAGE_KEY = "nascar_pool_player_name";
  const VIEW_KEY = "nascar_pool_active_view";
  const SPOILER_KEY = "nascar_pool_spoilers_on";
  const ADMIN_TOKEN_KEY = "nascar_pool_admin_token";

  const TOURNAMENT_PAYOUTS = {
    1: "$100",
    2: "$60",
    3: "$40",
    4: "$20"
  };

  const roundLabel = (n) => (Number(n) === 4 ? "Final" : `Rnd ${n}`);
  const views = ["current","live","mymatchup","standings","dues","bracket","hub"];
  const ADMIN_PIN_LENGTH = 6;
  let _adminUnlockInFlight = false;
  let activeView = "current";
  let ALL_MATCHUPS = null;
  let RACE_LIST = [];
  let _raceSelectWiringDone = false;
  let _raceSelectIsProgrammatic = false;
  let _playerRaceData = null;
  let _playerDues = null;
  let _playerList = null;
  let _cache_standings = null;
  let _statsMode = "overall";
  let _nameWTimer = null;
  let _selectedBracketTournament = "";
  let _adminContext = null;
  let _adminSeedWheel = null;
  let _adminLongPressTimer = null;
  let _adminLongPressTriggered = false;
  let _currentLoaded = false;
  let _standingsLoaded = false;
  let _duesLoaded = false;
  let _myMatchupLoaded = false;
  let _bracketLoaded = false;
  
  let _livePollTimer = null;

  function startLivePolling_() {
    if (_livePollTimer) return;
  
    _livePollTimer = setInterval(() => {
      if (document.hidden) return;
      if (activeView !== "live") return;
  
      loadLiveMatchups();
    }, 15000);
  }

  /* ==========================================================
   Spoiler toggle
   ========================================================== */

  function spoilersOn_(){
    const v = String(localStorage.getItem(SPOILER_KEY) ?? "1");
    return v !== "0";
  }

  function setSpoilersOn_(on){
    localStorage.setItem(SPOILER_KEY, on ? "1" : "0");
    paintSpoilerToggle_();
    enforceSpoilerNav_();
  }

  function paintSpoilerToggle_(){
    const btn = document.getElementById("spoilerToggle");
    const state = document.getElementById("spoilerState");
    const thumb = document.getElementById("spoilerThumb");
    const on = spoilersOn_();

    if(!btn || !state || !thumb) return;

    btn.setAttribute("aria-checked", on ? "true" : "false");
    state.textContent = on ? "ON" : "OFF";
    thumb.style.transform = on ? "translateX(32px)" : "translateX(0px)";
    thumb.style.background = on ? "var(--red)" : "var(--blue)";
    btn.style.background = on ? "var(--spoilerOnBg)" : "var(--spoilerOffBg)";
    btn.title = on ? "Spoilers ON (shows winners)" : "Spoilers OFF (hides winners)";
  }

  function initSpoilerToggle_(){
    const btn = document.getElementById("spoilerToggle");
    if(!btn) return;

    paintSpoilerToggle_();
    enforceSpoilerNav_();

    btn.onclick = () => {
      setSpoilersOn_(!spoilersOn_());
      if (!spoilersOn_() && activeView === "bracket") {
        showView("current");
      }
      refreshActiveView();
    };
  }

  function enforceSpoilerNav_(){
    const on = spoilersOn_();
    const bracketBtn = document.getElementById("nav-bracket");
    if (bracketBtn) bracketBtn.style.display = on ? "" : "none";
  }

  /* ==========================================================
   Viewport / iOS bottom bar handling
   ========================================================== */
  
  (function markIOSStandalone(){
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isStandalone) {
      document.documentElement.classList.add("iosStandalone");
    }
  })();
  
  (function fixIOSBottomBar(){
    function update(){
      const vv = window.visualViewport;
      if (!vv) return;

      const bottomGap = Math.max(
        0,
        window.innerHeight - (vv.height + vv.offsetTop)
      );

      document.documentElement.style.setProperty("--vvb", bottomGap + "px");
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update);
      window.visualViewport.addEventListener("scroll", update);
    }
  })();

  /* ==========================================================
   Data fetchers
   ========================================================== */

  async function getPlayerRaceData_(){
    if (_playerRaceData) return _playerRaceData;
    const res = await fetch("/api/player-race-data", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || "player-race-data failed");
    }
    _playerRaceData = data;
    return data;
  }

  async function getPlayerMyMatchup_(name){
    const res = await fetch(`/api/player-my-matchup?name=${encodeURIComponent(name)}`, {
      cache: "no-store"
    });
    const data = await res.json();
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || "player-my-matchup failed");
    }
    return data.data || {};
  }

  async function getPlayerBracket_(tournament){
    const qs = tournament ? `?tournament=${encodeURIComponent(tournament)}` : "";
    const res = await fetch(`/api/player-bracket${qs}`, {
      cache: "no-store"
    });
    const data = await res.json();
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || "player-bracket failed");
    }
    return data.data || {};
  }

  async function getPlayerStats_(){
    const res = await fetch("/api/player-stats", {
      cache: "no-store"
    });
    const data = await res.json();
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || "player-stats failed");
    }
    return data.data || {};
  }

  async function getPlayerDues_(){
    if (_playerDues) return _playerDues;
    const res = await fetch("/api/player-dues", {
      cache: "no-store"
    });
    const data = await res.json();
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || "player-dues failed");
    }
    _playerDues = data.data || {};
    return _playerDues;
  }

  /* ==========================================================
   Live matchups
   ========================================================== */

async function loadLiveMatchups(){

  const info = document.getElementById("liveRaceInfo");
  const box  = document.getElementById("liveMatchups");

  if(!info || !box) return;

  try{

    const res = await fetch("/api/live-matchups", { cache: "no-store" });
    const data = await res.json();

    if(!res.ok || !data?.ok){
      box.textContent = "Live data unavailable.";
      return;
    }

    const race = data.race || {};
const liveCard = info.closest(".card");

function flagColor_(flag) {
  const f = Number(flag);
  if (f === 1) return "var(--green)";
  if (f === 2) return "var(--yellow)";
  if (f === 3) return "var(--red)";
  return "";
}

function flagDot_(flag) {
  const color = flagColor_(flag);
  return color ? `<span style="color:${color};">●</span>` : "";
}

const liveColor = flagColor_(race.flag);

if (liveCard) {
  liveCard.style.borderColor = liveColor || "var(--line)";
  liveCard.style.boxShadow = liveColor
    ? `0 0 0 1px ${liveColor}, 0 0 6px rgba(255,255,255,.04)`
    : "";
}

    function normalizeRaceStart_(value) {
      if (!value) return "";

      let v = String(value).trim();

      if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) &&
        !/[zZ]|[+-]\d{2}:\d{2}$/.test(v)
      ) {
        v += "-04:00";
      }

      return v;
    }

    function formatRaceStart_(value) {
      if (!value) return "";

      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";

      return d.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      });
    }

    const normalizedStart = normalizeRaceStart_(race.startTime);
    const startText = formatRaceStart_(normalizedStart);
    const networkText = String(race.network || "").trim();

    const topLine = [
      startText ? `Start: ${escapeHtml(startText)}` : "",
      networkText ? `TV: ${escapeHtml(networkText)}` : ""
    ].filter(Boolean).join(" • ");

    const flagDot = flagDot_(race.flag);

    const bottomLine =
      `Lap ${race.lap ?? "-"} • ${race.lapsToGo ?? "-"} to go${flagDot ? ` ${flagDot}` : ""}`;

    info.innerHTML = `
      <div>${topLine}</div>
      <div style="margin-top:2px;">${bottomLine}</div>
    `;

    const savedPlayer = loadPlayerName().trim().toLowerCase();
    const matchups = Array.isArray(data.matchups) ? [...data.matchups] : [];

    if (savedPlayer) {
      const idx = matchups.findIndex(m =>
        String(m.p1 || "").trim().toLowerCase() === savedPlayer ||
        String(m.p2 || "").trim().toLowerCase() === savedPlayer
      );

      if (idx > 0) {
        const mine = matchups.splice(idx, 1)[0];
        matchups.unshift(mine);
      }
    }

    box.innerHTML = matchups.map(m => {

      function driverLine(d){
        if(!d) return "";
        if(d.position == null) return `${escapeHtml(d.name || "")}`;
        return `${escapeHtml(d.name || "")} <span class="microMeta">P${d.position}</span>`;
      }

      const p1Drivers = (m.p1Drivers || []).length
        ? (m.p1Drivers || []).map(driverLine).join("<br>")
        : `<span class="microMeta">No drivers yet</span>`;

      const p2Drivers = (m.p2Drivers || []).length
        ? (m.p2Drivers || []).map(driverLine).join("<br>")
        : `<span class="microMeta">No drivers yet</span>`;

      const leaderLine =
        m.leader
          ? `${m.leader === "Tie" ? "Leader:" : `Leader: ${escapeHtml(m.leader)}`}`
          : `Leader: -`;

      const a1n = Number(m.p1Avg);
      const a2n = Number(m.p2Avg);
      const leadBar =
        (Number.isFinite(a1n) && Number.isFinite(a2n) && a1n > 0 && a2n > 0)
          ? `<div class="leadBar"><span style="width:${Math.max(8, Math.min(92, Math.round((a2n / (a1n + a2n)) * 100)))}%"></span></div>`
          : "";

      return `
        <div class="microBox liveMatchupCard"
             data-p1="${escapeAttr(String(m.p1 || "").trim().toLowerCase())}"
             data-p2="${escapeAttr(String(m.p2 || "").trim().toLowerCase())}"
             style="margin-bottom:6px;">

          <div class="matchupRow liveMatchupRow">
            <div class="side left">
              <div class="pName">
                <span class="nameWrap">
                  <span class="nameText">${escapeHtml(m.p1 || "")}</span>
                </span>
              </div>
              <div class="pMeta">${p1Drivers}</div>
              <div class="pMeta"><strong>Avg:</strong> ${m.p1Avg ?? "-"}</div>
            </div>

            <div class="vsBadge">VS</div>

            <div class="side right">
              <div class="pName">
                <span class="nameWrap">
                  <span class="nameText">${escapeHtml(m.p2 || "")}</span>
                </span>
              </div>
              <div class="pMeta">${p2Drivers}</div>
              <div class="pMeta"><strong>Avg:</strong> ${m.p2Avg ?? "-"}</div>
            </div>
          </div>

          ${leadBar}
          <div class="microMeta" style="margin-top:8px;font-weight:700;">
            ${leaderLine}
          </div>
        </div>
      `;
    }).join("");

    applyYouRowsNow_();

  }
  catch(err){
    box.textContent = "Live scoring unavailable.";
    console.log("Live matchups failed:", err);
  }
}

  /* ==========================================================
   Admin auth + transport helpers
   ========================================================== */

  function getAdminToken_() {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
  }

  function setAdminToken_(token) {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  function clearAdminToken_() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  async function adminFetch_(url, options = {}) {
    const token = getAdminToken_();
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    };

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || data?.message || `Request failed: ${res.status}`);
    }

    return data;
  }

  async function getAdminContext_() {
    if (_adminContext) return _adminContext;
    const cacheKey = "nascar_admin_context_cache";
    const tsKey = "nascar_admin_context_cache_ts";
    const ttlMs = 10 * 60 * 1000;

    try {
      const raw = sessionStorage.getItem(cacheKey);
      const ts = Number(sessionStorage.getItem(tsKey) || 0);

      if (raw && ts && (Date.now() - ts) < ttlMs) {
        _adminContext = JSON.parse(raw) || {};
        return _adminContext;
      }
    } catch {}

    const res = await adminFetch_("/api/admin-context", { cache: "no-store" });
    _adminContext = res.data || {};

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(_adminContext));
      sessionStorage.setItem(tsKey, String(Date.now()));
    } catch {}

    return _adminContext;
  }

  /* ==========================================================
   Admin overlay UI
   ========================================================== */

  function openAdminPin_() {
    const backdrop = document.getElementById("adminPinBackdrop");
    const modal = backdrop?.querySelector(".adminPinModal");
    const input = document.getElementById("adminPinInput");
    const status = document.getElementById("adminPinStatus");

    if (!backdrop || !input || !status) return;

    status.textContent = "";
    input.value = "";
    backdrop.hidden = false;

    if (!backdrop.dataset.bound) {
      backdrop.dataset.bound = "1";

      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          closeAdminPin_();
        }
      });

      if (modal) {
        modal.addEventListener("click", (e) => {
          e.stopPropagation();
        });
      }
    }

    setTimeout(() => input.focus(), 20);
  }

  function closeAdminPin_() {
    const backdrop = document.getElementById("adminPinBackdrop");
    if (backdrop) backdrop.hidden = true;
  }

  function openAdminOverlay_() {
    const el = document.getElementById("adminOverlay");
    if (el) el.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeAdminOverlay_() {
    const el = document.getElementById("adminOverlay");
    if (el) el.hidden = true;
    document.body.style.overflow = "";
  }

  function setAdminStatus_(id, msg, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--red)" : "var(--muted)";
  }

  function setAdminTab_(tabName) {
    document.querySelectorAll(".adminTab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.adminTab === tabName);
    });
    document.querySelectorAll(".adminTabPane").forEach(pane => {
      pane.classList.toggle("active", pane.id === `adminTab-${tabName}`);
    });
  }

  async function unlockAdmin_() {
    if (_adminUnlockInFlight) return
    const pin = String(document.getElementById("adminPinInput")?.value || "").trim();
    if (!pin) {
      setAdminStatus_("adminPinStatus", "Enter PIN.", true);
      return;
    }
    _adminUnlockInFlight = true;
    setAdminStatus_("adminPinStatus", "Slingshot...engage");
    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.token) {
        throw new Error(data?.error || "Invalid PIN");
      }
      setAdminToken_(data.token);
      _adminContext = null;
      await initAdminOverlay_();
      closeAdminPin_();
      openAdminOverlay_();
    } catch (err) {
      clearAdminToken_();
      _adminContext = null;
      setAdminStatus_("adminPinStatus", err.message || String(err), true);
    } finally {
      _adminUnlockInFlight = false;
    }
  }

  async function initAdminOverlay_() {
    const ctx = await getAdminContext_();
    const tSel = document.getElementById("adminTournamentSelect");
    const rSel = document.getElementById("adminRaceSelect");
    const fundsSel = document.getElementById("adminFundsPlayer");

    if (tSel && !tSel.dataset.bound) {
      tSel.dataset.bound = "1";
      tSel.addEventListener("change", () => {
        refreshAdminRaceOptions_();
      });
    }

    tSel.innerHTML = (ctx.tournaments || [])
      .map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`)
      .join("");

    fundsSel.innerHTML =
      `<option value="">Select player</option>` +
      (ctx.players || [])
        .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join("");

    tSel.value = String(ctx.currentTournamentId || ctx.tournaments?.[0]?.id || "");
    refreshAdminRaceOptions_();

    if (ctx.currentRaceId) {
      rSel.value = String(ctx.currentRaceId);
    }

    await loadVenmoBalance_();
  }

  function refreshAdminRaceOptions_() {
    const ctx = _adminContext || {};
    const tSel = document.getElementById("adminTournamentSelect");
    const rSel = document.getElementById("adminRaceSelect");
    const tournamentId = Number(tSel?.value || 0);

    const races = (ctx.races || []).filter(r => Number(r.tournamentId) === tournamentId);
    rSel.innerHTML = races.map(r => `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join("");

    renderAdminSeeds_();
  }

  function renderAdminSeeds_() {
    const ctx = _adminContext || {};
    const grid = document.getElementById("adminSeedsGrid");
    if (!grid) return;

    const tournamentId = Number(document.getElementById("adminTournamentSelect")?.value || 0);
    const players = [...(ctx.players || [])];

    function renderSeedRow(seed) {
      const options = [`<option value="">Select player</option>`]
        .concat(players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
        .join("");

      return `
        <div class="adminSeedRow">
          <div class="adminSeedNum">#${seed}</div>
          <select class="adminSeedSelect seed-player-select" data-seed="${seed}" data-tournament="${tournamentId}">
            ${options}
          </select>
        </div>
      `;
    }

    let html = "";

    for (let i = 1; i <= 8; i++) {
      html += renderSeedRow(i);
      html += renderSeedRow(17 - i);
    }

    grid.innerHTML = html;

    document.querySelectorAll(".seed-player-select").forEach(select => {
      select.addEventListener("change", () => {
        updateSeedDropdowns_();
        initAdminSeedWheel_(false);
      });
    });

    updateSeedDropdowns_();
    initAdminSeedWheel_(false);
  }

  function updateSeedDropdowns_() {
    const selects = [...document.querySelectorAll(".seed-player-select")];
    if (!selects.length) return;

    const players = [...((_adminContext && _adminContext.players) || [])];
    const selectedIds = selects
      .map(s => String(s.value || "").trim())
      .filter(Boolean);

    selects.forEach(select => {
      const currentValue = String(select.value || "").trim();

      const allowedPlayers = players.filter(p => {
        const pid = String(p.id);
        return pid === currentValue || !selectedIds.includes(pid);
      });

      select.innerHTML =
        `<option value="">Select player</option>` +
        allowedPlayers
          .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
          .join("");

      select.value = currentValue;
    });
  }

  function adminSeedWheelPlayers_() {
    return [...(((_adminContext && _adminContext.players) || []))]
      .filter(p => p && p.id != null && p.name);
  }

  function adminSeedWheelRandomInt_(max) {
    if (!Number.isInteger(max) || max <= 0) return 0;

    const cryptoObj = window.crypto || window.msCrypto;
    if (cryptoObj?.getRandomValues) {
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      do {
        cryptoObj.getRandomValues(buf);
      } while (buf[0] >= limit);
      return buf[0] % max;
    }

    return Math.floor(Math.random() * max);
  }

  function adminSeedWheelRandomFloat_() {
    return adminSeedWheelRandomInt_(1000000) / 1000000;
  }

  function adminSeedWheelGridOrder_() {
    const seeds = [];
    for (let i = 1; i <= 8; i++) {
      seeds.push(i, 17 - i);
    }
    return seeds;
  }

  function shuffleAdminSeedWheelPlayers_(players) {
    const arr = [...players];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = adminSeedWheelRandomInt_(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function selectedAdminSeedIds_() {
    return new Set([...document.querySelectorAll(".adminSeedSelect")]
      .map(sel => String(sel.value || "").trim())
      .filter(Boolean));
  }

  function nextOpenAdminSeed_() {
    for (let seed = 1; seed <= 16; seed++) {
      const sel = document.querySelector(`.adminSeedSelect[data-seed="${seed}"]`);
      if (sel && !String(sel.value || "").trim()) return seed;
    }
    return null;
  }

  function setAdminSeedDropdown_(seed, player) {
    const sel = document.querySelector(`.adminSeedSelect[data-seed="${seed}"]`);
    if (!sel || !player) return false;

    sel.value = String(player.id);
    updateSeedDropdowns_();
    return true;
  }

  function initAdminSeedWheel_(clearSeedSelections) {
    const canvas = document.getElementById("adminSeedWheelCanvas");
    if (!canvas) return;

    stopAdminSeedWheelTicks_();
    if (_adminSeedWheel?.newestTimer) {
      clearTimeout(_adminSeedWheel.newestTimer);
    }

    if (clearSeedSelections) {
      document.querySelectorAll(".adminSeedSelect").forEach(sel => {
        sel.value = "";
      });
      updateSeedDropdowns_();
    }

    const selectedIds = selectedAdminSeedIds_();
    const remaining = shuffleAdminSeedWheelPlayers_(adminSeedWheelPlayers_())
      .filter(p => !selectedIds.has(String(p.id)));

    _adminSeedWheel = {
      remaining,
      results: readAdminSeedWheelResults_(),
      rotation: 0,
      spinning: false,
      tickTimer: null,
      audioCtx: null,
      highlightPlayerId: null,
      newestSeed: null,
      newestTimer: null
    };

    drawAdminSeedWheel_();
    renderAdminSeedWheelStatus_();
  }

  function readAdminSeedWheelResults_() {
    const players = adminSeedWheelPlayers_();
    const byId = new Map(players.map(p => [String(p.id), p]));
    const results = [];

    for (let seed = 1; seed <= 16; seed++) {
      const sel = document.querySelector(`.adminSeedSelect[data-seed="${seed}"]`);
      const id = String(sel?.value || "").trim();
      const player = byId.get(id);
      if (player) results.push({ seed, player });
    }

    return results;
  }

  function renderAdminSeedWheelStatus_() {
    const state = _adminSeedWheel;
    const target = document.getElementById("adminSeedWheelTarget");
    const results = document.getElementById("adminSeedWheelResults");
    const hint = document.getElementById("adminSeedWheelHint");
    const canvas = document.getElementById("adminSeedWheelCanvas");
    if (!state || !target || !results) return;

    const nextSeed = nextOpenAdminSeed_();
    const ready = Boolean(!state.spinning && nextSeed && state.remaining.length);
    const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
    target.textContent = nextSeed
      ? `Spinning for Seed #${nextSeed}`
      : "Let’s go racin’ boys!";

    const resultBySeed = new Map(state.results.map(row => [Number(row.seed), row.player]));
    results.innerHTML = adminSeedWheelGridOrder_()
      .map(seed => {
        const player = resultBySeed.get(seed);
        const classes = [
          "adminSeedWheelResult",
          player ? "filled" : "empty",
          seed === nextSeed ? "current" : "",
          seed === state.newestSeed ? "newest" : ""
        ].filter(Boolean).join(" ");
        const name = player ? escapeHtml(player.name) : "Empty";
        return `
          <div class="${classes}">
            <span>#${seed}</span>
            <b>${name}</b>
          </div>
        `;
      })
      .join("");

    if (hint) {
      hint.hidden = !ready;
      hint.textContent = state.remaining.length === 1
        ? `${isTouch ? "Tap" : "Click"} wheel to fill final seed`
        : `${isTouch ? "Tap" : "Click"} wheel to spin`;
    }

    if (canvas) {
      canvas.classList.toggle("isClickable", ready);
    }
  }

  function adminSeedWheelLabelFontSize_(ctx, name, preferredSize, minSize, maxWidth) {
    const clean = String(name || "").trim();
    let size = preferredSize;

    while (size > minSize) {
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      if (ctx.measureText(clean).width <= maxWidth) return size;
      size -= 1;
    }

    return minSize;
  }

  function drawAdminSeedWheel_() {
    const state = _adminSeedWheel;
    const canvas = document.getElementById("adminSeedWheelCanvas");
    if (!state || !canvas) return;

    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 12;
    ctx.clearRect(0, 0, size, size);

    const players = state.remaining;
    if (!players.length) {
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const slice = players.length ? (Math.PI * 2) / players.length : Math.PI * 2;
    const colors = ["#e4002b", "#ffd659", "#007ac2", "#101820", "#ffffff"];
    const winnerColor = "#23b26d";
    const labelFontSize = Math.max(34, Math.min(58, radius / (players.length > 12 ? 8.5 : players.length > 8 ? 7.5 : 6)));

    players.forEach((player, i) => {
      const start = state.rotation + i * slice;
      const end = start + slice;
      const isWinner = String(player.id) === String(state.highlightPlayerId);
      const fill = isWinner ? winnerColor : colors[i % colors.length];

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(2,11,18,.72)";
      ctx.lineWidth = 2;
      ctx.stroke();

      const mid = start + slice / 2;

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(mid);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = fill === "#ffd659" || fill === "#ffffff" || isWinner ? "#020b12" : "#ffffff";
      const maxWidth = radius * 0.72;
      const name = String(player.name || "").trim();
      const fontSize = adminSeedWheelLabelFontSize_(ctx, name, labelFontSize, 18, maxWidth);
      ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
      ctx.fillText(name, radius - 28, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(center, center, Math.max(48, radius * 0.13), 0, Math.PI * 2);
    ctx.fillStyle = "#020b12";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#ffd659";
    ctx.font = `900 ${Math.max(24, radius * 0.075)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SEEDS", center, center);
  }

  function tickAdminSeedWheel_() {
    const state = _adminSeedWheel;
    if (!state) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      state.audioCtx = state.audioCtx || new AudioContext();
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 760;
      gain.gain.setValueAtTime(0.0001, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, state.audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      osc.start();
      osc.stop(state.audioCtx.currentTime + 0.055);
    } catch {}
  }

  function stopAdminSeedWheelTicks_() {
    const state = _adminSeedWheel;
    if (state?.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }

  function spinAdminSeedWheel_() {
    const state = _adminSeedWheel || (initAdminSeedWheel_(false), _adminSeedWheel);
    if (!state || state.spinning) return;

    const nextSeed = nextOpenAdminSeed_();
    if (!nextSeed) {
      renderAdminSeedWheelStatus_();
      return;
    }

    if (state.remaining.length < 1) {
      renderAdminSeedWheelStatus_();
      return;
    }

    if (state.remaining.length === 1) {
      finishAdminSeedWheelSpin_(nextSeed, state.remaining[0], state);
      return;
    }

    const activeState = state;
    const winnerIndex = adminSeedWheelRandomInt_(state.remaining.length);
    const winner = state.remaining[winnerIndex];
    const slice = (Math.PI * 2) / state.remaining.length;
    const pointerAngle = -Math.PI / 2;
    const landingOffset = 0.04 + adminSeedWheelRandomFloat_() * 0.92;
    const winnerLandingAngle = winnerIndex * slice + slice * landingOffset;
    const current = state.rotation;
    const normalizedCurrent = ((current % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const desiredRotation = pointerAngle - winnerLandingAngle;
    const normalizedDesired = ((desiredRotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const delta = ((normalizedDesired - normalizedCurrent) + Math.PI * 2) % (Math.PI * 2);
    const totalRotation = delta + Math.PI * 2 * (7 + adminSeedWheelRandomInt_(4));
    const startRotation = state.rotation;
    const started = performance.now();
    const duration = 6000;

    state.spinning = true;
    state.highlightPlayerId = null;
    renderAdminSeedWheelStatus_();
    stopAdminSeedWheelTicks_();
    state.tickTimer = setInterval(tickAdminSeedWheel_, 92);

    function frame(now) {
      if (_adminSeedWheel !== activeState) return;

      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3.4);
      state.rotation = startRotation + totalRotation * eased;
      drawAdminSeedWheel_();

      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }

      state.rotation = startRotation + totalRotation;
      finishAdminSeedWheelSpin_(nextSeed, winner, activeState);
    }

    requestAnimationFrame(frame);
  }

  function finishAdminSeedWheelSpin_(seed, winner, expectedState) {
    const state = expectedState || _adminSeedWheel;
    if (!state || _adminSeedWheel !== state || !winner) return;

    stopAdminSeedWheelTicks_();
    state.spinning = true;
    state.highlightPlayerId = winner.id;
    state.newestSeed = seed;
    setAdminSeedDropdown_(seed, winner);
    state.results = readAdminSeedWheelResults_();

    if (state.newestTimer) {
      clearTimeout(state.newestTimer);
      state.newestTimer = null;
    }
    state.newestTimer = window.setTimeout(() => {
      if (_adminSeedWheel !== state || state.newestSeed !== seed) return;
      state.newestSeed = null;
      renderAdminSeedWheelStatus_();
    }, 1800);

    drawAdminSeedWheel_();
    renderAdminSeedWheelStatus_();

    window.setTimeout(() => {
      if (_adminSeedWheel !== state) return;

      state.remaining = state.remaining.filter(p => String(p.id) !== String(winner.id));
      state.highlightPlayerId = null;
      state.spinning = false;
      drawAdminSeedWheel_();
      renderAdminSeedWheelStatus_();

      const nextSeed = nextOpenAdminSeed_();
      if (nextSeed && state.remaining.length === 1) {
        window.setTimeout(() => finishAdminSeedWheelSpin_(nextSeed, state.remaining[0], state), 500);
      }
    }, 850);
  }

  function ensureAdminSeedWheelBackdropInBody_() {
    const backdrop = document.getElementById("adminSeedWheelBackdrop");
    if (backdrop && backdrop.parentElement !== document.body) {
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function openAdminSeedWheel_() {
    const backdrop = ensureAdminSeedWheelBackdropInBody_();
    if (!backdrop) return;

    backdrop.hidden = false;
    initAdminSeedWheel_(false);
  }

  function closeAdminSeedWheel_() {
    const backdrop = document.getElementById("adminSeedWheelBackdrop");
    if (backdrop) backdrop.hidden = true;
    stopAdminSeedWheelTicks_();
  }

  function resetAdminSeedWheel_() {
    initAdminSeedWheel_(true);
  }
  
  async function refreshAfterAdminChange_() {
    _adminContext = null;

    try {
      sessionStorage.removeItem("nascar_admin_context_cache");
      sessionStorage.removeItem("nascar_admin_context_cache_ts");
    } catch {}

    await refreshActiveView();

    try {
      await initAdminOverlay_();
    } catch (err) {
      console.log("Admin overlay refresh failed:", err);
    }
  }

  async function runAdminRaceOp_(url, statusId, label) {
  const raceId = Number(document.getElementById("adminRaceSelect")?.value || 0);
  if (!raceId) {
    setAdminStatus_(statusId, "Pick a race first.", true);
    return;
  }

  setAdminStatus_(statusId, `${label}...`);
  try {
    const data = await adminFetch_(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raceId })
    });

    setAdminStatus_(statusId, data.message || `${label} done.`);
    /*
    if (url === "/api/import-qualifying") {
      alert(`Qualifying response:\n\n${JSON.stringify(data, null, 2)}`);
    }

    if (url === "/api/import-results") {
      alert(`Results response:\n\n${JSON.stringify(data, null, 2)}`);
    }
    */
if (Array.isArray(data.data) && data.data.length) {

  const msg = data.data.map((row, i) => {

    if (row.player_name && row.assigned_numbers) {
      return `${i + 1}. ${row.player_name} ${row.assigned_numbers}`;
    }

    if (row.driver_name) {
      return `${i + 1}. ${row.driver_name}`;
    }

    if (row.player_name && row.seed) {
      return `#${row.seed}. ${row.player_name}`;
    }

    return `${i + 1}. ${JSON.stringify(row)}`;

  }).join("\n");

  alert(`${data.message || label}\n\n${msg}`);
}

await refreshAfterAdminChange_();
  } catch (err) {
    setAdminStatus_(statusId, err.message || String(err), true);
  }
}

  async function saveAdminSeeds_() {
    const tournamentId = Number(document.getElementById("adminTournamentSelect")?.value || 0);
    if (!tournamentId) {
      setAdminStatus_("adminSeedsStatus", "Pick a tournament first.", true);
      return;
    }

    const rows = [...document.querySelectorAll(".adminSeedSelect")].map(sel => ({
      seed: Number(sel.dataset.seed),
      playerId: Number(sel.value || 0)
    }));

    if (rows.some(r => !r.playerId)) {
      setAdminStatus_("adminSeedsStatus", "Every seed slot needs a player.", true);
      return;
    }

    const unique = new Set(rows.map(r => r.playerId));
    if (unique.size !== rows.length) {
      setAdminStatus_("adminSeedsStatus", "Each player can only be used once.", true);
      return;
    }

    setAdminStatus_("adminSeedsStatus", "Saving seeds...");
    try {
      const data = await adminFetch_("/api/save-round1-seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId, seeds: rows })
      });
      setAdminStatus_("adminSeedsStatus", data.message || "Seeds saved.");
      await refreshAfterAdminChange_();
    } catch (err) {
      setAdminStatus_("adminSeedsStatus", err.message || String(err), true);
    }
  }

  async function addFunds_() {
    const playerId = Number(document.getElementById("adminFundsPlayer")?.value || 0);
    const amount = Number(document.getElementById("adminFundsAmount")?.value || 0);

    if (!playerId) {
      setAdminStatus_("adminFundsStatus", "Pick a player.", true);
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setAdminStatus_("adminFundsStatus", "Enter a valid amount.", true);
      return;
    }

    setAdminStatus_("adminFundsStatus", "Adding funds...");
    try {
      const data = await adminFetch_("/api/add-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, amount })
      });
      setAdminStatus_("adminFundsStatus", data.message || "Funds added.");
      document.getElementById("adminFundsAmount").value = "";
      _playerDues = null;
      if (activeView === "mymatchup") loadDues();
      await loadVenmoBalance_();
    } catch (err) {
      setAdminStatus_("adminFundsStatus", err.message || String(err), true);
    }
  }

  async function markPaidOut_() {
    const playerId = Number(document.getElementById("adminFundsPlayer")?.value || 0);
    const amount = Number(document.getElementById("adminFundsAmount")?.value || 0);

    if (!playerId) {
      setAdminStatus_("adminFundsStatus", "Pick a player.", true);
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setAdminStatus_("adminFundsStatus", "Enter a valid amount.", true);
      return;
    }

    setAdminStatus_("adminFundsStatus", "Marking payout...");
    try {
      const data = await adminFetch_("/api/mark-paidout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, amount })
      });

      setAdminStatus_("adminFundsStatus", data.message || "Payout marked.");
      document.getElementById("adminFundsAmount").value = "";
      _playerDues = null;
      if (activeView === "mymatchup") loadDues();
      await loadVenmoBalance_();
    } catch (err) {
        setAdminStatus_("adminFundsStatus", err.message || String(err), true);
    }  
  }

  async function showWhoIOwe_() {
    setAdminStatus_("adminFundsStatus", "Building payout report...");

    try {
      const data = await adminFetch_("/api/payout-report", {
        method: "GET"
      });

      const rows = Array.isArray(data.data) ? data.data : [];

      if (!rows.length) {
        setAdminStatus_("adminFundsStatus", "Nobody has a negative balance. Miracles do happen.");
        alert("Nobody has a negative balance. You currently owe nobody.");
        return;
      }

      const msg = rows.map((row) => {
        const owed = Number(row.remainingToPayout || 0).toFixed(2);
        return `${row.name} — $${owed}`;
      }).join("\n");

      setAdminStatus_("adminFundsStatus", `Found ${rows.length} player(s) with negative balance.`);
      alert(`Players you owe:\n\n${msg}`);
    } catch (err) {
      setAdminStatus_("adminFundsStatus", err.message || String(err), true);
    }
  }
  
  async function loadVenmoBalance_() {
    try {
      const data = await adminFetch_("/api/venmo-balance", {
        method: "GET"
      });

      const amount = Number(data.venmoBalance || 0).toFixed(2);
      const btn = document.getElementById("venmoBalanceBtn");

      if (btn) {
        btn.textContent = `Venmo: $${amount}`;
      }
    } catch (err) {
      const btn = document.getElementById("adminVenmoBalanceBtn");
      if (btn) {
        btn.textContent = "Venmo: ERROR";
      }
      console.error("Venmo balance load failed:", err);
    }
  }
  
  async function clearSeeds_() {
    const tournamentId = Number(document.getElementById("adminTournamentSelect")?.value || 0);
    if (!tournamentId) {
      alert("Select a tournament first.");
      return;
    }

    if (!confirm("Clear ALL seeds for this tournament?")) return;

    try {
      const data = await adminFetch_("/api/clear-seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId })
      });

      alert(data.message || "Seeds cleared.");
      await refreshAfterAdminChange_();
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  async function uploadBuschGirls_() {
    const folder = String(document.getElementById("buschFolderSelect")?.value || "").trim();
    const input = document.getElementById("buschUploadInput");
    const status = document.getElementById("buschUploadStatus");

    const files = Array.from(input?.files || []);

    if (!folder) {
      setAdminStatus_("buschUploadStatus", "Pick a folder.", true);
      return;
    }

    if (!files.length) {
      setAdminStatus_("buschUploadStatus", "Choose at least one photo.", true);
      return;
    }

    setAdminStatus_("buschUploadStatus", `Uploading ${files.length} photo(s)...`);

    try {
      for (let i = 0; i < files.length; i++) {
        const form = new FormData();
        form.append("folder", folder);
        form.append("file", files[i]);

        await adminFetch_("/api/upload-buschgirl", {
          method: "POST",
          body: form
        });

        setAdminStatus_(
          "buschUploadStatus",
          `Uploaded ${i + 1} of ${files.length}...`
        );
      }

      input.value = "";
      buschGirls = [];
      buschQueue = [];
      await loadBuschGirls();

      setAdminStatus_("buschUploadStatus", `Uploaded ${files.length} photo(s).`);
    } catch (err) {
      setAdminStatus_("buschUploadStatus", err.message || String(err), true);
    }
  }

  async function clearAssignments_() {
    const raceId = Number(document.getElementById("adminRaceSelect")?.value || 0);
    if (!raceId) {
      alert("Select a race first.");
      return;
    }

    if (!confirm("Clear all assignments for this race?")) return;

    const res = await fetch(`/api/clear-assignments?raceId=${raceId}`);
    const data = await res.json();

    alert(data.message || "Assignments cleared.");
    await refreshAfterAdminChange_();
  }

  /* ==========================================================
   Shared storage + navigation helpers
   ========================================================== */

  async function getPlayerList_(){
    if (_playerList) return _playerList;

    try{
      const duesMap = await getPlayerDues_();
      const fromDues = Object.keys(duesMap || {})
        .map(x => String(x || "").trim())
        .filter(Boolean)
        .sort((a,b) => a.localeCompare(b));
      if (fromDues.length) {
        _playerList = fromDues;
        return _playerList;
      }
    }catch(e){}

    try{
      const stats = await getPlayerStats_();
      const rows = Array.isArray(stats?.overall) ? stats.overall : [];
      const names = [...new Set(
        rows.map(r => String(r?.Name || r?.name || "").trim()).filter(Boolean)
      )].sort((a,b) => a.localeCompare(b));
      _playerList = names;
      return _playerList;
    }catch(e){}

    _playerList = [];
    return _playerList;
  }

  function setActiveNav(which){
    const map = {
      current: "nav-race",
      live: "nav-live",
      mymatchup: "nav-me",
      standings: "nav-stats",
      dues: "nav-dues",
      bracket: "nav-bracket",
      hub: "nav-hub"
    };

    Object.values(map).forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove("active");
    });

    const btn = document.getElementById(map[which]);
    if (btn) btn.classList.add("active");
  }

  function persistHScroll(selector, storageKey){
    const el = document.querySelector(selector);
    if(!el) return;

    requestAnimationFrame(() => {
      const saved = Number(localStorage.getItem(storageKey) || 0);
      if (Number.isFinite(saved) && saved > 0) el.scrollLeft = saved;
    });

    let t = null;
    el.addEventListener("scroll", () => {
      if (t) return;
      t = requestAnimationFrame(() => {
        localStorage.setItem(storageKey, String(el.scrollLeft || 0));
        t = null;
      });
    }, { passive:true });

    window.addEventListener("beforeunload", () => {
      localStorage.setItem(storageKey, String(el.scrollLeft || 0));
    });
  }

  function showView(which) {
    if (!spoilersOn_() && which === "bracket") which = "current";

    activeView = which;
    setActiveNav(which);
    localStorage.setItem(VIEW_KEY, which);

    views.forEach(v => {
      const el = document.getElementById("view-" + v);
      if (el) el.style.display = (v === which) ? "block" : "none";
    });

    if (which === "current" && !_currentLoaded) {
      _currentLoaded = true;
      loadCurrent();
    }

    if (which === "standings" && !_standingsLoaded) {
      _standingsLoaded = true;
      loadStandings();
    }

    if (which === "hub" && !_hubLoaded) {
      _hubLoaded = true;
      loadHub_();
    }

    if (which === "mymatchup" && !_myMatchupLoaded) {
      _myMatchupLoaded = true;
      loadMyMatchup();
      loadDues();
    }

    if (which === "bracket" && !_bracketLoaded) {
      _bracketLoaded = true;
      loadBracket();
    }

    if (which === "live") {
      loadLiveMatchups();
      startLivePolling_();
    }
  }

  function refreshActiveView() {
    _playerRaceData = null;
    _playerDues = null;
    _playerList = null;
    _cache_standings = null;
    _currentLoaded = false;
    _standingsLoaded = false;
    _duesLoaded = false;
    _myMatchupLoaded = false;
    _bracketLoaded = false;
    _hubLoaded = false;
    _gfStartMs = null;
    renderGreenFlagCountdown_();

    if (activeView === "hub") {
      _hubLoaded = true;
      loadHub_();
    }

    if (activeView === "current") {
      _currentLoaded = true;
      loadCurrent();
    } else if (activeView === "standings") {
      _standingsLoaded = true;
      loadStandings();
    } else if (activeView === "mymatchup") {
      _myMatchupLoaded = true;
      loadMyMatchup();
      loadDues();
    } else if (activeView === "bracket") {
      _bracketLoaded = true;
      loadBracket();
    } else if (activeView === "live") {
      loadLiveMatchups();
    }
  }

  function savePlayerName(name) {
    localStorage.setItem(STORAGE_KEY, String(name || ""));
    setWelcome();
  }

  function loadPlayerName() {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  }

  function hasPlayerName() {
    return !!loadPlayerName();
  }

  function clearSavedAndReset() {
    localStorage.removeItem(STORAGE_KEY);

    const gp = document.getElementById("globalPlayer");
    if (gp) {
      const ph = gp.querySelector("#playerPlaceholder");
      if (ph) ph.hidden = false;
      gp.value = "";
      autoSizePlayerSelect_(gp);
    }

    setWelcome();
    applyYouRowsNow_();

    if (activeView === "mymatchup") {
      const out = document.getElementById("mmStatus");
      if (out) out.textContent = "";
    }

    if (activeView === "dues") {
      const out = document.getElementById("duesStatus");
      if (out) out.textContent = "";
    }
  }

  function renderFutureRaceMessage_(area, raceData){
    const header = document.getElementById("currentHeader");
    const sub = document.getElementById("currentSub");

    if (header) {
      header.textContent = raceData?.race || "Race";
    }

    if (sub) {
      const tour = raceData?.tournament ?? "";
      const round = raceData?.currentRound ?? raceData?.round ?? "";
      const roundText =
        round === "" ? "" :
        (Number(round) === 4 ? "Final" : `Rnd ${round}`);

      sub.textContent =
        (tour ? `Tourney ${tour}` : "") +
        (roundText ? `${tour ? " · " : ""}${roundText}` : "");
    }

    if (area) {
      area.innerHTML = `
        <div class="microBox" style="margin-top:10px;">
          <div class="microTitle">Back to the future?</div>
          <div class="microMeta" style="color: var(--muted); font-weight:700;">
            This race ain’t even fuckin’ started, you mouth-breathin’ dipshit.<br><br>
            The haulers are still sittin’ in the lot, tires ain’t even warm, drivers are prolly still
            scratchin’ their balls and arguin’ over who gets the last Moon Pie, and your dumb redneck
            ass is already hollerin’ for lap times like a coonhound that just seen a squirrel.<br><br>
            The goddamn sun ain’t even set on yesterday’s bullshit and you’re out here demandin’
            results like you think time bends over for your broke-ass attention span.<br><br>
            Go choke on a chicken bone, slam another Natty Light, and sit your impatient hillbilly
            carcass down. The checkered flag don’t give a rat’s ass about your toddler tantrum.<br><br>
            We’ll let ya know when the real men start racin’. Until then… shut the entire fuck up.
          </div>
        </div>
      `;
    }
  }

  function setWelcome() {
    const w = document.getElementById("welcomeName");
    const name = loadPlayerName();
    if (!w) return;

    const messages = {
      "Beau": "Helleau, Beau.",
      "Bob": "Nebraska sucks 🤘🏻",
      "Brett": "Hey, commish!",
      "Chris": "Hello, Edward.",
      "Don": "Sloan Broadwell!",
      "Jason": "You're still here?",
      "Justin": "Hi, Brett's brother.",
      "Nate C.": "Earl's gotta die!",
      "Nate M.": "Ol' Boomhauer",
      "Nick": "Got syrup?",
      "Pat": "Go inspect something.",
      "Rob": "Aye, Aye Capt 🫡",
      "Russ": "DSI President",
      "Stacy": "East bound and down!",
      "Steven": "I need Velo's!",
      "Tyler": "Navel Bush, huh?"
    };

    if (!name) {
      w.textContent = "👻";
      return;
    }

    w.textContent = messages[name] || `Welcome ${name}.`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function populatePlayerDropdowns(playerList) {
    const gp = document.getElementById("globalPlayer");
    if (!gp) return;

    const options = [
      `<option value="" id="playerPlaceholder" disabled>Who the fuck are you?</option>`
    ]
      .concat(playerList.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`))
      .join("");

    gp.innerHTML = options;

    const ph = gp.querySelector("#playerPlaceholder");
    const saved = loadPlayerName();

    if (saved) {
      gp.value = saved;
      if (ph) ph.hidden = true;
    } else {
      gp.value = "";
      if (ph) {
        ph.hidden = false;
        ph.selected = true;
      }
    }

    autoSizePlayerSelect_(gp);

    gp.onchange = async () => {
      const name = String(gp.value || "").trim();
      if (!name) return;
      if (ph) ph.hidden = true;

      savePlayerName(name);
      refillQueue();
      setWelcome();
      checkDuesNag_();
      autoSizePlayerSelect_(gp);

      // update row highlighting everywhere immediately
      applyYouRowsNow_();

      // refresh the active view so selected-player ordering updates immediately
      if (activeView === "current") {
        await loadSelectedRace_();
      } else if (activeView === "mymatchup") {
        await loadMyMatchup();
        await loadDues();
      } else if (activeView === "live") {
        await loadLiveMatchups();
      } else if (activeView === "standings") {
        await loadStandings();
      } else if (activeView === "bracket") {
        await loadBracket();
      }
    };
  }

  function formatDriversOrNumbers(driversArr, numsArr){
    const d1 = (driversArr && driversArr[0] != null) ? String(driversArr[0]).trim() : "";
    const d2 = (driversArr && driversArr[1] != null) ? String(driversArr[1]).trim() : "";

    const n1 = (numsArr && numsArr[0] != null) ? String(numsArr[0]).trim() : "";
    const n2 = (numsArr && numsArr[1] != null) ? String(numsArr[1]).trim() : "";

    const hasDrivers = !!(d1 || d2);
    const hasNums = !!(n1 || n2);

    if (!hasDrivers && !hasNums) return "";
    if (!hasDrivers && hasNums){
      return `Numbers: ${[n1, n2].filter(Boolean).join(", ")}`;
    }

    function fmtPair(num, drv){
      const numClean = String(num || "").trim();
      const drvClean = String(drv || "").trim();
      if (!numClean && !drvClean) return "";
      if (numClean && drvClean) return `(${numClean}) ${drvClean}`;
      if (drvClean) return drvClean;
      return `(${numClean})`;
    }

    return [fmtPair(n1, d1), fmtPair(n2, d2)].filter(Boolean).join(", ");
  }

  function applyYouRowsNow_(){
    const you = loadPlayerName().trim().toLowerCase();

    document.querySelectorAll("#matchupsArea .matchupCard").forEach(card => {
      const isYou = !!you && (
        (card.dataset.p1 || "") === you ||
        (card.dataset.p2 || "") === you
      );
      card.classList.toggle("youRow", isYou);
    });

    document.querySelectorAll("#liveMatchups .liveMatchupCard").forEach(card => {
      const isYou = !!you && (
        (card.dataset.p1 || "") === you ||
        (card.dataset.p2 || "") === you
      );
      card.classList.toggle("youRow", isYou);
    });

    document.querySelectorAll("#standingsArea .statsRow").forEach(row => {
      const nameEl = row.querySelector(".statsName");
      const nm = String(nameEl?.textContent || "").trim().toLowerCase();
      const isYou = !!you && nm === you;
      row.classList.toggle("youRow", isYou);
    });
  }

  function raceKey_(tournament, race){
    return String(tournament || "").trim() + "||" + String(race || "").trim();
  }

  function setRaceSelectValue_(tournament, race){
    const sel = document.getElementById("raceSelect");
    if(!sel) return;
    const key = raceKey_(tournament, race);
    _raceSelectIsProgrammatic = true;
    try{
      sel.value = key;
      autoSizeRaceSelect_(sel);
    } finally {
      _raceSelectIsProgrammatic = false;
    }
  }

  async function initRaceSelect_(){
    if(_raceSelectWiringDone) return;
    _raceSelectWiringDone = true;

    const sel = document.getElementById("raceSelect");
    if(!sel) return;

    sel.innerHTML = `<option value="">Loading races...</option>`;
    autoSizeRaceSelect_(sel);

    try{
      const blob = await getPlayerRaceData_();
      const list = Array.isArray(blob?.raceList) ? blob.raceList : [];
      RACE_LIST = list;

      sel.innerHTML = RACE_LIST.map(r => {
        const t = r.tournament;
        const race = r.race;
        const label = `${race}`;
        return `<option value="${escapeHtml(raceKey_(t, race))}">${escapeHtml(label)}</option>`;
      }).join("") || `<option value="">No races</option>`;

      autoSizeRaceSelect_(sel);

      sel.addEventListener("change", () => {
        if(_raceSelectIsProgrammatic) return;
        autoSizeRaceSelect_(sel);
        loadSelectedRace_();
      });
    }catch(e){
      sel.innerHTML = `<option value="">Races unavailable</option>`;
      sel.disabled = true;
    }
  }

  async function renderMatchupsInto_(data){
    const header = document.getElementById("currentHeader");
    const sub = document.getElementById("currentSub");
    const area = document.getElementById("matchupsArea");

    header.textContent = data.race || "Race";
    const tour  = data.tournament ?? "";
    const round = data.currentRound ?? data.round ?? "";
    const roundText =
      round === "" ? "" :
      (Number(round) === 4 ? "Final" : `Rnd ${round}`);

    sub.innerHTML = `<div>${escapeHtml(
      `Tourney ${tour}` + (roundText ? ` · ${roundText}` : "")
    )}</div>`;

    area.innerHTML = "";

    const you = loadPlayerName().trim().toLowerCase();
    const spoilersOn = spoilersOn_();
    const norm = (s) => String(s ?? "").trim().toLowerCase();
    const isCurrentRace =
      ALL_MATCHUPS?.current &&
      norm(ALL_MATCHUPS.current.race) === norm(data.race) &&
      String(ALL_MATCHUPS.current.tournament || "").trim() === String(data.tournament || "").trim();

    if (!spoilersOn && isCurrentRace){
      area.innerHTML = `
        <div class="microBox" style="margin-top:10px;">
          <div class="microTitle">Spoilers are OFF, you fragile fantasy princess.</div>
          <div class="microMeta" style="color: var(--muted); font-weight:700;">
            Current matchups? Hidden like a crew chief's real strategy sheet.<br><br>
            This is the current race, dipshit—pick a race that's already wrecked, finished, and posted from the dropdown if you want to see who your drivers are up against.<br><br>
            We're not spoiling the live action just because Justin DVR'd the race or was too busy pretending to catch bad guys taller than him to watch the Big One turn the field into scrap metal.<br><br>
            Some of us still like the thrill of not knowing if your pick survived the restart carnage or got parked on lap 12 thanks to fuel mileage roulette.<br><br>
            Quit hammering refresh like it's going to magically un-hide the results. Go select a completed race, or sit tight and pretend the caution didn't just fuck your entire lineup.<br><br>
            The checkered flag drops when it drops. Not when your patience does.
          </div>
        </div>
      `;
      return;
    }

    const showPastAvgs = spoilersOn && !isCurrentRace;
    const fmtAvg = (n) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return "";
      return x.toFixed(1).replace(/\.0$/, "");
    };

    // reorder only for CURRENT race, same idea as live tab
    const matchups = Array.isArray(data.matchups) ? [...data.matchups] : [];

    if (you) {
      const idx = matchups.findIndex(m =>
        norm(m.p1) === you || norm(m.p2) === you
      );

      if (idx > 0) {
        const mine = matchups.splice(idx, 1)[0];
        matchups.unshift(mine);
      }
    }

    for (const m of matchups) {
      const card = document.createElement("div");
      const isYou =
        you &&
        (
          norm(m.p1) === you ||
          norm(m.p2) === you
        );

      card.className = "matchupCard" + (isYou ? " youRow" : "");
      card.dataset.p1 = norm(m.p1);
      card.dataset.p2 = norm(m.p2);

      function metaHtml_(driversArr, numsArr){
        const d1 = (driversArr && driversArr[0] != null) ? String(driversArr[0]).trim() : "";
        const d2 = (driversArr && driversArr[1] != null) ? String(driversArr[1]).trim() : "";
        const n1 = (numsArr && numsArr[0] != null) ? String(numsArr[0]).trim() : "";
        const n2 = (numsArr && numsArr[1] != null) ? String(numsArr[1]).trim() : "";

        const raceWinner = spoilersOn ? norm(data.raceWinnerDriver) : "";

        function renderOne(num, drv){
          const numClean = String(num || "").trim();
          const drvClean = String(drv || "").trim();
          if (!numClean && !drvClean) return "";

          const isWinner = raceWinner && drvClean && norm(drvClean) === raceWinner;

          const safeNum = escapeHtml(numClean);
          const safeDrv = escapeHtml(drvClean);

          if (numClean && drvClean){
            if (isWinner){
              return `(${safeNum}) <span class="driverWinner"><span class="winFlag" aria-hidden="true">🏁</span>${safeDrv}</span>`;
            }
            return `(${safeNum}) ${safeDrv}`;
          }

          if (drvClean){
            if (isWinner){
              return `<span class="driverWinner"><span class="winFlag" aria-hidden="true">🏁</span>${safeDrv}</span>`;
            }
            return safeDrv;
          }

          return `(${safeNum})`;
        }

        return [renderOne(n1, d1), renderOne(n2, d2)].filter(Boolean).join(", ");
      }

      const leftMeta  = metaHtml_(m.p1Drivers, m.p1Nums);
      const rightMeta = metaHtml_(m.p2Drivers, m.p2Nums);
      const w = spoilersOn ? norm(m.winner) : "";
      const p1Win = spoilersOn && w && w === norm(m.p1);
      const p2Win = spoilersOn && w && w === norm(m.p2);
      const p1AvgTxt = showPastAvgs ? fmtAvg(m.a1) : "";
      const p2AvgTxt = showPastAvgs ? fmtAvg(m.a2) : "";
      const p1Label = `${String(m.p1 || "").trim()}${p1AvgTxt ? ` (${p1AvgTxt})` : ""}`;
      const p2Label = `${String(m.p2 || "").trim()}${p2AvgTxt ? ` (${p2AvgTxt})` : ""}`;

      card.innerHTML = `
        <div class="matchupRow">
          <div class="side left">
            <div class="pName"><span class="nameWrap"><span class="nameText">${escapeHtml(p1Label)}</span>${p1Win ? `<span class="winPill">WIN</span>` : ``}</span></div>
            ${leftMeta ? `<div class="pMeta">${leftMeta}</div>` : ``}
          </div>
          <div class="vsBadge">VS</div>
          <div class="side right">
            <div class="pName"><span class="nameWrap"><span class="nameText">${escapeHtml(p2Label)}</span>${p2Win ? `<span class="winPill">WIN</span>` : ``}</span></div>
            ${rightMeta ? `<div class="pMeta">${rightMeta}</div>` : ``}
          </div>
       </div>
      `;
      area.appendChild(card);
    }

    applyYouRowsNow_();
  }

  function autoSizeRaceSelect_(sel){
    if(!sel) return;

    if(!autoSizeRaceSelect_._measurer){
      const s = document.createElement("span");
      s.style.position = "absolute";
      s.style.top = "-9999px";
      s.style.left = "-9999px";
      s.style.whiteSpace = "pre";
      document.body.appendChild(s);
      autoSizeRaceSelect_._measurer = s;
    }

    const measurer = autoSizeRaceSelect_._measurer;
    const cs = getComputedStyle(sel);
    measurer.style.font = cs.font;
    measurer.style.letterSpacing = cs.letterSpacing;
    const text = sel.options[sel.selectedIndex]?.text || "";
    measurer.textContent = text;

    const paddingLeft  = parseFloat(cs.paddingLeft)  || 0;
    const paddingRight = parseFloat(cs.paddingRight) || 0;
    const arrowSpace = 34;

    const width = Math.ceil(
      measurer.getBoundingClientRect().width +
      paddingLeft +
      paddingRight +
      arrowSpace
    );

    sel.style.width = width + "px";
  }

  function autoSizePlayerSelect_(sel){
    if(!sel) return;

    let measurer = document.getElementById("__playerSelectMeasurer");
    if(!measurer){
      measurer = document.createElement("span");
      measurer.id = "__playerSelectMeasurer";
      measurer.style.position = "absolute";
      measurer.style.visibility = "hidden";
      measurer.style.whiteSpace = "pre";
      measurer.style.left = "-9999px";
      measurer.style.top = "-9999px";
      document.body.appendChild(measurer);
    }

    const cs = getComputedStyle(sel);
    measurer.style.fontFamily = cs.fontFamily;
    measurer.style.fontSize = cs.fontSize;
    measurer.style.fontWeight = cs.fontWeight;
    measurer.style.letterSpacing = cs.letterSpacing;

    const text = sel.options[sel.selectedIndex]?.text || "";
    measurer.textContent = text;

    const paddingLeft  = parseFloat(cs.paddingLeft)  || 0;
    const paddingRight = parseFloat(cs.paddingRight) || 0;
    const arrowSpace = 34;
    const width = Math.ceil(
      measurer.getBoundingClientRect().width +
      paddingLeft +
      paddingRight +
      arrowSpace
    );

    sel.style.width = width + "px";
  }

  async function loadSelectedRace_(){
    const sel = document.getElementById("raceSelect");
    const area = document.getElementById("matchupsArea");
    if(!sel) return;

    const v = String(sel.value || "");
    if(!v){
      loadCurrent();
      return;
    }

    area.innerHTML = "Loading race...";

    try{
      if (!ALL_MATCHUPS) await loadCurrent();

      const key = String(v).trim();
      const raceData = ALL_MATCHUPS?.races?.[key];

      if (!raceData || !Array.isArray(raceData.matchups) || raceData.matchups.length === 0) {
        renderFutureRaceMessage_(area, raceData);
        return;
      }

      await renderMatchupsInto_(raceData);
    }catch(e){
      area.innerHTML = "Error loading that race.";
      console.log(e);
    }
  }

  async function loadPlayersThenInit() {
    try{
      const players = await getPlayerList_();
      const safePlayers = Array.isArray(players) ? players : [];
      populatePlayerDropdowns(safePlayers);
      setWelcome();
      await initRaceSelect_();
      checkDuesNag_();
      initSpoilerToggle_();

      const last = String(localStorage.getItem(VIEW_KEY) || "").trim();
      const allowed = views.includes(last) ? last : "";

      if (allowed) showView(allowed);
      else if (hasPlayerName()) showView("mymatchup");
      else showView("current");

    }catch(e){
      console.log(e);
      setWelcome();
      await initRaceSelect_();
      initSpoilerToggle_();
      showView("current");
    }
  }

  async function loadCurrent(){
    const area = document.getElementById("matchupsArea");
    area.innerHTML = "Loading current race...";

    try{
      const raceDataBlob = await getPlayerRaceData_();
      ALL_MATCHUPS = raceDataBlob?.matchups || {};

      await initRaceSelect_();

      if (!ALL_MATCHUPS || !ALL_MATCHUPS.current || !ALL_MATCHUPS.races) {
        area.innerHTML = "Matchups data malformed.";
        return;
      }

      const curT = ALL_MATCHUPS.current.tournament ?? "";
      const curR = ALL_MATCHUPS.current.race ?? "";

      if (!curR) {
        area.innerHTML = "Current race not set yet.";
        return;
      }

      const currentKey = raceKey_(curT, curR);
      let currentRaceData = ALL_MATCHUPS.races[currentKey] || null;

      if (!currentRaceData) {
        currentRaceData = {
          tournament: curT,
          race: curR,
          round: ALL_MATCHUPS.current.round ?? "",
          raceWinnerDriver: "",
          matchups: []
        };
      }

      setRaceSelectValue_(curT, curR);

      if (!Array.isArray(currentRaceData.matchups) || currentRaceData.matchups.length === 0) {
        renderFutureRaceMessage_(area, currentRaceData);
        return;
      }

      await renderMatchupsInto_(currentRaceData);
    }catch(e){
      area.innerHTML = "Error loading matchups.";
      console.log(e);
    }
  }

  const EARLY_MESSAGES = [
    "Seedings aren’t set yet. Everyone is still technically good at this.",
    "No matchups yet. Enjoy this moment before it all goes wrong.",
    "Relax. The bracket hasn’t ruined your weekend yet.",
    "Nothing’s set yet. Stop refreshing like it’s going to help.",
    "Bracket pending. The spreadsheet gods demand patience.",
    "Matchups not set. Go hydrate or something.",
    "Seedings aren’t ready. Your downfall has been delayed.",
    "Calm down. NASCAR hasn’t hurt us yet."
  ];

  function getEarlyMessage(){
    return EARLY_MESSAGES[Math.floor(Math.random() * EARLY_MESSAGES.length)];
  }

  async function loadMyMatchup() {
    const sel = document.getElementById("globalPlayer");
    const out = document.getElementById("mmStatus");
    const name = sel ? String(sel.value || "").trim() : "";

    if (!name) {
      out.textContent = "Pick your damn name first, you anonymous ghost. We can't show your pathetic stats, overdue dues, your sad matchups, or even highlight your sorry ass in the full-field view until you select who the hell you are from the dropdown. This ain't the pace car parade—nobody's waiting on your indecisive ass to drop the green. Without a name, you're just another random dipshit in the grandstands yelling at the TV like your fantasy pick didn't just get taken out in the Big One on lap 47. Click a name already. Or keep lurking like a crew chief hiding bad fuel strategy notes. Your call, but the leaderboard ain't gonna populate itself.Select or GTFO. The checkered flag waits for no one... especially not you.";
      return;
    }

    savePlayerName(name);
    out.textContent = "Loading…";

    try{
      const data = await getPlayerMyMatchup_(name);
      const status = String(data.status || "").trim().toLowerCase();

      const youDriversArr = Array.isArray(data.youDrivers)
        ? data.youDrivers.map(x => String(x || "").trim()).filter(Boolean)
        : [];

      const youNumsArr = Array.isArray(data.youNums) ? data.youNums : [];
      const n1 = (youNumsArr.length > 0 && String(youNumsArr[0] ?? "").trim() !== "") ? String(youNumsArr[0]).trim() : "";
      const n2 = (youNumsArr.length > 1 && String(youNumsArr[1] ?? "").trim() !== "") ? String(youNumsArr[1]).trim() : "";

      const opp = String(data.opponent || "").trim();
      const hasRealOpponent =
        !!opp &&
        opp !== "-" &&
        opp.toLowerCase() !== "tbd" &&
        opp.toLowerCase() !== "bye";

      const tour = String(data.tournament ?? "").trim();
      const rnd  = String(data.round ?? "").trim();
      const hasRealContext =
        tour !== "" && tour !== "0" &&
        rnd  !== "" && rnd  !== "0";

      const youListLabel = youDriversArr.length
        ? "Your drivers:"
        : ((n1 || n2) ? "Your numbers:" : "");

      const youListText = youDriversArr.length
        ? youDriversArr.join("<br>")
        : ((n1 || n2) ? [n1,n2].filter(Boolean).join(", ") : "");

      const youListHtml = youDriversArr.length ? youListText : escapeHtml(youListText);

      if (!hasRealOpponent || !hasRealContext) {
        out.innerHTML = `
          <div class="microBox" style="margin-top:6px;">
            <div class="pill" style="margin-bottom:8px;">⏳ Not started yet</div>
            <div class="microMeta" style="font-weight:400; color: var(--textStrong);">
              ${escapeHtml(getEarlyMessage())}
            </div>
            ${youListText ? `
              <div style="margin-top:10px;">
                <div class="microTitle">${escapeHtml(youListLabel)}</div>
                <div class="microMeta">${youListHtml}</div>
              </div>
            ` : ``}
          </div>
        `;
        return;
      }

      if (status === "not_started") {
        out.innerHTML = `
          <div class="microBox" style="margin-top:6px;">
            <div class="microTitle">Matchups not published yet</div>
            <div class="microMeta" style="font-weight:400; color: var(--textStrong);">
              ${escapeHtml(data.you || name)}, Calm your shit, amigo.<br><br>
              It’ll show up when it exists.
            </div>
          </div>
        `;
        return;
      }

      const youMeta = formatDriversOrNumbers(data.youDrivers, data.youNums);
      const oppMeta = formatDriversOrNumbers(data.oppDrivers, data.oppNums);

      if (!spoilersOn_()){
        out.innerHTML = `
          <div class="mmHeader">
            Tourney ${escapeHtml(data.tournament)} · ${escapeHtml(data.race)} · Round ${escapeHtml(data.round)}
          </div>
          <div class="microBox youBox">
            <div class="microTitle">${escapeHtml(data.you)}</div>
            ${youMeta ? `<div class="microMeta">${escapeHtml(youMeta)}</div>` : ``}
          </div>
          <div class="centerVS">VS</div>
          <div class="microBox" style="display:flex; align-items:center; justify-content:center; min-height:64px;">
            <div style="font-size:34px; line-height:1;">🤷</div>
          </div>
        `;
        return;
      }

      const h2h = await h2hLineHtml_(data.you, data.opponent);

      out.innerHTML = `
        <div class="mmHeader">
          Tourney ${escapeHtml(data.tournament)} · ${escapeHtml(data.race)} · Round ${escapeHtml(data.round)}
        </div>
        <div class="microBox youBox">
          <div class="microTitle">${escapeHtml(data.you)}</div>
          ${youMeta ? `<div class="microMeta">${escapeHtml(youMeta)}</div>` : ``}
        </div>
        <div class="centerVS">VS</div>
        <div class="microBox">
          <div class="microTitle">${escapeHtml(data.opponent)}</div>
          ${oppMeta ? `<div class="microMeta">${escapeHtml(oppMeta)}</div>` : ``}
        </div>
        ${h2h}
      `;
    }catch(e){
      out.textContent = "Error: " + (e && e.message ? e.message : e);
    }
  }

  async function loadDues() {
    const out = document.getElementById("duesStatus");

    if (!spoilersOn_()){
      out.innerHTML = `
        <div class="microBox" style="margin-top:6px;">
          <div class="microTitle">Turn off spoilers to see this, you broke-ass crybaby. Spoilers off = dues visible. Simple as that, dipshit.<br><br></div>
          <div class="microMeta" style="color: var(--muted); font-weight:700;">
            It’s literally dues—money you owe because your fantasy picks wrecked harder than a backmarker on pit road.<br><br>
            We’re not flashing your overdue balance while the race is live just so you can whine in the chat that “the Big One cost me everything” before the checkered even drops.<br><br>
            Some of us are still pretending the caution didn’t fuck the entire playoff chase and your wallet at the same time.<br><br>
            Flip the spoiler switch, see how much you’re bleeding cash, pay up like a grown-ass adult, and quit acting like seeing your own tab is worse than watching your driver get turned on a restart.<br><br>
            You’ll live. Your bank account might not, but that’s between you and Venmo.
          </div>
        </div>
      `;
      return;
    }

    const sel = document.getElementById("globalPlayer");
    const name = sel ? String(sel.value || "").trim() : "";
    if (!name) {
      out.textContent = "I can't show you dues without knowing who you are, you silly goose!";
      return;
    }

    savePlayerName(name);
    out.textContent = "Loading…";

    try {
      const all = await getPlayerDues_();
      const data = all[name] || null;
      if (!data) throw new Error("No dues record found for " + name);

      const paid = Number(data.paid ?? 0);
      const winnings = Number(data.winnings ?? 0);
      const balance = Math.max(0, Number(data.balance ?? 0));

      const paidLine =
        paid === 180
          ? `<span style="color: var(--green); opacity: 0.9;">Paid: $${paid.toFixed(2)}</span>`
          : `Paid: $${paid.toFixed(2)}`;

      const balanceLine =
        balance > 0
          ? `<span style="color: var(--red); opacity: 0.9;">Balance Due: $${balance.toFixed(2)}</span>`
          : `Balance Due: $${balance.toFixed(2)}`;

      const venmoUser = String(VENMO_HANDLE || "").replace(/^@/, "");
      const venmoBtn = (balance > 0 && venmoUser)
        ? `<a class="venmoPayBtn" target="_blank" rel="noopener"
             href="https://account.venmo.com/pay?recipients=${encodeURIComponent(venmoUser)}&amount=${balance.toFixed(2)}&note=${encodeURIComponent("NASCAR Pool dues - " + name)}">
             Pay $${balance.toFixed(2)} on Venmo</a>`
        : "";

      out.innerHTML =
        `<div class="microBox">
          <div>${paidLine}</div>
          <div>Winnings: $${winnings.toFixed(2)}</div>
          <div>${balanceLine}</div>
          ${venmoBtn}
        </div>`;

    } catch (e) {
      out.textContent = "Error: " + (e && e.message ? e.message : e);
    }
  }

  const DUES_PER_RACE = 5;

  // Venmo handle for one-tap dues payment (no leading @).
  // Leave empty to hide the pay button.
  const VENMO_HANDLE = "@brettmurphyjr";

  function duesNagKey_(playerName, raceKey){
    const n = String(playerName || "").trim().toLowerCase();
    const rk = String(raceKey || "").trim();
    return `nascar_dues_nag_seen__${n}__${rk}`;
  }

  function currentRaceKey_(){
    const curT = ALL_MATCHUPS?.current?.tournament;
    const curR = ALL_MATCHUPS?.current?.race;
    if(!curT || !curR) return "";
    return raceKey_(curT, curR);
  }

  function ensureDuesNagStyles_(){
    if(document.getElementById("duesNagStyles")) return;

    const css = document.createElement("style");
    css.id = "duesNagStyles";
    css.textContent = `
      .duesNagOverlay{
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 999999;
      }

      .duesNagCard{
        width: min(560px, 100%);
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 14px;
        color: var(--text);
        box-shadow: 0 24px 80px rgba(0,0,0,0.55);
      }

      .duesNagTitle{
        font-weight: 900;
        font-size: 16px;
        letter-spacing: -0.2px;
        margin: 0 0 6px 0;
      }

      .duesNagBody{
        font-size: 13px;
        line-height: 1.35;
        color: var(--muted);
      }

      .duesNagBody b{
        color: var(--text);
        font-weight: 900;
      }

      .duesNagFinePrint{
        margin-top: 10px;
        font-size: 12px;
        color: rgba(255,255,255,.60);
      }

      .duesNagRow{
        margin-top: 12px;
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: nowrap;
      }

      button.duesNagBtn{
        -webkit-appearance: none;
        appearance: none;
        box-sizing: border-box;
        margin: 0 !important;
        padding: 0 10px !important;
        height: 30px;
        line-height: 1;
        border: 1px solid var(--line);
        border-radius: 12px;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
        background: rgba(255,255,255,.06);
        color: var(--text);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }

      button.duesNagBtn:hover{
        background: rgba(255,255,255,.10);
      }

      button.duesNagBtn.duesNagPrimary{
        background: rgba(228, 0, 43, .40);
        border: 1px solid rgba(255,255,255,.32);
      }

      button.duesNagBtn.duesNagPrimary:hover{
        background: rgba(228, 0, 43, .55);
      }

      .duesNagImg{
        width: 100%;
        max-height: 170px;
        object-fit: contain;
        margin-top: 10px;
        border-radius: 12px;
        background: rgba(255,255,255,0.05);
        border: 1px solid var(--line);
      }
    `;
    document.head.appendChild(css);
  }

  function closeDuesNag_(){
    const el = document.getElementById("duesNagOverlay");
    if(el) el.remove();
  }

  function showDuesNag_(opts){
    ensureDuesNagStyles_();
    closeDuesNag_();

    const {
      name,
      required,
      paid,
      winnings,
      effectivePaid,
      behind,
      raceDisplay
    } = opts;

    const overlay = document.createElement("div");
    overlay.id = "duesNagOverlay";
    overlay.className = "duesNagOverlay";
    overlay.addEventListener("click", (e) => {
      if(e.target === overlay) closeDuesNag_();
    });

    const imgSrc = "";

    overlay.innerHTML = `
      <div class="duesNagCard" role="dialog" aria-modal="true" aria-label="Dues reminder">
        <div class="duesNagTitle">Pay your fuckin dues, ${escapeHtml(name)}.</div>

        <div class="duesNagBody">
          Current race: <b>${escapeHtml(raceDisplay || "Current")}</b><br/>
          Bare minimum to not be a bum: <b>$${Number(required).toFixed(2)}</b><br/>
          Paid: <b>$${Number(paid).toFixed(2)}</b> | Won: <b>$${Number(winnings).toFixed(2)}</b> = <b>$${Number(effectivePaid).toFixed(2)}</b><br/>
          You’re behind by: <b style="color: var(--red);">$${Number(behind).toFixed(2)}</b>
        </div>

        ${imgSrc ? `<img class="duesNagImg" src="${escapeAttr(imgSrc)}" alt="Pay your dues">` : ``}

        <div class="duesNagFinePrint">
          I'll bug you until you pony up the cash. Yes, it’s petty. That’s the point.
        </div>

        <div class="duesNagRow">
          <button class="duesNagBtn ghost" id="duesNagCloseBtn" type="button">I hate this</button>
          <button class="duesNagBtn duesNagPrimary" id="duesNagViewBtn" type="button">Take me to Dues</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = document.getElementById("duesNagCloseBtn");
    const duesBtn  = document.getElementById("duesNagViewBtn");

    if(closeBtn) closeBtn.onclick = closeDuesNag_;
    if(duesBtn) duesBtn.onclick = () => {
      window.open("https://venmo.com/u/brettmurphyjr", "_blank", "noopener,noreferrer");
    };
  }

  async function checkDuesNag_(){
    try{
      const rawName = loadPlayerName();
      const name = String(rawName || "").trim();
      if(!name) return;

      if(!ALL_MATCHUPS || !ALL_MATCHUPS.current){
        const blob = await getPlayerRaceData_();
        ALL_MATCHUPS = blob?.matchups || null;
      }

      const rk = currentRaceKey_();
      if(!rk) return;

      const seenKey = duesNagKey_(name, rk);
      if(localStorage.getItem(seenKey) === "1") return;

      if(!Array.isArray(RACE_LIST) || !RACE_LIST.length){
        const blob = await getPlayerRaceData_();
        RACE_LIST = Array.isArray(blob?.raceList) ? blob.raceList : [];
      }

      const currentRaceIndex = RACE_LIST.findIndex(r => raceKey_(r?.tournament, r?.race) === rk);
      if(currentRaceIndex < 0) return;

      const required = currentRaceIndex * DUES_PER_RACE;
      const duesMap = await getPlayerDues_();
      const data = duesMap[name] || null;
      const paid = Number(data?.paid ?? 0);
      const winnings = Number(data?.winnings ?? 0);
      const effectivePaid = paid + winnings;
      const behind = Number(data?.currentBehind ?? 0);

      if (!(behind > 0.0001)) return;

      localStorage.setItem(seenKey, "1");
      const raceDisplay = ALL_MATCHUPS?.current?.race || "";
      showDuesNag_({ name, required, paid, winnings, effectivePaid, behind, raceDisplay });

    }catch(e){
      console.log("checkDuesNag_ failed:", e);
    }
  }

  function resetStatPillScroll(scope){
    const root = scope || document;
    root.querySelectorAll('.statsBadges').forEach(el => {
      el.scrollLeft = 0;
      el.scrollTo(0, 0);
    });
  }

  function resetStatPillScrollSoon(scope){
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resetStatPillScroll(scope));
    });
  }

  function syncOverallNameColumnWidth_(){
    const panel = document.getElementById("statsPanel");
    if(!panel) return;

    const names = panel.querySelectorAll(".statsRow .statsName");
    if(!names.length) return;

    let ruler = document.getElementById("__nameRuler");
    if(!ruler){
      ruler = document.createElement("span");
      ruler.id = "__nameRuler";
      ruler.style.position = "fixed";
      ruler.style.left = "-9999px";
      ruler.style.top = "-9999px";
      ruler.style.visibility = "hidden";
      ruler.style.whiteSpace = "nowrap";
      ruler.style.padding = "0";
      ruler.style.margin = "0";
      ruler.style.border = "0";
      document.body.appendChild(ruler);
    }

    const cs = window.getComputedStyle(names[0]);
    ruler.style.fontFamily = cs.fontFamily;
    ruler.style.fontSize = cs.fontSize;
    ruler.style.fontWeight = cs.fontWeight;
    ruler.style.letterSpacing = cs.letterSpacing;
    ruler.style.textTransform = cs.textTransform;

    let max = 0;
    names.forEach(el => {
      ruler.textContent = el.textContent || "";
      max = Math.max(max, ruler.getBoundingClientRect().width);
    });

    const next = Math.ceil(max + 6);
    const prev = parseFloat(panel.style.getPropertyValue("--overallNameW")) || 0;
    if (Math.abs(next - prev) < 1) return;

    panel.style.setProperty("--overallNameW", next + "px");
  }

  async function loadStandings() {
    const area = document.getElementById("standingsArea");
    area.innerHTML = "Loading stats...";

    try{
      const data = await getPlayerStats_();
      _cache_standings = data || {};

      if (!spoilersOn_()){
        area.innerHTML = `
          <div class="microBox" style="margin-top:6px;">
            <div class="microTitle">Spoilers are OFF</div>
            <div class="microMeta" style="color: var(--muted); font-weight:700;">
              Because apparently some of you can't handle the truth without crying to the group chat.<br><br>
              Standings? Tourney ranks? Head-to-head? Wins? All buried deeper than a wrecked car in the Turn 4 wall after the Big One.<br><br>
              Humans can't behave—someone always screenshots the leaderboard, spoils the playoff bubble for the guy (Justin) who DVR'd the race, or ruins the surprise that your driver's stage points just got wiped out by a caution-lap bullshit fest.<br><br>
              Driver usage is still here because knowing who the field picked doesn't ruin the magic of watching your fantasy lineup get fucked on a late-race restart.<br><br>
              If you're that desperate to see how badly you're losing, pick a completed race from the dropdown like the rest of us. Until then, enjoy the ignorance—it's the only thing keeping half this pool from rage-quitting.<br><br>
              The checkered flag doesn't care about your fragile feelings. Neither do we.
            </div>
          </div>
          <div class="statsPanel" id="statsPanel" style="margin-top:10px;"></div>
        `;
        const box = document.getElementById("statsPanel");
        _statsMode = "drivers";
        await renderDrivers_(box);
        return;
      }

      area.innerHTML = `
        <div class="statsModes" id="statsModes">
          <button class="secondary" data-mode="overall">Standings</button>
          <button class="secondary" data-mode="tourney">Tourney Ranks</button>
          <button class="secondary" data-mode="h2h">H2H</button>
          <button class="secondary" data-mode="wins">Wins</button>
          <button class="secondary" data-mode="winnings">Winnings</button>
          <button class="secondary" data-mode="drivers">Driver Usage</button>
        </div>
        <div class="statsPanel" id="statsPanel"></div>
      `;

      persistHScroll("#statsModes", "nascar_stats_tabs_scroll");

      const modes = area.querySelectorAll("#statsModes button");
      modes.forEach(b => {
        b.onclick = () => setStatsMode_(b.getAttribute("data-mode") || "overall");
      });

      setStatsMode_("overall");
    }catch(e){
      area.innerHTML = "Error: " + (e && e.message ? e.message : e);
    }
  }

  function setStatsMode_(mode){
    _statsMode = mode || "overall";
    const box = document.getElementById("statsPanel");
    const modes = document.querySelectorAll("#statsModes button");
    modes.forEach(b => b.classList.toggle("active", (b.getAttribute("data-mode") === _statsMode)));

    if (!box) return;
    if (_statsMode === "overall") return renderOverall_(box);
    if (_statsMode === "tourney") return renderTourney_(box);
    if (_statsMode === "h2h") return renderH2H_(box);
    if (_statsMode === "wins") return renderWins_(box);
    if (_statsMode === "winnings") return renderWinnings_(box);
    if (_statsMode === "drivers") return renderDrivers_(box);
    box.innerHTML = "";
  }

  function renderOverall_(box){
    const data = _cache_standings || {};
    const rows = Array.isArray(data.overall) ? data.overall : [];
    const headers = Array.isArray(data.overallHeaders) ? data.overallHeaders : [];

    if (!rows.length || !headers.length){
      box.innerHTML = `<div class="muted">(No standings data yet)</div>`;
      requestAnimationFrame(() => syncOverallNameColumnWidth_());
      resetStatPillScrollSoon(box);
      return;
    }

    const nameKey = headers.find(h => /name|player/i.test(h)) || headers[0];
    const rankKey = headers.find(h => /rank/i.test(h)) || headers[0];
    const you = loadPlayerName().trim().toLowerCase();

    // Movement vs last completed race; recompute once race data arrives.
    const deltas = overallRankDeltas_();
    if (!deltas && !_playerRaceData) {
      getPlayerRaceData_().then(() => {
        if (_statsMode === "overall") renderOverall_(box);
      }).catch(() => {});
    }

    let html = `<div class="big">Overall</div>`;
    rows.forEach(r => {
      const rank = r[rankKey] ?? "";
      const name = r[nameKey] ?? "";

      const EXCLUDED_KEYS = new Set(["Matches"]);

      const W = r["W"] ?? r["w"] ?? null;
      const L = r["L"] ?? r["l"] ?? null;
      const record = (W != null && L != null) ? `${W}-${L}` : "";

      const isYou  = you && name.trim().toLowerCase() === you;

      const badgeKeys = headers
        .filter(k => !EXCLUDED_KEYS.has(k))
        .filter(h => h !== nameKey && h !== rankKey)
        .filter(h => !/^(w|l)$/i.test(h))
        .slice(0, 5);

      const badges = [
        record ? `<span class="miniPill">${escapeHtml(record)}</span>` : "",
        ...badgeKeys.map(k => {
          const v = r[k];
          if (v == null || String(v).trim() === "") return "";
          return `<span class="miniPill"><span class="k">${escapeHtml(k)}:</span> ${escapeHtml(v)}</span>`;
        })
      ].filter(Boolean).join("");

      const dv = deltas ? deltas.get(String(name).trim().toLowerCase()) : null;
      const move = (dv == null || dv === 0)
        ? ""
        : `<span class="moveArrow ${dv > 0 ? "up" : "down"}">${dv > 0 ? "▲" : "▼"}${Math.abs(dv)}</span>`;

      html += `
        <div class="statsRow overallRow ${isYou ? "youRow" : ""}">
          <div class="rankBadge">${escapeHtml(rank || "—")}</div>
          <div class="statsName">${escapeHtml(name)}${move}</div>
          <div class="statsBadges">${badges}</div>
        </div>
      `;
    });

    box.innerHTML = html;
    requestAnimationFrame(syncOverallNameColumnWidth_);
    resetStatPillScrollSoon(box);
  }

  async function renderTourney_(box){
  const data = _cache_standings || {};
  const headers = Array.isArray(data.tournamentHeaders) ? data.tournamentHeaders : [];

  if (!headers.length){
    box.innerHTML = `<div class="muted">(No tournament rank data yet)</div>`;
    resetStatPillScrollSoon(box);
    return;
  }

  const opts = headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join("");
  box.innerHTML = `
    <div class="big">Tournament Ranks</div>
    <div class="muted">Pick a damn tournament (if you care)</div>
    <div class="statsControls">
      <select id="tourneyPick">${opts}</select>
    </div>
    <div id="tourneyRanksBox" style="margin-top:10px;"></div>
  `;

  const sel = document.getElementById("tourneyPick");

  let defaultLabel = headers[0] || "";

  try {
    const raceDataBlob = await getPlayerRaceData_();
    const currentTournamentNumber = Number(raceDataBlob?.matchups?.current?.tournament || 0);
    const currentLabel = currentTournamentNumber ? `Tournament ${currentTournamentNumber}` : "";
    if (currentLabel && headers.includes(currentLabel)) {
      defaultLabel = currentLabel;
    }
  } catch (e) {
    console.log("Could not determine current tournament for stats dropdown:", e);
  }

  sel.value = defaultLabel;

  const render = () => showTournamentRanks(sel.value);
  sel.onchange = render;
  render();
}

  function showTournamentRanks(label) {
    const box = document.getElementById("tourneyRanksBox");
    const t = (_cache_standings && _cache_standings.tournaments) ? _cache_standings.tournaments : {};
    const listRaw = t[label] || [];

    let html = ``;

    if (!Array.isArray(listRaw) || listRaw.length === 0) {
      html += `<div class="muted">(No data yet)</div>`;
      box.innerHTML = html;
      return;
    }

    const items = listRaw
      .map((it) => {
        if (it && typeof it === "object") {
          const player = it.player ?? it.name ?? it.Player ?? it.PLAYER ?? "";
          const rank = Number(it.rank ?? it.Rank ?? it.RANK);

          const out = { ...it };
          out.player = String(player || "").trim();
          out.rank = Number.isFinite(rank) ? rank : null;
          return out;
        }
        return { rank: null, player: String(it || "").trim() };
      })
      .filter(x => x.player);

    if (items.length === 0) {
      html += `<div class="muted">(No data yet)</div>`;
      box.innerHTML = html;
      return;
    }

    const hasRanks = items.some(x => Number.isFinite(x.rank));
    if (hasRanks) items.sort((a,b) => (a.rank ?? 999) - (b.rank ?? 999));

    let startRank = 17 - items.length;
    if (startRank < 1) startRank = 1;
    if (startRank > 16) startRank = 16;

    const you = loadPlayerName().trim().toLowerCase();

    const tournamentComplete =
  items.length === 16 &&
  items.every((x) => {
    const W = Number(x["W"] ?? x["w"] ?? 0);
    const L = Number(x["L"] ?? x["l"] ?? 0);
    return (W + L) >= 4;
  });

    html += `<div class="rankList">`;

    items.forEach((it, i) => {
      const r = Number.isFinite(it.rank) ? it.rank : (startRank + i);
      const name = it.player || "";
      const isPaid = r <= 4;
      const isYou  = you && name.trim().toLowerCase() === you;

      const W = it["W"] ?? it["w"] ?? null;
      const L = it["L"] ?? it["l"] ?? null;
      const record = (W != null && L != null) ? `${W}-${L}` : "";

      const keys = Object.keys(it || {});
      const avgK = keys.find(k => /^avg$/i.test(k));
      const wpK  = keys.find(k => /^w%$/i.test(k) || /^wpct$/i.test(k) || /^win%$/i.test(k));

      const avgVal = avgK ? it[avgK] : null;
      const wpVal  = wpK  ? it[wpK]  : null;

      const payout = tournamentComplete ? TOURNAMENT_PAYOUTS[r] || "" : "";

      const badges = [
        record ? `<span class="miniPill">${escapeHtml(record)}</span>` : "",
        avgVal != null && String(avgVal).trim() !== ""
          ? `<span class="miniPill"><span class="k">Avg:</span> ${escapeHtml(avgVal)}</span>` : "",
        wpVal != null && String(wpVal).trim() !== ""
          ? `<span class="miniPill"><span class="k">W%:</span> ${escapeHtml(wpVal)}</span>` : "",
        payout
          ? `<span class="miniPill">${escapeHtml(payout)}</span>` : ""
      ].filter(Boolean).join("");

      html += `
        <div class="statsRow overallRow ${isPaid ? "paidRow" : ""} ${isYou ? "youRow" : ""}">
          <div class="rankBadge">${escapeHtml(r)}</div>
          <div class="statsName">${escapeHtml(name)}</div>
          <div class="statsBadges">${badges}</div>
        </div>
      `;
    });

    html += `</div>`;

    box.innerHTML = html;
    requestAnimationFrame(syncOverallNameColumnWidth_);
    resetStatPillScrollSoon(box);
  }

  async function renderH2H_(box){
    const you = loadPlayerName().trim();

    box.innerHTML = `
      <div class="big">Head-to-Head</div>
      <div class="muted">If not you, pick someone else, for fucks sake.</div>
      <div class="statsControls">
        <select id="h2hPick"></select>
      </div>
      <div id="h2hOut" style="margin-top:10px;">Loading…</div>
    `;
    resetStatPillScrollSoon(box);

    const players = await getPlayerList_();
    const sel = document.getElementById("h2hPick");
    sel.innerHTML = (players || []).map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("");

    if (you && (players || []).some(p => String(p).trim().toLowerCase() === you.toLowerCase())) {
      sel.value = you;
    }

    const out = document.getElementById("h2hOut");

    const load = async () => {
      out.textContent = "Loading…";
      try{
        const player = String(sel.value || "").trim();
        const h2hBlob = (_cache_standings && _cache_standings.h2h) ? _cache_standings.h2h : {};
        const rows = Array.isArray(h2hBlob[player]) ? h2hBlob[player] : [];

        if (!rows.length){
          out.innerHTML = `<div class="muted">(No H2H data yet)</div>`;
          return;
        }

        let html = ``;
        rows.forEach(r => {
          const rec = r.record || ((r.wins != null && r.losses != null) ? `(${r.wins}-${r.losses})` : "");
          html += `
            <div class="statsRow">
              <div class="statsLeft">
                <div class="statsName">vs ${escapeHtml(r.opponent || "")}</div>
              </div>
              <div class="statsBadges">
                <span class="miniPill">${escapeHtml(rec || "")}</span>
              </div>
            </div>
          `;
        });
        out.innerHTML = html;
      }catch(e){
        out.innerHTML = `<div class="muted">H2H failed to load.</div>`;
      }
    };

    sel.onchange = load;
    load();
  }

  async function renderWins_(box){
    const you = loadPlayerName().trim();

    box.innerHTML = `
      <div class="big">Wins</div>
      <div class="muted">Race wins, bracket wins, and tourney wins</div>
      <div class="statsControls">
        <select id="winsPick"></select>
      </div>
      <div id="winsOut" style="margin-top:10px;">Loading…</div>
    `;
    resetStatPillScrollSoon(box);

    const players = await getPlayerList_();
    const sel = document.getElementById("winsPick");
    sel.innerHTML = (players || []).map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("");

    if (you && (players || []).some(p => String(p).trim().toLowerCase() === you.toLowerCase())) {
      sel.value = you;
    }

    const out = document.getElementById("winsOut");

    const load = async () => {
      out.textContent = "Loading…";

      try{
        const player = String(sel.value || "").trim();
        const winsBlob = (_cache_standings && _cache_standings.wins) ? _cache_standings.wins : {};
        const w = winsBlob[player] || { raceWins: 0, bracketWins: 0, tourneyWins: 0 };

        out.innerHTML = `
          <div class="tiles">
            <div class="tile">
              <div class="tLabel">🏁 Race Wins</div>
              <div class="tVal">${escapeHtml(w.raceWins ?? 0)}</div>
            </div>
            <div class="tile">
              <div class="tLabel">🏆 Bracket Wins</div>
              <div class="tVal">${escapeHtml(w.bracketWins ?? 0)}</div>
            </div>
            <div class="tile">
              <div class="tLabel">🎯 Tourney Wins</div>
              <div class="tVal">${escapeHtml(w.tourneyWins ?? 0)}</div>
            </div>
          </div>
        `;
      }catch(e){
        out.innerHTML = `<div class="muted">Wins failed to load.</div>`;
      }
    };

    sel.onchange = load;
    load();
  }
  
  function renderWinnings_(box){
    const data = _cache_standings || {};
    const rows = Array.isArray(data.winnings) ? data.winnings : [];
    const you = loadPlayerName().trim().toLowerCase();

    if (!rows.length){
      box.innerHTML = `<div class="muted">(No winnings data yet)</div>`;
      resetStatPillScrollSoon(box);
      return;
    }

    let html = `
      <div class="big">Winnings</div>
    `;

    rows.forEach(r => {
      const rank = r.rank ?? "";
      const name = String(r.player || "").trim();
      const winnings = Number(r.winnings || 0);
      const isYou = you && name.toLowerCase() === you;

      html += `
        <div class="statsRow ${isYou ? "youRow" : ""}">
          <div class="rankBadge">${escapeHtml(rank || "—")}</div>
          <div class="statsName">${escapeHtml(name)}</div>
          <div class="statsBadges">
            <span class="miniPill">$${winnings.toFixed(2)}</span>
          </div>
        </div>
      `;
    });

    box.innerHTML = html;
    resetStatPillScrollSoon(box);
  }

  async function renderDrivers_(box){
    const you = loadPlayerName().trim();

    box.innerHTML = `
      <div class="big">Driver Usage</div>
      <div class="muted">How many times you've been stuck with these drivers</div>
      <div class="statsControls">
        <select id="drvPick"></select>
      </div>
      <div id="drvOut" style="margin-top:10px;">Loading…</div>
    `;
    resetStatPillScrollSoon(box);

    const players = await getPlayerList_();
    const sel = document.getElementById("drvPick");
    sel.innerHTML = (players || []).map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("");

    if (you && (players || []).some(p => String(p).trim().toLowerCase() === you.toLowerCase())) {
      sel.value = you;
    }

    const out = document.getElementById("drvOut");

    const load = async () => {
      out.textContent = "Loading…";

      try{
        const player = String(sel.value || "").trim();
        const driversBlob = (_cache_standings && _cache_standings.drivers) ? _cache_standings.drivers : {};
        const rows = Array.isArray(driversBlob[player]) ? driversBlob[player] : [];

        if (!rows.length){
          out.innerHTML = `<div class="muted">(No driver usage data yet)</div>`;
          return;
        }

        let html = ``;
        rows.forEach(r => {
          html += `
            <div class="statsRow">
              <div class="statsLeft">
                <div class="statsName">${escapeHtml(r.driver || "")}</div>
              </div>
              <div class="statsBadges">
                <span class="miniPill"><span class="k">Times:</span> ${escapeHtml(r.count ?? "")}</span>
              </div>
            </div>
          `;
        });
        out.innerHTML = html;
      }catch(e){
        out.innerHTML = `<div class="muted">Driver usage failed to load.</div>`;
      }
    };

    sel.onchange = load;
    load();
  }
  
  const VAPID_PUBLIC_KEY = "BL7txU7e0ugTZE227ErMGB8h5dU5tp54iyfZzuyE7a1PVUYNLlM9i_1ila3s0zDrInVgdw4ItJDcgO720cNo5g0";

function urlBase64ToUint8Array_(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function enablePushNotifications_() {
  const btn = document.getElementById("enableNotificationsBtn");
  if (btn) btn.disabled = true;

  try {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      if (isIOS && !isStandalone) {
        throw new Error("On iPhone, notifications only work from the installed app: tap Share, then 'Add to Home Screen', open NASCAR Pool from your home screen, and tap Notify Me again.");
      }
      throw new Error("Push notifications are not supported in this browser.");
    }

    if (!loadPlayerName().trim()) {
      throw new Error("Pick your name from the dropdown first so we know who to notify.");
    }

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();

    // Already subscribed on this device: the same button manages
    // pausing/resuming instead of blindly re-subscribing.
    if (existing) {
      let status = { found: false, paused: false };
      try {
        const sRes = await fetch(
          `/api/push-prefs?endpoint=${encodeURIComponent(existing.endpoint)}`,
          { cache: "no-store" }
        );
        const sData = await sRes.json().catch(() => ({}));
        if (sData?.ok) status = sData;
      } catch (e) {}

      if (status.found) {
        const turningOff = !status.paused;
        const q = turningOff
          ? "Notifications are ON for this device. Pause them?"
          : "Notifications are paused. Turn them back on?";
        if (!confirm(q)) return;

        const res = await fetch("/api/push-prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint, paused: turningOff })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed updating notification settings.");
        }

        paintPushButton_(!turningOff);
        alert(turningOff
          ? "Notifications paused. Tap the bell any time to turn them back on."
          : "Notifications are back on.");
        return;
      }
      // Subscribed in the browser but unknown to the server:
      // fall through and (re)register it.
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Notifications were not allowed.");
    }

    const subscription = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array_(VAPID_PUBLIC_KEY)
    });

    const res = await fetch("/api/save-push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName: loadPlayerName(),
        subscription
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Failed saving notification subscription.");
    }

    paintPushButton_(true);
    alert("Notifications enabled. Tap the bell again any time to pause them.");
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function adminSetPushPaused_(paused) {
  const sel = document.getElementById("adminFundsPlayer");
  const name = sel ? String(sel.value || "").trim() : "";

  if (!name) {
    setAdminStatus_("adminFundsStatus", "Pick a player first.", true);
    return;
  }

  setAdminStatus_("adminFundsStatus", `${paused ? "Pausing" : "Resuming"} push for ${name}…`);

  try {
    const data = await adminFetch_("/api/push-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName: name, paused })
    });

    const n = Number(data?.updated) || 0;
    setAdminStatus_(
      "adminFundsStatus",
      n === 0
        ? `${name} has no push subscriptions.`
        : `${paused ? "Paused" : "Resumed"} push for ${name} (${n} device${n === 1 ? "" : "s"}).`
    );
  } catch (err) {
    setAdminStatus_("adminFundsStatus", err.message || String(err), true);
  }
}

function paintPushButton_(active) {
  const btn = document.getElementById("enableNotificationsBtn");
  if (!btn) return;
  btn.textContent = active ? "🔔" : "🔕";
  btn.setAttribute("aria-label", active
    ? "Notifications on - tap to pause"
    : "Enable notifications");
}

function initPushNotifications_() {
  const btn = document.getElementById("enableNotificationsBtn");
  if (!btn) return;

  // Keep the button visible even where push isn't supported (iOS
  // Safari tab) - the click handler explains how to enable it.
  btn.addEventListener("click", enablePushNotifications_);

  // Reflect this device's current state on the bell icon.
  (async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const res = await fetch(
        `/api/push-prefs?endpoint=${encodeURIComponent(sub.endpoint)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.found) paintPushButton_(!data.paused);
    } catch (e) {}
  })();
}

  /* ==========================================================
   Bracket view
   ========================================================== */

  async function loadBracket(){
  const sub = document.getElementById("bracketSub");
  const area = document.getElementById("bracketArea");
  const headerSelect = document.getElementById("bracketHeaderSelect");

  if (!spoilersOn_()){
    if (headerSelect) headerSelect.innerHTML = "";
    sub.textContent = "Spoilers are OFF";
    area.innerHTML = `
      <div class="microBox" style="margin-top:6px;">
        <div class="microTitle">Bracket hidden</div>
        <div class="microMeta" style="color: var(--muted); font-weight:700;">
          Turn spoilers back ON if you want the bracket.
        </div>
      </div>
    `;
    return;
  }

  if (headerSelect) headerSelect.innerHTML = "";
  sub.textContent = "Loading…";
  area.innerHTML = "Loading…";

  const fmtAvg = (n) => (n == null ? "" : Number(n).toFixed(1).replace(/\.0$/,""));

  try{
    const data = await getPlayerBracket_(_selectedBracketTournament);

    const tour  = data.tournament ?? "";
    const race  = data.currentRace ?? data.race ?? "";
    const round = data.currentRound ?? data.round ?? "";

    if (!_selectedBracketTournament && tour) {
      _selectedBracketTournament = String(tour);
    }

    const leftText =
      `Tourney ${tour}` +
      (race ? ` · ${race}` : "") +
      (round !== "" ? ` · ${roundLabel(round)}` : "");

    const tournamentOptions = Array.isArray(data.tournamentOptions) ? data.tournamentOptions : [];
    const selectorHtml = tournamentOptions.length
      ? `
        <select id="bracketTournamentPick">
          ${tournamentOptions.map(opt => `
            <option value="${escapeAttr(opt.tournament)}" ${String(opt.tournament) === String(_selectedBracketTournament || tour) ? "selected" : ""}>
              Tournament ${escapeHtml(opt.tournament)}
            </option>
          `).join("")}
        </select>
      `
      : "";

    if (headerSelect) {
      headerSelect.innerHTML = selectorHtml;
    }

    sub.innerHTML = `
      <div class="legendRow">
        <div>${escapeHtml(leftText)}</div>
        <div class="bracketLegend" aria-label="Legend">
          <span class="legendItem"><span class="raceDot"></span> Race W</span>
          <span class="legendSep">·</span>
          <span class="legendItem"><span class="winDot"></span> H2H W</span>
        </div>
      </div>
    `;

    const rounds = data.rounds || [];
    let html = `<div class="bracketGrid">`;

    const sticky = document.getElementById("bracketSticky");
    if (sticky) {
      sticky.innerHTML = rounds.map((r, idx) => {
        const label = r.isCurrent ? "CURRENT" : roundLabel(r.round);
        const raceLabel = r.raceLabel || "";
        return `
          <div class="chip" data-idx="${idx}">
            <span>${escapeHtml(label)}</span>
            <span class="small">${escapeHtml(raceLabel)}</span>
          </div>
        `;
      }).join("");
    }

    rounds.forEach(r => {
      const tag = r.isCurrent
        ? `<span class="roundTag">CURRENT</span>`
        : `<span class="roundTag">${escapeHtml(roundLabel(r.round))}</span>`;

      html += `
        <div class="bracketCol">
          <div class="bracketHdr">
            <div class="title">${tag}</div>
            <div class="raceTag">${escapeHtml(r.raceLabel || "")}</div>
          </div>
      `;

      (r.matchups || []).forEach(m => {
        const norm = (s) => String(s ?? "").trim().toLowerCase();
        const winnerName = String(m.winner ?? "").trim();
        const p1Name = String(m.p1 ?? "").trim();
        const p2Name = String(m.p2 ?? "").trim();
        const p1Win = winnerName && p1Name && norm(winnerName) === norm(p1Name);
        const p2Win = winnerName && p2Name && norm(winnerName) === norm(p2Name);

        const p1Badge = Number(r.round) === 1
          ? (m.s1 || "—")
          : (m.p1Record || "—");

        const p2Badge = Number(r.round) === 1
          ? (m.s2 || "—")
          : (m.p2Record || "—");

        html += `
          <div class="ticket">
            <div class="ticketRow">
              <div class="sideLeft">
                <span class="seedBadge">${escapeHtml(p1Badge)}</span>
                <span class="nameText">${escapeHtml(m.p1 || "")}</span>
              </div>
              <div class="sideRight">
                <span class="winSlot">${m.p1RaceWinner ? `<span class="raceDot" title="Race Winner Driver"></span>` : ``}</span>
                <span class="winSlot">${p1Win ? `<span class="winDot" title="Matchup Winner"></span>` : ``}</span>
                <span class="avgBox ${m.a1 == null ? "empty" : ""}">${m.a1 == null ? "—" : escapeHtml(fmtAvg(m.a1))}</span>
              </div>
            </div>

            <div class="ticketRow">
              <div class="sideLeft">
                <span class="seedBadge">${escapeHtml(p2Badge)}</span>
                <span class="nameText">${escapeHtml(m.p2 || "")}</span>
              </div>
              <div class="sideRight">
                <span class="winSlot">${m.p2RaceWinner ? `<span class="raceDot" title="Race Winner Driver"></span>` : ``}</span>
                <span class="winSlot">${p2Win ? `<span class="winDot" title="Matchup Winner"></span>` : ``}</span>
                <span class="avgBox ${m.a2 == null ? "empty" : ""}">${m.a2 == null ? "—" : escapeHtml(fmtAvg(m.a2))}</span>
              </div>
            </div>
          </div>
        `;
      });

      html += `</div>`;
    });

    html += `</div>`;
    area.innerHTML = html;

    const pick = document.getElementById("bracketTournamentPick");
    if (pick) {
      pick.onchange = () => {
        _selectedBracketTournament = String(pick.value || "").trim();
        loadBracket();
      };
    }

    const grid = area.querySelector(".bracketGrid");
    if (grid && sticky) {
      sticky.querySelectorAll(".chip").forEach(chip => {
        chip.onclick = () => {
          const idx = Number(chip.getAttribute("data-idx") || "0");
          const col = grid.children[idx];
          if (col) col.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
        };
      });
    }
  } catch(e){
    if (headerSelect) headerSelect.innerHTML = "";
    sub.textContent = "Bracket failed to load.";
    area.innerHTML = "Error: " + (e && e.message ? e.message : e);
  }
}

let buschGirls = [];
let buschQueue = [];
let buschSeenUrls = new Set();

const BUSCH_WARMUP_COUNT = 2;

const SHOW_KYLE_TRIBUTE = false;
const KYLE_TRIBUTE_IMG = "img/IMG_0792.jpeg";

/* ==========================================================
   Green flag countdown (Matchup tab, current race only)
   ========================================================== */

let _gfTimer = null;
let _gfStartMs = null;
let _hubLoaded = false;

// Global countdown pinned under the header, visible on every tab.
async function renderGreenFlagCountdown_() {
  const host = document.getElementById("gfGlobal");
  if (!host) return;

  try {
    if (_gfStartMs === null) {
      const res = await fetch("/api/live-matchups", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      let v = String(data?.race?.startTime || "").trim();
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) {
        v += "-04:00";
      }
      const d = new Date(v);
      _gfStartMs = Number.isNaN(d.getTime()) ? 0 : d.getTime();
    }

    if (!_gfStartMs) return;

    const paint = () => {
      const diff = _gfStartMs - Date.now();

      if (diff <= 0) {
        host.innerHTML = "";
        if (_gfTimer) { clearInterval(_gfTimer); _gfTimer = null; }
        return;
      }

      const mins = Math.floor(diff / 60000);
      const days = Math.floor(mins / 1440);
      const hrs = Math.floor((mins % 1440) / 60);
      const m = mins % 60;
      const when = days ? `${days}d ${hrs}h` : (hrs ? `${hrs}h ${m}m` : `${m}m`);
      host.innerHTML = `<div class="gfCountdown"><span class="gfDot"></span>Green flag in ${when}</div>`;
    };

    paint();
    if (!_gfTimer) _gfTimer = setInterval(paint, 30000);
  } catch (e) {
    // countdown is decorative
  }
}

/* ==========================================================
   Race Hub: weekend schedule, starting lineup, news
   ========================================================== */

async function loadHub_() {
  const sub = document.getElementById("hubSub");
  const schedBox = document.getElementById("hubSchedule");
  const lineupBox = document.getElementById("hubLineup");
  const newsBox = document.getElementById("hubNews");
  if (!schedBox || !lineupBox || !newsBox) return;

  document.querySelectorAll("#hubSeg .segBtn").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll("#hubSeg .segBtn").forEach(x =>
        x.classList.toggle("active", x === b));
      document.querySelectorAll(".hubPane").forEach(p =>
        p.classList.toggle("active", p.id === "hubPane-" + b.dataset.hubPane));
    };
  });

  schedBox.innerHTML = `<div class="muted">Loading schedule…</div>`;

  const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "short" });
  const fmtTime = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Who has which driver this week (for lineup annotations)
  let driverOwner = new Map();
  try {
    const blob = await getPlayerRaceData_();
    const cur = blob?.matchups?.current;
    const raceBlob = cur ? blob?.matchups?.races?.[`${cur.tournament}||${cur.race}`] : null;
    for (const m of (raceBlob?.matchups || [])) {
      (m.p1Drivers || []).forEach(d => { if (d) driverOwner.set(normKey_(d), String(m.p1 || "")); });
      (m.p2Drivers || []).forEach(d => { if (d) driverOwner.set(normKey_(d), String(m.p2 || "")); });
    }
  } catch (e) { /* annotations optional */ }

  try {
    const res = await fetch("/api/weekend-hub", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || "weekend-hub failed");

    if (sub && data.race) {
      const bits = [data.race.fullName || data.race.name, data.race.track].filter(Boolean);
      sub.textContent = bits.join(" · ");
    }

    const sched = Array.isArray(data.schedule) ? data.schedule : [];
    schedBox.innerHTML = sched.length
      ? sched.map(ev => {
          // start_time_utc comes without a Z suffix; force UTC so
          // toLocale* renders in the viewer's local time zone
          let ts = String(ev.startUtc || "").trim();
          if (ts && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts)) ts += "Z";
          const d = new Date(ts);
          const bad = Number.isNaN(d.getTime());
          const past = !bad && d.getTime() < Date.now();
          return `
            <div class="hubRow ${past ? "past" : ""}">
              <div class="hubWhen">${bad ? "" : `${fmtDay(d)} ${fmtTime(d)}`}</div>
              <div class="hubWhat">${escapeHtml(ev.name)}</div>
            </div>`;
        }).join("")
      : `<div class="muted">No weekend schedule posted yet.</div>`;

    const lineup = Array.isArray(data.lineup) ? data.lineup : [];
    lineupBox.classList.remove("muted");
    lineupBox.innerHTML = lineup.length
      ? lineup.map(r => {
          const owner = driverOwner.get(normKey_(r.driver)) || "";
          return `
            <div class="hubRow lineupRow">
              <div class="lineupPos">${r.pos}</div>
              <div class="hubWhat">${r.car ? `<span class="carNo">#${escapeHtml(r.car)}</span> ` : ""}${escapeHtml(r.driver)}</div>
              ${owner ? `<div class="lineupOwner">${escapeHtml(owner)}</div>` : ""}
            </div>`;
        }).join("")
      : `<div class="muted">Lineup drops after qualifying.</div>`;
  } catch (e) {
    schedBox.innerHTML = `<div class="muted">Schedule unavailable.</div>`;
    lineupBox.innerHTML = `<div class="muted">Lineup unavailable.</div>`;
  }

  try {
    const res = await fetch("/api/nascar-news", { cache: "no-store" });
    const data = await res.json();
    const items = (data?.ok && Array.isArray(data.items)) ? data.items : [];
    newsBox.classList.remove("muted");
    newsBox.innerHTML = items.length
      ? items.map(it => {
          const d = new Date(it.pubDate || "");
          let when = "";
          if (!Number.isNaN(d.getTime())) {
            const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
            when =
              mins < 60 ? `${mins}m ago` :
              mins < 1440 ? `${Math.round(mins / 60)}h ago` :
              d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }
          return `
            <a class="newsCard" href="${escapeAttr(it.link)}" target="_blank" rel="noopener">
              <div class="newsBody">
                <div class="newsTitle">${escapeHtml(it.title)}</div>
                ${when ? `<div class="newsWhen">${when}</div>` : ""}
              </div>
              ${it.image ? `<img class="newsThumb" src="${escapeAttr(it.image)}" loading="lazy" alt="">` : ""}
            </a>`;
        }).join("")
      : `<div class="muted">No headlines right now.</div>`;
  } catch (e) {
    newsBox.innerHTML = `<div class="muted">News unavailable.</div>`;
  }
}

function normKey_(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ==========================================================
   Head-to-head record (My Matchup)
   ========================================================== */

async function h2hLineHtml_(you, opp) {
  try {
    const blob = await getPlayerRaceData_();
    const races = blob?.matchups?.races || {};
    const ny = String(you || "").trim().toLowerCase();
    const no = String(opp || "").trim().toLowerCase();
    if (!ny || !no) return "";

    let yw = 0, ow = 0;

    for (const k of Object.keys(races)) {
      for (const m of (races[k]?.matchups || [])) {
        const p1 = String(m.p1 || "").trim().toLowerCase();
        const p2 = String(m.p2 || "").trim().toLowerCase();
        const w  = String(m.winner || "").trim().toLowerCase();
        if (!w) continue;
        if ((p1 === ny && p2 === no) || (p1 === no && p2 === ny)) {
          if (w === ny) yw++;
          else if (w === no) ow++;
        }
      }
    }

    if (!yw && !ow) return "";

    const txt =
      yw === ow ? `All-time: tied ${yw}–${ow}` :
      yw > ow   ? `All-time: you lead ${yw}–${ow}` :
                  `All-time: ${escapeHtml(opp)} leads ${ow}–${yw}`;

    return `<div class="h2hLine">${txt}</div>`;
  } catch (e) {
    return "";
  }
}

/* ==========================================================
   Overall standings movement (vs last completed race)
   ========================================================== */

function overallRankDeltas_() {
  const races = _playerRaceData?.matchups?.races;
  if (!races) return null;

  const raceList = Object.values(races)
    .map(r => ({
      t: Number(r.tournament) || 0,
      rnd: Number(r.round) || 0,
      ms: (r.matchups || []).filter(m => String(m.winner || "").trim())
    }))
    .filter(r => r.ms.length);

  if (raceList.length < 2) return null;

  raceList.sort((a, b) => a.t - b.t || a.rnd - b.rnd);

  function ranksThrough(count) {
    const rec = new Map();
    for (let i = 0; i < count; i++) {
      for (const m of raceList[i].ms) {
        const p1 = String(m.p1 || "").trim().toLowerCase();
        const p2 = String(m.p2 || "").trim().toLowerCase();
        const w  = String(m.winner || "").trim().toLowerCase();
        if (!p1 || !p2 || !w) continue;
        if (!rec.has(p1)) rec.set(p1, { w: 0, l: 0 });
        if (!rec.has(p2)) rec.set(p2, { w: 0, l: 0 });
        const loser = w === p1 ? p2 : (w === p2 ? p1 : "");
        if (!loser) continue;
        rec.get(w).w++;
        rec.get(loser).l++;
      }
    }
    const sorted = [...rec.entries()]
      .sort((a, b) => b[1].w - a[1].w || a[1].l - b[1].l || (a[0] < b[0] ? -1 : 1));
    const out = new Map();
    sorted.forEach(([k], i) => out.set(k, i + 1));
    return out;
  }

  const prev = ranksThrough(raceList.length - 1);
  const cur  = ranksThrough(raceList.length);

  const deltas = new Map();
  for (const [k, r] of cur) {
    const p = prev.get(k);
    if (p) deltas.set(k, p - r);
  }
  return deltas;
}

/* ==========================================================
   Busch girls voting
   ========================================================== */

const BUSCH_VOTE_KEY = "nascar_bg_votes";

function bgVotes_() {
  try { return JSON.parse(localStorage.getItem(BUSCH_VOTE_KEY) || "{}"); }
  catch { return {}; }
}

function initBuschVotes_() {
  const likeBtn = document.getElementById("buschLikeBtn");
  const dislikeBtn = document.getElementById("buschDislikeBtn");
  const img = document.getElementById("buschPopupImg");
  if (!likeBtn || !dislikeBtn || !img) return;

  function currentPhoto_() {
    const cleanSrc = String(img.src || "").split("?")[0];
    return buschGirls.find(p => String(p.url || "").split("?")[0] === cleanSrc) || null;
  }

  function paint_() {
    const p = currentPhoto_();
    const v = p ? Number(bgVotes_()[p.id] || 0) : 0;
    likeBtn.classList.toggle("selected", v === 1);
    dislikeBtn.classList.toggle("selected", v === -1);
  }

  async function vote_(v) {
    const p = currentPhoto_();
    if (!p || !p.id) return;

    const name = loadPlayerName().trim();
    if (!name) {
      alert("Pick your name first so your vote counts.");
      return;
    }

    const votes = bgVotes_();
    votes[p.id] = v;
    try { localStorage.setItem(BUSCH_VOTE_KEY, JSON.stringify(votes)); } catch {}
    paint_();

    try {
      await fetch("/api/buschgirl-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId: p.id, playerName: name, vote: v })
      });
    } catch (e) {
      // vote stays reflected locally; server catches up next tap
    }
  }

  likeBtn.addEventListener("click", () => vote_(1));
  dislikeBtn.addEventListener("click", () => vote_(-1));
  new MutationObserver(paint_).observe(img, { attributes: true, attributeFilter: ["src"] });
}

/* ==========================================================
   Admin: Busch girls photo ratings + removal
   ========================================================== */

async function loadBuschRatings_() {
  const box = document.getElementById("buschRatingsList");
  if (!box) return;

  box.innerHTML = `<div class="muted">Loading ratings…</div>`;

  try {
    const data = await adminFetch_("/api/buschgirl-vote", { cache: "no-store" });
    const rows = Array.isArray(data?.photos) ? data.photos : [];

    if (!rows.length) {
      box.innerHTML = `<div class="muted">No photos found.</div>`;
      return;
    }

    box.innerHTML =
      `<div class="muted" style="margin:8px 0 4px;">Least popular first · ${rows.length} voted photo${rows.length === 1 ? "" : "s"}</div>` +
      rows.map(p => `
        <div class="bgRateRow" data-id="${escapeAttr(String(p.id))}">
          <img src="${escapeAttr(p.url)}" loading="lazy" alt="">
          <div class="bgRateInfo">
            <div class="bgRateName">${escapeHtml(p.folder)}/${escapeHtml(p.filename)}</div>
            <div class="bgRateVotes">
              <button class="bgVoteChip" type="button" data-voters="${escapeAttr((p.likedBy || []).join("|"))}" aria-label="Show likes">👍 ${Number(p.likes) || 0}</button>
              <button class="bgVoteChip" type="button" data-voters="${escapeAttr((p.dislikedBy || []).join("|"))}" aria-label="Show dislikes">👎 ${Number(p.dislikes) || 0}</button>
              <span>net ${p.net > 0 ? "+" : ""}${Number(p.net) || 0}</span>
            </div>
            <div class="bgVoterList" hidden></div>
          </div>
          <button class="bgRemoveBtn" type="button">Remove</button>
        </div>
      `).join("");

    box.querySelectorAll(".bgVoteChip").forEach(btn => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".bgRateRow");
        const list = row?.querySelector(".bgVoterList");
        if (!list) return;

        const voters = String(btn.dataset.voters || "")
          .split("|")
          .map(v => v.trim())
          .filter(Boolean);

        const wasOpen = !list.hidden && btn.classList.contains("active");

        row.querySelectorAll(".bgVoteChip").forEach(chip => chip.classList.remove("active"));
        if (wasOpen) {
          list.hidden = true;
          list.innerHTML = "";
          return;
        }

        btn.classList.add("active");
        list.hidden = false;
        list.innerHTML = voters.length
          ? voters.map(v => `<span>${escapeHtml(v)}</span>`).join("")
          : `<span class="muted">No votes yet</span>`;
      });
    });

    box.querySelectorAll(".bgRemoveBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".bgRateRow");
        const photoId = String(row?.dataset?.id || "");
        if (!photoId) return;
        if (!confirm("Remove this photo from the rotation?")) return;

        btn.disabled = true;
        try {
          const res = await adminFetch_("/api/remove-buschgirl", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoId })
          });
          if (res?.ok) row.remove();
          else {
            alert(res?.error || "Remove failed");
            btn.disabled = false;
          }
        } catch (e) {
          alert(e.message || String(e));
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="muted">Error: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function preloadBuschImage_(src) {
  if (!src) return;

  const img = new Image();
  img.src = src;
}

async function loadBuschGirls() {
  try {
    const res = await fetch("/api/buschgirls", { cache: "no-store" });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Failed loading Busch Girls");
    }

    buschGirls = (data.photos || [])
      .map(p => ({
        id: String(p.id || ""),
        url: String(p.url || "").trim(),
        folder: String(p.folder || "").trim().toLowerCase(),
        filename: String(p.filename || "").trim(),
        uploadedAt: String(p.uploaded_at || "").trim()
      }))
      .filter(p => p.url && p.folder);
    
    refillQueue();
    buschQueue.slice(0, 5).forEach(p => preloadBuschImage_(p.url));
  } catch (err) {
    console.error("Failed to load Busch Girls", err);
    buschGirls = [];
    buschQueue = [];
  }
}

function shuffle_(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function takeRandom_(arr, count) {
  return shuffle_(arr).slice(0, count);
}

function activePlayerIsTyler_() {
  return String(loadPlayerName() || "").trim().toLowerCase() === "tyler";
}

function refillQueue() {
  const soft = buschGirls.filter(p => p.folder === "soft");
  const old = buschGirls.filter(p => p.folder === "old");
  const spicy = buschGirls.filter(p => p.folder === "spicy");
  const spicier = buschGirls.filter(p => p.folder === "spicier");

  const warmup = takeRandom_(soft, Math.min(BUSCH_WARMUP_COUNT, soft.length));
  const warmupUrls = new Set(warmup.map(p => p.url));

  const isTyler = activePlayerIsTyler_();

  if (isTyler) {
    buschQueue = [
      ...warmup,
      ...shuffle_(old.filter(p => !warmupUrls.has(p.url)))
    ];
    return;
  }

  function uploadWeight_(p) {
    const t = Date.parse(p.uploadedAt || "");
    if (!Number.isFinite(t)) return 1;

    const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);

    if (ageDays <= 7) return 8;
    if (ageDays <= 30) return 3;
    return 1;
  }

  const eligibleMain = [
    ...spicy,
    ...spicier,
    ...soft.filter(p => !warmupUrls.has(p.url))
  ];

  const weightedMain = [];

  eligibleMain.forEach(p => {
    const weight = uploadWeight_(p);

    for (let i = 0; i < weight; i++) {
      weightedMain.push(p);
    }
  });

  const main = shuffle_(weightedMain);

  buschQueue = [...warmup, ...main];
}

function getRandomBuschGirl() {
  if (!buschGirls.length) return null;

  if (!buschQueue.length) {
    refillQueue();
  }

  while (buschQueue.length) {
    const next = buschQueue.shift();
    const url = next?.url || "";

    if (!url) continue;
    if (buschSeenUrls.has(url)) continue;

    buschSeenUrls.add(url);
    return url;
  }

  // If we somehow burned through everything, reset and start over.
  buschSeenUrls.clear();
  refillQueue();

  const next = buschQueue.shift();
  if (next?.url) buschSeenUrls.add(next.url);

  return next?.url || null;
}

function initBuschLongPress_() {
  const trigger = document.getElementById("buschLogoTrigger");
  const logo = document.getElementById("buschLogo");
  const popup = document.getElementById("buschPopup");
  const closeBtn = document.getElementById("buschPopupClose");
  const backdrop = popup?.querySelector(".buschPopupBackdrop");
  const popupImg = document.querySelector(".buschPopupImg");

  if (!trigger || !popup) return;

  if (closeBtn) closeBtn.style.display = "none";

  let buschHistory = [];
  let buschHistoryIndex = -1;

  function showBuschImage_(src) {
    if (popupImg && src) {
      zReset_(false);
      popupImg.src = src;
    }
  }

  function nextBuschImage_() {
    if (buschHistoryIndex < buschHistory.length - 1) {
      buschHistoryIndex += 1;
      showBuschImage_(buschHistory[buschHistoryIndex]);
      return;
    }

    const nextImg = getRandomBuschGirl();
    if (!nextImg) return;

    buschHistory.push(nextImg);
    buschHistoryIndex = buschHistory.length - 1;
    showBuschImage_(nextImg);

    buschQueue.slice(0, 3).forEach(p => preloadBuschImage_(p.url));
  }

  function prevBuschImage_() {
    if (buschHistoryIndex > 0) {
      buschHistoryIndex -= 1;
      showBuschImage_(buschHistory[buschHistoryIndex]);
    }
  }

  // Best manual haptic hack we have
  let hapticDiv = null;
  function triggerHaptic() {
    if (!hapticDiv) {
      hapticDiv = document.createElement("div");
      hapticDiv.style.cssText = "position:absolute; left:-9999px; opacity:0; pointer-events:none; z-index:-1;";
      hapticDiv.innerHTML = `<input type="checkbox" id="bh" switch><label for="bh"></label>`;
      document.body.appendChild(hapticDiv);
    }
    const label = hapticDiv.querySelector("label");
    const input = hapticDiv.querySelector("input");
    if (label && input) {
      label.click();
      setTimeout(() => {
        input.checked = false;
        label.click();
      }, 16);
    }
  }

  function suppressNativePress(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  logo?.addEventListener("contextmenu", suppressNativePress);
  logo?.addEventListener("dragstart", suppressNativePress);
  logo?.addEventListener("selectstart", suppressNativePress);

  trigger.addEventListener("dragstart", suppressNativePress);
  trigger.addEventListener("selectstart", suppressNativePress);

  let buschPhotoMenuEl = null;
  let buschSaveSheetEl = null;
  const coarsePointer_ = window.matchMedia("(pointer: coarse)").matches;

function buschPhotoInfoFromSrc_(src) {
  const cleanSrc = String(src || "").split("?")[0];

  const found = buschGirls.find(p =>
    String(p.url || "").split("?")[0] === cleanSrc
  );

  const url = found?.url || cleanSrc;
  const parts = url.split("/");
  const file = found?.filename || decodeURIComponent(parts.pop() || "");
  const folder = found?.folder || decodeURIComponent(parts.pop() || "");

  return { id: found?.id || "", folder, file, url };
}

function currentBuschPhotoInfo_() {
  if (!popupImg?.src) return;
  return buschPhotoInfoFromSrc_(popupImg.src);
}

function showBuschPhotoInfo_() {
  const info = currentBuschPhotoInfo_();
  if (!info) return;

  alert(
    `Folder: ${info.folder || "(unknown)"}\n` +
    `File: ${info.file || "(unknown)"}`
  );
}

function closePhotoMenu_() {
  if (buschPhotoMenuEl) {
    buschPhotoMenuEl.remove();
    buschPhotoMenuEl = null;
  }
}

function closeBuschSaveSheet_() {
  if (buschSaveSheetEl) {
    buschSaveSheetEl.remove();
    buschSaveSheetEl = null;
  }
}

function downloadBuschPhoto_(info) {
  if (!info?.url) return;

  const a = document.createElement("a");
  a.href = info.url;
  a.download = info.file || "busch-photo";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function fetchBuschPhotoFile_(info) {
  const res = await fetch(info.url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load photo.");
  const blob = await res.blob();
  const ext = String(info.file || "").split(".").pop() || "jpg";
  const type = blob.type || `image/${ext}`;
  const file = new File([blob], info.file || `busch-photo.${ext}`, { type });
  return file;
}

function showBuschPhotoSaveSheet_(info) {
  if (!info?.url) return;

  closeBuschSaveSheet_();
  closePhotoMenu_();

  const sheet = document.createElement("div");
  sheet.className = "buschSaveSheet";
  sheet.innerHTML = `
    <div class="buschSaveSheetHint">Press and hold the image for Save Image / Add to Photos</div>
    <img class="buschSaveSheetImg" src="${escapeAttr(info.url)}" alt="${escapeAttr(info.file || "Busch photo")}">
    <button type="button" class="buschSaveSheetDone">Done</button>
  `;

  sheet.querySelector(".buschSaveSheetDone")?.addEventListener("click", closeBuschSaveSheet_);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeBuschSaveSheet_();
  });

  document.body.appendChild(sheet);
  buschSaveSheetEl = sheet;
}

async function saveBuschPhotoImage_(info) {
  if (!info?.url) return;

  if (!coarsePointer_) {
    try {
      const file = await fetchBuschPhotoFile_(info);
      const blobUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = info.file || "busch-photo.jpg";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      return;
    } catch {
      downloadBuschPhoto_(info);
      return;
    }
  }

  try {
    const file = await fetchBuschPhotoFile_(info);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: info.file || "Busch photo"
      });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }

  showBuschPhotoSaveSheet_(info);
}

async function copyBuschPhotoLink_(info) {
  if (!info?.url) return;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(info.url);
      alert("Photo link copied.");
      return;
    } catch {}
  }

  window.prompt("Copy photo link:", info.url);
}

async function unlockAdminForPhotoDelete_() {
  if (getAdminToken_()) return true;

  const pin = prompt("Admin PIN to delete this photo:");
  if (pin === null) return false;

  const cleanPin = String(pin || "").trim();
  if (!cleanPin) return false;

  const res = await fetch("/api/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: cleanPin })
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data?.ok || !data?.token) {
    throw new Error(data?.error || "Invalid PIN");
  }

  setAdminToken_(data.token);
  return true;
}

async function deleteBuschPhoto_(info, allowRetry = true) {
  if (!info?.id) {
    alert("Could not find this photo in the active gallery.");
    return;
  }

  let unlocked = false;
  try {
    unlocked = await unlockAdminForPhotoDelete_();
  } catch (err) {
    alert(err.message || String(err));
    return;
  }
  if (!unlocked) return;

  if (!confirm(`Delete this photo from the rotation?\n\n${info.file || info.id}`)) return;

  try {
    await adminFetch_("/api/remove-buschgirl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: info.id })
    });

    buschGirls = buschGirls.filter(p => p.id !== info.id);
    buschQueue = buschQueue.filter(p => p.id !== info.id);
    buschSeenUrls.delete(info.url);
    buschHistory = buschHistory.filter(src => String(src || "").split("?")[0] !== String(info.url || "").split("?")[0]);
    buschHistoryIndex = Math.min(buschHistoryIndex, buschHistory.length - 1);

    if (buschGirls.length) nextBuschImage_();
    else closePopup();
  } catch (err) {
    if (allowRetry && /unauthorized|expired/i.test(err.message || "")) {
      clearAdminToken_();
      await deleteBuschPhoto_(info, false);
      return;
    }
    alert(err.message || String(err));
  }
}

function showBuschPhotoMenu_(x, y) {
  const info = currentBuschPhotoInfo_();
  if (!info) return;

  closePhotoMenu_();

  const menu = document.createElement("div");
  menu.className = "buschPhotoMenu";
  menu.innerHTML = `
    <div class="buschPhotoMenuPanel" role="menu" aria-label="Photo options">
      <button type="button" role="menuitem" data-action="view">View Full Res Photo</button>
      <button type="button" role="menuitem" data-action="save">Save Image</button>
      <button type="button" role="menuitem" data-action="info">Get Info</button>
      <button type="button" role="menuitem" data-action="delete" class="danger">Delete Photo</button>
    </div>
  `;

  document.body.appendChild(menu);

  const panel = menu.querySelector(".buschPhotoMenuPanel");
  const rect = panel.getBoundingClientRect();
  const pad = 14;
  const left = Math.min(Math.max(x - rect.width / 2, pad), window.innerWidth - rect.width - pad);
  const preferredTop = y < window.innerHeight * 0.55 ? y + 18 : y - rect.height - 18;
  const top = Math.min(Math.max(preferredTop, pad), window.innerHeight - rect.height - pad);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  menu.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".buschPhotoMenuPanel")) closePhotoMenu_();
  });

  menu.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.action;
      closePhotoMenu_();

      if (action === "view") window.open(info.url, "_blank", "noopener");
      else if (action === "save") await saveBuschPhotoImage_(info);
      else if (action === "info") showBuschPhotoInfo_();
      else if (action === "delete") await deleteBuschPhoto_(info);
    });
  });

  buschPhotoMenuEl = menu;
}

  function openPopup() {
    nextBuschImage_();

    triggerHaptic();
    if (navigator.vibrate) navigator.vibrate([8, 12]);

    popup.hidden = false;
    document.body.style.overflow = "hidden";
    document.body.classList.add("noSelect");
  }

  function closePopup() {
    closePhotoMenu_();
    closeBuschSaveSheet_();
    cancelLogoHold_();
    cancelPhotoHold_();
    zReset_(false);
    zPtrs.clear();
    popup.hidden = true;
    document.body.style.overflow = "";
    document.body.classList.remove("noSelect");
  }

  /* ----------------------------------------------------------
     Logo: hold 1s (touch or mouse) opens the popup.
     Right-click on desktop (and Android's long-press
     contextmenu) opens it too.
     ---------------------------------------------------------- */

  const HOLD_MOVE_THRESHOLD = 10;
  const TAP_MOVE_THRESHOLD = 8;

  let logoTimer = null;
  let logoX = 0;
  let logoY = 0;

  function cancelLogoHold_() {
    if (logoTimer) { clearTimeout(logoTimer); logoTimer = null; }
  }

  // Non-passive preventDefault on touchstart is what lets the hold
  // timer paint MID-HOLD on iOS: without it, WebKit's native
  // long-press recognizer defers our menu render until release.
  // (The original logo long-press always had this - proven pattern.)
  trigger.addEventListener("touchstart", (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  trigger.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    logoX = e.clientX || 0;
    logoY = e.clientY || 0;
    cancelLogoHold_();
    logoTimer = setTimeout(() => {
      logoTimer = null;
      openPopup();
    }, 1000);
  });

  trigger.addEventListener("pointermove", (e) => {
    if (!logoTimer) return;
    if (Math.abs((e.clientX || 0) - logoX) > HOLD_MOVE_THRESHOLD ||
        Math.abs((e.clientY || 0) - logoY) > HOLD_MOVE_THRESHOLD) {
      cancelLogoHold_();
    }
  });

  trigger.addEventListener("pointerup", cancelLogoHold_);
  trigger.addEventListener("pointercancel", cancelLogoHold_);

  trigger.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelLogoHold_();
    if (popup.hidden) openPopup();
  });

  /* ----------------------------------------------------------
     Photo: tap left/right half = prev/next.
     Hold 650ms fires the photo menu mid-hold; desktop
     right-click opens the same menu.
     ---------------------------------------------------------- */

  let photoTimer = null;
  let photoDownX = 0;
  let photoDownY = 0;
  let photoMenuFired = false;

  function cancelPhotoHold_() {
    if (photoTimer) { clearTimeout(photoTimer); photoTimer = null; }
  }

  function firePhotoMenu_(x, y) {
    cancelPhotoHold_();
    photoMenuFired = true;
    if (navigator.vibrate) navigator.vibrate(8);
    showBuschPhotoMenu_(x || 0, y || 0);
  }

  /* --- Pinch zoom / pan / double-tap (Photos-app style) --- */

  const zPtrs = new Map();
  let zScale = 1, zTx = 0, zTy = 0;
  let zBaseW = 0, zBaseH = 0, zBaseLeft = 0, zBaseTop = 0;
  let pinchStart = null;
  let panLast = null;
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
  let navTapTimer = null;

  function zApply_(animate) {
    if (!popupImg) return;
    popupImg.classList.toggle("zoomAnim", !!animate);
    popupImg.style.transform = (zScale === 1 && !zTx && !zTy)
      ? ""
      : `translate(${zTx}px, ${zTy}px) scale(${zScale})`;
  }

  function zReset_(animate) {
    zScale = 1; zTx = 0; zTy = 0;
    pinchStart = null; panLast = null;
    zApply_(animate);
  }

  function zMeasureBase_() {
    const prev = popupImg.style.transform;
    popupImg.style.transform = "";
    const r = popupImg.getBoundingClientRect();
    zBaseW = r.width; zBaseH = r.height;
    zBaseLeft = r.left; zBaseTop = r.top;
    popupImg.style.transform = prev;
  }

  function zClamp_() {
    zScale = Math.min(4, Math.max(1, zScale));
    zTx = Math.min(0, Math.max(zBaseW - zScale * zBaseW, zTx));
    zTy = Math.min(0, Math.max(zBaseH - zScale * zBaseH, zTy));
  }

  function zZoomAt_(mx, my) {
    zMeasureBase_();
    const lx = mx - zBaseLeft;
    const ly = my - zBaseTop;
    zScale = 2.5;
    zTx = lx - zScale * lx;
    zTy = ly - zScale * ly;
    zClamp_();
    zApply_(true);
  }

  popupImg?.addEventListener("load", () => {
    zReset_(false);
    zMeasureBase_();
  });

  // Same preventDefault trick as the logo: keeps iOS painting our
  // 650ms menu during the hold instead of deferring it to release.
  // Tap-nav lives on pointerup and click is swallowed, so nothing
  // else here depends on native touch behavior.
  popupImg?.addEventListener("touchstart", (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  popupImg?.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    zPtrs.set(e.pointerId, { x: e.clientX || 0, y: e.clientY || 0 });
    try { popupImg.setPointerCapture(e.pointerId); } catch (err) {}

    if (zPtrs.size === 2) {
      // second finger down: switch to pinch mode
      cancelPhotoHold_();
      if (navTapTimer) { clearTimeout(navTapTimer); navTapTimer = null; }
      zMeasureBase_();
      const [a, b] = [...zPtrs.values()];
      pinchStart = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: zScale, tx: zTx, ty: zTy,
        midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2
      };
      panLast = null;
      return;
    }
    if (zPtrs.size > 2) return;

    photoDownX = e.clientX || 0;
    photoDownY = e.clientY || 0;
    photoMenuFired = false;

    if (zScale > 1) {
      panLast = { x: photoDownX, y: photoDownY };
      return;
    }

    cancelPhotoHold_();
    photoTimer = setTimeout(() => {
      photoTimer = null;
      firePhotoMenu_(photoDownX, photoDownY);
    }, 650);
  });

  popupImg?.addEventListener("pointermove", (e) => {
    if (zPtrs.has(e.pointerId)) {
      zPtrs.set(e.pointerId, { x: e.clientX || 0, y: e.clientY || 0 });
    }

    if (pinchStart && zPtrs.size >= 2) {
      const [a, b] = [...zPtrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      // keep the image point that was under the fingers under them
      const px = ((pinchStart.midX - zBaseLeft) - pinchStart.tx) / pinchStart.scale;
      const py = ((pinchStart.midY - zBaseTop) - pinchStart.ty) / pinchStart.scale;
      zScale = Math.min(4, Math.max(1, pinchStart.scale * dist / pinchStart.dist));
      zTx = (midX - zBaseLeft) - zScale * px;
      zTy = (midY - zBaseTop) - zScale * py;
      zClamp_();
      zApply_(false);
      return;
    }

    if (panLast && zScale > 1 && zPtrs.size === 1) {
      zTx += (e.clientX || 0) - panLast.x;
      zTy += (e.clientY || 0) - panLast.y;
      panLast = { x: e.clientX || 0, y: e.clientY || 0 };
      zClamp_();
      zApply_(false);
      return;
    }

    if (!photoTimer) return;
    if (Math.abs((e.clientX || 0) - photoDownX) > HOLD_MOVE_THRESHOLD ||
        Math.abs((e.clientY || 0) - photoDownY) > HOLD_MOVE_THRESHOLD) {
      cancelPhotoHold_();
    }
  });

  popupImg?.addEventListener("pointerup", (e) => {
    zPtrs.delete(e.pointerId);

    if (pinchStart) {
      if (zPtrs.size < 2) {
        pinchStart = null;
        if (zScale <= 1.05) zReset_(true);
        else {
          const rest = zPtrs.values().next().value;
          panLast = rest ? { x: rest.x, y: rest.y } : null;
        }
      }
      return;
    }

    const menuShown = photoMenuFired;
    cancelPhotoHold_();
    if (menuShown) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const upX = e.clientX || 0;
    const upY = e.clientY || 0;
    const moved =
      Math.abs(upX - photoDownX) > TAP_MOVE_THRESHOLD ||
      Math.abs(upY - photoDownY) > TAP_MOVE_THRESHOLD;

    if (zScale > 1) {
      panLast = null;
      if (moved) return;
      const now = Date.now();
      if (now - lastTapAt < 300 &&
          Math.abs(upX - lastTapX) < 30 && Math.abs(upY - lastTapY) < 30) {
        lastTapAt = 0;
        zReset_(true);
      } else {
        lastTapAt = now; lastTapX = upX; lastTapY = upY;
      }
      return;
    }

    if (moved) return;

    const now = Date.now();
    if (now - lastTapAt < 300 &&
        Math.abs(upX - lastTapX) < 30 && Math.abs(upY - lastTapY) < 30) {
      // double-tap: zoom in at the tap point
      lastTapAt = 0;
      if (navTapTimer) { clearTimeout(navTapTimer); navTapTimer = null; }
      zZoomAt_(upX, upY);
      return;
    }

    lastTapAt = now; lastTapX = upX; lastTapY = upY;

    // single tap navigates, delayed briefly to leave room for a double-tap
    if (navTapTimer) clearTimeout(navTapTimer);
    navTapTimer = setTimeout(() => {
      navTapTimer = null;
      const rect = popupImg.getBoundingClientRect();
      if (upX - rect.left < rect.width / 2) prevBuschImage_();
      else nextBuschImage_();
    }, 280);
  });

  popupImg?.addEventListener("pointercancel", (e) => {
    zPtrs.delete(e.pointerId);
    if (zPtrs.size < 2) pinchStart = null;
    panLast = null;
    cancelPhotoHold_();
    if (zScale <= 1.05) zReset_(false);
  });

  // Navigation is handled on pointerup; swallow the synthetic click
  // so nothing double-fires.
  popupImg?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  popupImg?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    firePhotoMenu_(e.clientX, e.clientY);
  });

  function closeIfOutsideCard(e) {
    if (!e.isPrimary) return; // second pinch finger must not close the popup
    if (!e.target.closest(".buschPopupCard")) {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
    }
  }

  popup.addEventListener("pointerdown", closeIfOutsideCard);

  document.addEventListener("keydown", e => {
    if (buschSaveSheetEl && e.key === "Escape") {
      closeBuschSaveSheet_();
      return;
    }

    if (popup.hidden) return;

    if (e.key === "Escape") closePopup();
    if (e.key === "ArrowLeft") prevBuschImage_();
    if (e.key === "ArrowRight") nextBuschImage_();
  });
}

async function sendTestPush_() {
  const playerName = prompt(
    "Player name (leave blank for everyone):",
    ""
  );
  
  const title = prompt("Push title:", "NASCAR Pool");
    if (title === null) return;

  const body = prompt("Push message:");
  if (body === null) return;

  const cleanTitle = String(title || "").trim();
  const cleanBody = String(body || "").trim();

  if (!cleanTitle || !cleanBody) {
    alert("Title and message are required.");
    return;
  }

  if (!confirm(`Send this push to all subscribers?\n\n${cleanTitle}\n${cleanBody}`)) {
    return;
  }

  setAdminStatus_("adminFundsStatus", "Sending push...");

  try {
    const data = await adminFetch_("/api/send-push-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName: String(playerName || "").trim(),
        title: cleanTitle,
        body: cleanBody,
        url: "/"
      })
    });

    /*alert(`Push sent: ${data.sent || 0} sent, ${data.failed || 0} failed`);*/
    alert(JSON.stringify(data, null, 2));
    setAdminStatus_("adminFundsStatus", `Push sent: ${data.sent || 0} sent, ${data.failed || 0} failed.`);
  } catch (err) {
    alert(err.message || String(err));
    setAdminStatus_("adminFundsStatus", err.message || String(err), true);
  }
}

function initAdminControls_() {
    const portal = document.getElementById("playerPortalPill");
    const pinBackdrop = document.getElementById("adminPinBackdrop");
    const pinInput = document.getElementById("adminPinInput");
    const closeBtn = document.getElementById("adminCloseBtn");
    const lockBtn = document.getElementById("adminLockBtn");

    let pressTimer = null;

    function startPress() {
      clearTimeout(pressTimer);

      pressTimer = setTimeout(async () => {
        clearTimeout(pressTimer);
        pressTimer = null;

        // If already unlocked, open admin tools directly.
        if (getAdminToken_()) {
          try {
            await initAdminOverlay_();
            openAdminOverlay_();
            return;
          } catch (err) {
            // Token is stale/invalid, clear it and fall back to PIN.
            clearAdminToken_();
            _adminContext = null;
            setAdminStatus_("adminPinStatus", "Session expired. Enter PIN again.", true);
          }
        }

        openAdminPin_();
      }, 300);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  if (portal && !portal.dataset.adminBound) {
    portal.dataset.adminBound = "1";
    portal.addEventListener("mousedown", startPress);
    portal.addEventListener("touchstart", startPress, { passive: true });
    portal.addEventListener("mouseup", cancelPress);
    portal.addEventListener("mouseleave", cancelPress);
    portal.addEventListener("touchend", cancelPress);
    portal.addEventListener("touchcancel", cancelPress);
  }

  if (pinInput && !pinInput.dataset.bound) {
    pinInput.dataset.bound = "1";
    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAdminPin_();
        return;
      }
      if (e.key === "Enter") {
        unlockAdmin_();
      }
    });
    pinInput.addEventListener("input", () => {
      const pin = String(pinInput.value || "").trim();
      setAdminStatus_("adminPinStatus", "", false);
      if (pin.length === ADMIN_PIN_LENGTH) {
        unlockAdmin_();
      }
    });
  }

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "1";
    closeBtn.addEventListener("click", () => {
      closeAdminOverlay_();
    });
  }

  if (lockBtn && !lockBtn.dataset.bound) {
    lockBtn.dataset.bound = "1";
    lockBtn.addEventListener("click", () => {
      clearAdminToken_();
      _adminContext = null;
      closeAdminOverlay_();
    });
  }

  document.querySelectorAll(".adminTab").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      setAdminTab_(btn.dataset.adminTab);
    });
  });

  document.getElementById("adminAssignBtn")?.addEventListener("click", () =>
    runAdminRaceOp_("/api/generate-assignments", "adminRaceOpsStatus", "Generating assignments")
  );

  document.getElementById("adminQualBtn")?.addEventListener("click", () =>
    runAdminRaceOp_("/api/import-qualifying", "adminRaceOpsStatus", "Importing qualifying")
  );

  document.getElementById("adminResultsBtn")?.addEventListener("click", () =>
    runAdminRaceOp_("/api/import-results", "adminRaceOpsStatus", "Importing results")
  );

  document.getElementById("adminSaveSeedsBtn")?.addEventListener("click", saveAdminSeeds_);
  const wheelOpenBtn = document.getElementById("adminSeedWheelOpenBtn");
  const wheelCanvas = document.getElementById("adminSeedWheelCanvas");
  const wheelResetBtn = document.getElementById("adminSeedWheelResetBtn");
  const wheelCloseBtn = document.getElementById("adminSeedWheelCloseBtn");
  const wheelBackdrop = ensureAdminSeedWheelBackdropInBody_();
  if (wheelOpenBtn && !wheelOpenBtn.dataset.bound) {
    wheelOpenBtn.dataset.bound = "1";
    wheelOpenBtn.addEventListener("click", openAdminSeedWheel_);
  }
  if (wheelCanvas && !wheelCanvas.dataset.bound) {
    wheelCanvas.dataset.bound = "1";
    wheelCanvas.addEventListener("click", spinAdminSeedWheel_);
  }
  if (wheelResetBtn && !wheelResetBtn.dataset.bound) {
    wheelResetBtn.dataset.bound = "1";
    wheelResetBtn.addEventListener("click", resetAdminSeedWheel_);
  }
  if (wheelCloseBtn && !wheelCloseBtn.dataset.bound) {
    wheelCloseBtn.dataset.bound = "1";
    wheelCloseBtn.addEventListener("click", closeAdminSeedWheel_);
  }
  if (wheelBackdrop && !wheelBackdrop.dataset.bound) {
    wheelBackdrop.dataset.bound = "1";
    wheelBackdrop.addEventListener("click", (e) => {
      if (e.target === wheelBackdrop) closeAdminSeedWheel_();
    });
  }
  document.getElementById("adminAddFundsBtn")?.addEventListener("click", addFunds_);
  document.getElementById("adminMarkPaidOutBtn")?.addEventListener("click", markPaidOut_);
  document.getElementById("adminWhoIOweBtn")?.addEventListener("click", showWhoIOwe_);
  document.getElementById("adminPausePushBtn")?.addEventListener("click", () => adminSetPushPaused_(true));
  document.getElementById("adminResumePushBtn")?.addEventListener("click", () => adminSetPushPaused_(false));
  document.getElementById("adminClearSeedsBtn")?.addEventListener("click", clearSeeds_);
  document.getElementById("adminClearAssignmentsBtn")?.addEventListener("click", clearAssignments_);
  document.getElementById("buschUploadBtn")?.addEventListener("click", uploadBuschGirls_);
  document.getElementById("buschRatingsBtn")?.addEventListener("click", loadBuschRatings_);
  document.getElementById("adminTestPushBtn")?.addEventListener("click", sendTestPush_);
}



  window.addEventListener("resize", () => {
    if (_statsMode !== "overall" && _statsMode !== "tourney") return;

    clearTimeout(_nameWTimer);
    _nameWTimer = setTimeout(() => {
      syncOverallNameColumnWidth_();
    }, 150);
  });
  
  async function forcePwaUpdate_() {
    if (!("serviceWorker" in navigator)) return;

    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;

    await reg.update();

    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  }

  window.onload = async () => {
    await forcePwaUpdate_();
    initPushNotifications_();
    initAdminControls_();
    loadPlayersThenInit();
    persistHScroll(".navInner", "nascar_nav_scroll");
    await loadBuschGirls();
    initBuschLongPress_();
    initBuschVotes_();
    renderGreenFlagCountdown_();
    showKyleTributeOnLoad_();

    startLivePolling_();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && activeView === "live") {
        loadLiveMatchups();
      }
    });
    
    window.addEventListener("pageshow", () => {
      if (activeView === "live") {
        loadLiveMatchups();
        startLivePolling_();
      }
    });
  };
