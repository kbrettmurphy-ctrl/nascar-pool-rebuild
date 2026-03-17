  /* ==========================================================
   App constants + state
   ========================================================== */

  const STORAGE_KEY = "nascar_pool_player_name";
  const VIEW_KEY = "nascar_pool_active_view";
  const SPOILER_KEY = "nascar_pool_spoilers_on";
  const ADMIN_TOKEN_KEY = "nascar_pool_admin_token";

  const TOURNAMENT_PAYOUTS = {
    1: "🖕🏻$100",
    2: "$60",
    3: "$40",
    4: "$20"
  };

  const roundLabel = (n) => (Number(n) === 4 ? "Final" : `Rnd ${n}`);
  const views = ["current","live","mymatchup","standings","dues","bracket"];

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
  let _adminLongPressTimer = null;
  let _adminLongPressTriggered = false;
  let _currentLoaded = false;
  let _standingsLoaded = false;
  let _duesLoaded = false;
  let _myMatchupLoaded = false;
  let _bracketLoaded = false;

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
    btn.style.background = on ? "rgba(228, 0, 43, .4)" : "rgba(0,122,194,.18)";
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
    const res = await fetch(`/api/player-bracket${qs}`);
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

    info.innerHTML =
      `Lap ${race.lap ?? "-"} • ${race.lapsToGo ?? "-"} to go`;

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
        : `<span class="microMeta">No drivers assigned yet</span>`;

      const p2Drivers = (m.p2Drivers || []).length
        ? (m.p2Drivers || []).map(driverLine).join("<br>")
        : `<span class="microMeta">No drivers assigned yet</span>`;

      const leaderLine =
        m.leader
          ? `${m.leader === "Tie" ? "Leader: Tie" : `Leader: ${escapeHtml(m.leader)}`}`
          : `Leader: -`;

      return `
        <div class="microBox liveMatchupCard"
             data-p1="${escapeAttr(String(m.p1 || "").trim().toLowerCase())}"
             data-p2="${escapeAttr(String(m.p2 || "").trim().toLowerCase())}"
             style="margin-bottom:10px;">

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
    const input = document.getElementById("adminPinInput");
    const status = document.getElementById("adminPinStatus");
    if (!backdrop) return;
    status.textContent = "";
    input.value = "";
    backdrop.hidden = false;
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
  const pin = String(document.getElementById("adminPinInput")?.value || "").trim();
  if (!pin) {
    setAdminStatus_("adminPinStatus", "Enter PIN.", true);
    return;
  }

  setAdminStatus_("adminPinStatus", "Checking...");

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

    // Load admin data FIRST while PIN modal is still open
    await initAdminOverlay_();

    // Only close PIN after admin overlay is ready
    closeAdminPin_();
    openAdminOverlay_();

  } catch (err) {
    clearAdminToken_();
    _adminContext = null;
    setAdminStatus_("adminPinStatus", err.message || String(err), true);
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
      html += renderSeedRow(i + 8);
    }

    grid.innerHTML = html;

    document.querySelectorAll(".seed-player-select").forEach(select => {
      select.addEventListener("change", updateSeedDropdowns_);
    });

    updateSeedDropdowns_();
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

refreshActiveView();
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
      renderAdminSeeds_();
    } catch (err) {
      alert(err.message || String(err));
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
      bracket: "nav-bracket"
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
      setWelcome();
      checkDuesNag_();
      autoSizePlayerSelect_(gp);

      // update row highlighting everywhere immediately
      applyYouRowsNow_();

      // refresh views that depend on selected player
      if (activeView === "mymatchup") {
        await loadMyMatchup();
        await loadDues();
      }

      // always rebuild live ordering immediately
      await loadLiveMatchups();
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

    for (const m of (data.matchups || [])) {
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
            <div class="microMeta" style="font-weight:400; color: rgba(255,255,255,.9);">
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
            <div class="microMeta" style="font-weight:400; color: rgba(255,255,255,.9);">
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

      out.innerHTML =
        `<div class="microBox">
          <div>${paidLine}</div>
          <div>Winnings: $${winnings.toFixed(2)}</div>
          <div>${balanceLine}</div>
        </div>`;

    } catch (e) {
      out.textContent = "Error: " + (e && e.message ? e.message : e);
    }
  }

  const DUES_PER_RACE = 5;

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

      html += `
        <div class="statsRow overallRow ${isYou ? "youRow" : ""}">
          <div class="rankBadge">${escapeHtml(rank || "—")}</div>
          <div class="statsName">${escapeHtml(name)}</div>
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
        <select id="bracketTournamentPick" style="width:130px; min-width:130px;">
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

async function loadBuschGirls() {
  try {
    const res = await fetch("/img/buschgirls/manifest.json", { cache: "no-store" });
    const data = await res.json();

    if (Array.isArray(data)) {
      buschGirls = data;
    }
  } catch (err) {
    console.error("Failed to load Busch girls manifest", err);
  }
}

let lastBuschGirl = null;

function getRandomBuschGirl() {
  if (!buschGirls.length) return null;

  let img;
  do {
    img = buschGirls[Math.floor(Math.random() * buschGirls.length)];
  } while (buschGirls.length > 1 && img === lastBuschGirl);

  lastBuschGirl = img;
  return img;
}

function initBuschLongPress_() {
  const logo = document.getElementById("buschLogoTrigger");
  const popup = document.getElementById("buschPopup");
  const closeBtn = document.getElementById("buschPopupClose");
  const backdrop = popup?.querySelector(".buschPopupBackdrop");
  const popupImg = document.querySelector(".buschPopupImg");

  popupImg?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  if (!logo || !popup) return;

  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  const MOVE_THRESHOLD = 12;

  function openPopup() {
    const nextImg = getRandomBuschGirl();

    if (popupImg && nextImg) {
      popupImg.src = nextImg;
    }

    popup.hidden = false;
    document.body.style.overflow = "hidden";
    document.body.classList.add("noSelect");
  }

  function closePopup() {
    popup.hidden = true;
    document.body.style.overflow = "";
    document.body.classList.remove("noSelect");
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  function startPress(e) {
    cancelPress();
    document.body.classList.add("noSelect");

    if (e.type === "touchstart") {
      const t = e.touches?.[0];
      startX = t ? t.clientX : 0;
      startY = t ? t.clientY : 0;
    }

    pressTimer = setTimeout(() => {
      pressTimer = null;
      openPopup();
    }, 700);
  }

  function handleTouchMove(e) {
    if (!pressTimer) return;

    const t = e.touches?.[0];
    if (!t) return;

    const dx = Math.abs(t.clientX - startX);
    const dy = Math.abs(t.clientY - startY);

    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      cancelPress();
    }
  }

  logo.addEventListener("mousedown", startPress);
  logo.addEventListener("mouseup", cancelPress);
  logo.addEventListener("mouseleave", cancelPress);

  logo.addEventListener("touchstart", startPress, { passive: true });
  logo.addEventListener("touchmove", handleTouchMove, { passive: true });
  logo.addEventListener("touchend", cancelPress);
  logo.addEventListener("touchcancel", cancelPress);

  closeBtn?.addEventListener("click", closePopup);
  backdrop?.addEventListener("click", closePopup);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) {
      closePopup();
    }
  });
}

function initAdminControls_() {
    const portal = document.getElementById("playerPortalPill");
    const pinBackdrop = document.getElementById("adminPinBackdrop");
    const pinInput = document.getElementById("adminPinInput");
    const pinSubmit = document.getElementById("adminPinSubmit");
    const pinCancel = document.getElementById("adminPinCancel");
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
      }, 900);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    document.body.classList.remove("noSelect");
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

  if (pinCancel && !pinCancel.dataset.bound) {
    pinCancel.dataset.bound = "1";
    pinCancel.addEventListener("click", closeAdminPin_);
  }

  if (pinSubmit && !pinSubmit.dataset.bound) {
    pinSubmit.dataset.bound = "1";
    pinSubmit.addEventListener("click", unlockAdmin_);
  }

  if (pinInput && !pinInput.dataset.bound) {
    pinInput.dataset.bound = "1";
    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") unlockAdmin_();
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
  document.getElementById("adminAddFundsBtn")?.addEventListener("click", addFunds_);
  document.getElementById("adminMarkPaidOutBtn")?.addEventListener("click", markPaidOut_);
  document.getElementById("adminWhoIOweBtn")?.addEventListener("click", showWhoIOwe_);
  document.getElementById("adminClearSeedsBtn")?.addEventListener("click", clearSeeds_);
  document.getElementById("adminClearAssignmentsBtn")?.addEventListener("click", clearAssignments_);
}

  window.addEventListener("resize", () => {
    if (_statsMode !== "overall" && _statsMode !== "tourney") return;

    clearTimeout(_nameWTimer);
    _nameWTimer = setTimeout(() => {
      syncOverallNameColumnWidth_();
    }, 150);
  });

  window.onload = async () => {
    initAdminControls_();
    loadPlayersThenInit();
    persistHScroll(".navInner", "nascar_nav_scroll");
    await loadBuschGirls();
    initBuschLongPress_();

    // start live matchup polling
    loadLiveMatchups();
    setInterval(loadLiveMatchups, 45000);
  };
