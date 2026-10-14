(() => {
  "use strict";
  const TOKEN_KEY = "nascar_pool_admin_token";
  const state = { page:1, pageSize:80, columns:0, folder:"all", search:"", sort:"newest", activeState:"all", indexingState:"all", duplicateState:"all", total:0, totalPages:1, photos:[], selected:null, viewerIndex:-1, origin:null, longPressTimer:null, suppressClick:false, requestId:0, selectMode:false, selection:new Map(), lastSelectedIndex:-1, bulkDeleting:false };
  const $ = id => document.getElementById(id);
  const validFolders = new Set(["all","soft","spicy","spicier"]);
  const validSorts = new Set(["newest","oldest","filename_asc","filename_desc"]);
  const validActiveStates = new Set(["all","active","inactive"]);
  const validIndexingStates = new Set(["all","ready","needs_indexing"]);

  class ApiError extends Error { constructor(message,status,data){ super(message); this.status=status; this.data=data; } }
  async function api(url, options={}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) throw new ApiError("Admin session expired",401,{});
    const response = await fetch(url, { ...options, cache:"no-store", headers:{ ...(options.headers||{}), Authorization:`Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new ApiError(data.error || `Request failed: ${response.status}`, response.status, data);
    return data;
  }
  function formatDate(value) { const d=new Date(value); return Number.isNaN(d.valueOf()) ? "Unknown date" : d.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}); }
  function showExpired() { $("galleryGrid").replaceChildren(); $("expired").hidden=false; $("status").textContent=""; }
  function handleError(error) { if (error.status===401) showExpired(); else $("status").textContent=error.message || String(error); }

  function restoreQueryState() {
    const params=new URLSearchParams(location.search);
    const page=Number(params.get("page"));
    const folder=String(params.get("folder")||"all").toLowerCase();
    const sort=String(params.get("sort")||"newest").toLowerCase();
    const active=String(params.get("activeState")||"all").toLowerCase();
    const indexing=String(params.get("indexingState")||"all").toLowerCase();
    state.page=Number.isInteger(page)&&page>0?page:1;
    state.folder=validFolders.has(folder)?folder:"all";
    state.search=String(params.get("search")||"").trim().slice(0,100);
    state.sort=validSorts.has(sort)?sort:"newest";
    state.activeState=validActiveStates.has(active)?active:"all";
    state.indexingState=validIndexingStates.has(indexing)?indexing:"all";
    state.duplicateState=params.get("duplicateState")==="exact"?"exact":"all";
  }
  function syncQueryState() {
    const params=new URLSearchParams();
    if(state.page>1)params.set("page",String(state.page));
    if(state.folder!=="all")params.set("folder",state.folder);
    if(state.search)params.set("search",state.search);
    if(state.sort!=="newest")params.set("sort",state.sort);
    if(state.activeState!=="all")params.set("activeState",state.activeState);
    if(state.indexingState!=="all")params.set("indexingState",state.indexingState);
    if(state.duplicateState!=="all")params.set("duplicateState",state.duplicateState);
    const query=params.toString();history.replaceState(null,"",`${location.pathname}${query?`?${query}`:""}`);
  }
  function countGridColumns() { const tracks=getComputedStyle($("galleryGrid")).gridTemplateColumns; return tracks&&tracks!=="none"?tracks.split(/\s+/).filter(Boolean).length:1; }
  function pageSizeForColumns(columns) { const safe=Math.max(1,Math.min(100,Number(columns)||1)); const lower=Math.max(safe,Math.floor(80/safe)*safe); const candidate=Math.ceil(80/safe)*safe; const upper=candidate<=100?candidate:lower; return Math.abs(80-lower)<=Math.abs(upper-80)?lower:upper; }
  function scrollToResults() { const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches; requestAnimationFrame(()=>requestAnimationFrame(()=>$("galleryGrid").scrollIntoView({block:"start",behavior:reduced?"auto":"smooth"}))); }
  function advancedFilterCount(){return Number(state.activeState!=="all")+Number(state.indexingState!=="all")+Number(state.duplicateState!=="all");}
  function paintFilterBadges(){const count=advancedFilterCount();document.querySelectorAll(".filter-badge").forEach(badge=>{badge.hidden=!count;badge.title=count?`${count} active filters`:"";});}

  async function loadPage({scroll=false}={}) {
    const requestId=++state.requestId;
    $("expired").hidden=true; $("status").textContent="Loading…"; closeMenu();
    try {
      const query=new URLSearchParams({page:String(state.page),pageSize:String(state.pageSize),folder:state.folder,search:state.search,sort:state.sort,activeState:state.activeState,indexingState:state.indexingState,duplicateState:state.duplicateState});
      const data=await api(`/api/admin-buschgirls-gallery?${query}`);
      if(requestId!==state.requestId)return;
      if(!data.duplicateFilterAvailable&&state.duplicateState==="exact"){state.duplicateState="all";$("duplicateState").value="all";return loadPage({scroll});}
      state.page=data.page; state.photos=data.photos; state.total=data.total; state.totalPages=data.totalPages;
      renderGrid();
      $("itemCount").textContent=data.total.toLocaleString();
      $("itemCount").setAttribute("aria-label",`${data.total.toLocaleString()} filtered items`);
      $("itemCount").title=`${data.total.toLocaleString()} filtered items`;
      $("pageInput").value=String(data.page); $("pageInput").max=String(data.totalPages); $("totalPages").textContent=String(data.totalPages);
      $("previousPage").disabled=data.page<=1; $("nextPage").disabled=data.page>=data.totalPages;
      $("exactDuplicatesOption").disabled=!data.duplicateFilterAvailable; $("duplicateHint").hidden=data.duplicateFilterAvailable;
      $("status").textContent=data.photos.length ? (data.unindexedCount ? `Using originals · ${data.unindexedCount.toLocaleString()} awaiting thumbnails` : "") : "No photos match the current search and filters.";
      syncQueryState(); paintFilterBadges();
      if(scroll)scrollToResults();
    } catch(error) { if(requestId===state.requestId)handleError(error); }
  }
  function renderGrid() {
    const grid=$("galleryGrid"); grid.replaceChildren();
    state.photos.forEach((photo,index) => {
      const button=document.createElement("button"); button.type="button"; button.className="tile";
      button.setAttribute("aria-label",`Open image ${index+1}`); button.dataset.index=String(index);
      if (photo.thumbnailUrl) {
        const img=document.createElement("img"); img.src=photo.thumbnailUrl; img.alt=""; img.loading="lazy"; img.decoding="async";
        img.addEventListener("error",()=>button.classList.add("broken")); button.append(img);
      }
      const dot=document.createElement("span"); dot.className="select-dot"; dot.setAttribute("aria-hidden","true"); button.append(dot);
      button.addEventListener("click",event=>{ if(state.suppressClick){state.suppressClick=false;return;} if(state.selectMode||event.target.closest(".select-dot")){ if(!state.selectMode)setSelectMode(true); toggleSelection(index,event.shiftKey); return; } openViewer(index,button); });
      button.addEventListener("contextmenu",event=>{ event.preventDefault(); if(state.selectMode)return; openMenu(photo,event.clientX,event.clientY); });
      button.addEventListener("pointerdown",event=>startLongPress(event,photo));
      ["pointerup","pointercancel","pointermove"].forEach(name=>button.addEventListener(name,cancelLongPress));
      grid.append(button);
    });
    state.lastSelectedIndex=-1; paintSelection();
  }
  function startLongPress(event,photo) { if(event.pointerType==="mouse"||state.selectMode)return; cancelLongPress(); const x=event.clientX,y=event.clientY; state.longPressTimer=setTimeout(()=>{state.suppressClick=true;openMenu(photo,x,y);},550); }
  function cancelLongPress(){ clearTimeout(state.longPressTimer); state.longPressTimer=null; }
  function openMenu(photo,x,y) { closeViewer(); state.selected=photo; markFolderChips("contextMove",photo.folder); $("contextPath").textContent=photo.filename; $("contextPath").title=`${photo.folder}/${photo.filename}`; $("contextDate").textContent=formatDate(photo.uploaded_at); const menu=$("contextMenu"); menu.hidden=false; const rect=menu.getBoundingClientRect(); menu.style.left=`${Math.max(8,Math.min(x,innerWidth-rect.width-8))}px`; menu.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-8))}px`; menu.querySelector("button")?.focus(); }
  function markFolderChips(containerId,folder){ const box=$(containerId); if(!box)return; box.querySelectorAll("button[data-move]").forEach(b=>{ const isCurrent=b.dataset.move===folder; b.classList.toggle("current",isCurrent); b.disabled=isCurrent; }); }

  async function movePhoto(photo,folder) {
    if(!photo||!folder||folder===photo.folder)return;
    const from=photo.folder; const label=`${from}/${photo.filename}`;
    $("status").textContent=`Moving ${label} to ${folder}...`;
    try {
      await api("/api/move-buschgirl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:photo.id,toFolder:folder})});
      photo.folder=folder;
      closeMenu();
      const viewing=!$("viewer").hidden&&state.photos[state.viewerIndex]?.id===photo.id;
      if(viewing)closeViewer();
      $("status").textContent=`Moved ${photo.filename} from ${from} to ${folder}.`;
      // Refresh so the moved object receives a new short-lived signed URL.
      await loadPage();
    } catch(error){ handleError(error); }
  }

  function closeMenu(){ $("contextMenu").hidden=true; state.selected=null; }

  function openViewer(index,origin) { closeMenu(); const photo=state.photos[index]; if(!photo)return; state.viewerIndex=index; state.origin=origin || document.activeElement; $("viewerImage").src=photo.url; $("viewerImage").alt=photo.filename; $("viewerTitle").textContent=photo.filename; $("viewerMeta").textContent=`${photo.folder} · ${formatDate(photo.uploaded_at)}`; markFolderChips("viewerMove",photo.folder); $("viewerPrevious").disabled=index===0; $("viewerNext").disabled=index===state.photos.length-1; $("viewer").hidden=false; document.body.style.overflow="hidden"; $("viewerClose").focus(); }
  function closeViewer(){ if($("viewer").hidden)return; $("viewer").hidden=true; $("viewerImage").removeAttribute("src"); document.body.style.overflow=""; const origin=state.origin; state.viewerIndex=-1; state.origin=null; origin?.focus?.(); }
  function moveViewer(delta){ const next=state.viewerIndex+delta; if(next>=0&&next<state.photos.length)openViewer(next,state.origin); }
  function trapViewerFocus(event){ const controls=Array.from($("viewer").querySelectorAll("button:not(:disabled)")); if(!controls.length)return; const first=controls[0],last=controls.at(-1); if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();} }
  async function permanentDelete(photo) {
    const path=`${photo.folder}/${photo.filename}`;
    if(!confirm(`Permanently delete ${path}?\n\nThis action cannot be undone.`))return;
    try { await api("/api/delete-buschgirl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:photo.id})}); closeMenu(); closeViewer(); await loadPage(); $("status").textContent=`Permanently deleted ${path}.`; } catch(error){ handleError(error); }
  }

  // Multi-select. The selection is keyed by photo id so it survives page changes.
  function setSelectMode(on) {
    if(state.bulkDeleting)return;
    closeMenu(); closeViewer(); state.selectMode=on;
    if(!on){ state.selection.clear(); state.lastSelectedIndex=-1; }
    document.body.classList.toggle("selecting",on); $("galleryGrid").classList.toggle("selecting",on);
    $("selectionBar").hidden=!on; $("selectBtn").setAttribute("aria-pressed",String(on));
    paintSelection();
  }
  function toggleSelection(index,range) {
    const photo=state.photos[index]; if(!photo||state.bulkDeleting)return;
    if(range&&state.lastSelectedIndex>=0) { const from=Math.min(index,state.lastSelectedIndex),to=Math.max(index,state.lastSelectedIndex); state.photos.slice(from,to+1).forEach(p=>state.selection.set(p.id,p)); }
    else if(state.selection.has(photo.id)) state.selection.delete(photo.id);
    else state.selection.set(photo.id,photo);
    state.lastSelectedIndex=index;
    if(!state.selection.size)setSelectMode(false); else paintSelection();
  }
  function toggleSelectPage() {
    const allSelected=state.photos.length&&state.photos.every(p=>state.selection.has(p.id));
    state.photos.forEach(p=>allSelected?state.selection.delete(p.id):state.selection.set(p.id,p));
    if(!state.selection.size)setSelectMode(false); else paintSelection();
  }
  function paintSelection() {
    document.querySelectorAll("#galleryGrid .tile").forEach(tile=>{ const photo=state.photos[Number(tile.dataset.index)]; const on=state.selectMode&&state.selection.has(photo?.id); tile.classList.toggle("selected",on); if(state.selectMode)tile.setAttribute("aria-pressed",String(on)); else tile.removeAttribute("aria-pressed"); });
    const count=state.selection.size, onPage=new Set(state.photos.map(p=>p.id)), offPage=[...state.selection.keys()].filter(id=>!onPage.has(id)).length;
    if(!state.bulkDeleting) { const label=document.createTextNode(`${count} selected`); const note=document.createElement("small"); note.textContent=offPage?`${offPage} on other pages`:""; $("selectionCount").replaceChildren(label,...(offPage?[note]:[])); }
    $("selectPage").textContent=state.photos.length&&state.photos.every(p=>state.selection.has(p.id))?"Clear page":"Select page";
    $("selectPage").disabled=state.bulkDeleting||!state.photos.length; $("exitSelect").disabled=state.bulkDeleting;
    $("deleteSelected").disabled=state.bulkDeleting||!count; $("deleteSelected").textContent=count?`Delete ${count}`:"Delete";
  }
  async function deleteWithRetry(photo) {
    // The endpoint is safe to retry; Supabase returns 429/5xx on bursts.
    for(let attempt=0;;attempt++) {
      try { return await api("/api/delete-buschgirl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:photo.id})}); }
      catch(error) { if(attempt>=2||!(error.status===429||error.status>=500))throw error; await new Promise(r=>setTimeout(r,(attempt?1500:700)*(0.75+Math.random()*0.5))); }
    }
  }
  async function deleteSelected() {
    const photos=[...state.selection.values()]; if(!photos.length||state.bulkDeleting)return;
    const listed=photos.slice(0,5).map(p=>`${p.folder}/${p.filename}`).join("\n"); const more=photos.length>5?`\n…and ${photos.length-5} more`:"";
    if(!confirm(`Permanently delete ${photos.length} photo${photos.length===1?"":"s"}?\n\n${listed}${more}\n\nThis action cannot be undone.`))return;
    state.bulkDeleting=true; paintSelection();
    const queue=[...photos]; let deleted=0, expired=false; const failed=[];
    const progress=()=>{$("selectionCount").textContent=`Deleting ${deleted+failed.length} of ${photos.length}…`;}; progress();
    const worker=async()=>{ while(queue.length&&!expired){ const photo=queue.shift(); try{ await deleteWithRetry(photo); state.selection.delete(photo.id); deleted++; }catch(error){ if(error.status===401)expired=true; else failed.push(photo); } progress(); } };
    await Promise.all([worker(),worker(),worker()]);
    state.bulkDeleting=false;
    if(expired){ showExpired(); return; }
    if(!state.selection.size)setSelectMode(false);
    await loadPage();
    $("status").textContent=`Permanently deleted ${deleted} photo${deleted===1?"":"s"}.`+(failed.length?` ${failed.length} failed and ${failed.length===1?"is":"are"} still selected; press Delete again to retry.`:"");
  }

  function resetResultsAndLoad(){state.page=1;loadPage({scroll:true});}
  function commitPageInput(){const input=$("pageInput");const raw=String(input.value||"").trim();const number=Number(raw);if(!raw||!Number.isFinite(number)){input.value=String(state.page);return;}const target=Math.max(1,Math.min(state.totalPages,Math.trunc(number)));input.value=String(target);if(target===state.page)return;state.page=target;loadPage({scroll:true});}
  function setFilterPanel(open){$("filterPanel").hidden=!open;document.querySelectorAll(".filter-button").forEach(button=>button.setAttribute("aria-expanded",String(open)));if(open)$("activeState").focus();}
  function initializeControls(){
    restoreQueryState();
    $("folderFilter").value=state.folder;$("filenameSearch").value=state.search;$("sortSelect").value=state.sort;$("activeState").value=state.activeState;$("indexingState").value=state.indexingState;$("duplicateState").value=state.duplicateState;$("clearSearch").hidden=!state.search;
    state.columns=countGridColumns();state.pageSize=pageSizeForColumns(state.columns);
  }

  let searchTimer=null;
  function applySearch(){clearTimeout(searchTimer);const value=$("filenameSearch").value.trim();$("clearSearch").hidden=!value;if(value===state.search)return;state.search=value;resetResultsAndLoad();}
  let resizeTimer=null;
  const resizeObserver=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!$("viewer").hidden)return;const columns=countGridColumns();if(columns===state.columns)return;const oldOffset=(state.page-1)*state.pageSize;const pageSize=pageSizeForColumns(columns);state.columns=columns;if(pageSize===state.pageSize)return;state.pageSize=pageSize;state.page=Math.floor(oldOffset/pageSize)+1;loadPage();},220);});

  function goBack(){ try{const ref=document.referrer?new URL(document.referrer):null;if(ref&&ref.origin===location.origin&&history.length>1){history.back();return;}}catch{} location.assign("/"); }
  $("backBtn").addEventListener("click",goBack); document.querySelectorAll(".returnBtn").forEach(button=>button.addEventListener("click",()=>location.assign("/")));
  $("folderFilter").addEventListener("change",event=>{state.folder=event.target.value;resetResultsAndLoad();});
  $("sortSelect").addEventListener("change",event=>{state.sort=event.target.value;resetResultsAndLoad();});
  $("previousPage").addEventListener("click",()=>{if(state.page>1){state.page--;loadPage({scroll:true});}}); $("nextPage").addEventListener("click",()=>{if(state.page<state.totalPages){state.page++;loadPage({scroll:true});}});
  $("pageInput").addEventListener("focus",event=>event.target.select());$("pageInput").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();commitPageInput();}});$("pageInput").addEventListener("blur",commitPageInput);
  $("filenameSearch").addEventListener("input",()=>{clearTimeout(searchTimer);$("clearSearch").hidden=!$("filenameSearch").value;searchTimer=setTimeout(applySearch,300);});$("filenameSearch").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();applySearch();}});$("clearSearch").addEventListener("click",()=>{$("filenameSearch").value="";applySearch();$("filenameSearch").focus();});
  $("searchToggle").addEventListener("click",()=>{const open=!$("toolbar").classList.contains("search-open");$("toolbar").classList.toggle("search-open",open);$("searchToggle").setAttribute("aria-expanded",String(open));if(open)$("filenameSearch").focus();});
  document.querySelectorAll(".filter-button").forEach(button=>button.addEventListener("click",()=>setFilterPanel($("filterPanel").hidden)));
  ["activeState","indexingState","duplicateState"].forEach(id=>$(id).addEventListener("change",event=>{state[id]=event.target.value;resetResultsAndLoad();}));
  $("clearFilters").addEventListener("click",()=>{state.activeState="all";state.indexingState="all";state.duplicateState="all";$("activeState").value="all";$("indexingState").value="all";$("duplicateState").value="all";resetResultsAndLoad();});$("closeFilters").addEventListener("click",()=>setFilterPanel(false));
  $("contextMenu").addEventListener("click",event=>{const moveTo=event.target.closest("button[data-move]")?.dataset.move;if(moveTo){movePhoto(state.selected,moveTo);return;}const action=event.target.closest("button")?.dataset.action;if(action==="view"){const index=state.photos.findIndex(x=>x.id===state.selected?.id);openViewer(index);}else if(action==="select"&&state.selected){const photo=state.selected;setSelectMode(true);state.selection.set(photo.id,photo);state.lastSelectedIndex=state.photos.findIndex(x=>x.id===photo.id);paintSelection();}else if(action==="delete"&&state.selected)permanentDelete(state.selected);});
  $("viewerMove").addEventListener("click",event=>{const moveTo=event.target.closest("button[data-move]")?.dataset.move;if(moveTo)movePhoto(state.photos[state.viewerIndex],moveTo);});
  $("viewerClose").addEventListener("click",closeViewer); $("viewerPrevious").addEventListener("click",()=>moveViewer(-1)); $("viewerNext").addEventListener("click",()=>moveViewer(1)); $("viewerDelete").addEventListener("click",()=>{const photo=state.photos[state.viewerIndex];if(photo)permanentDelete(photo);});
  document.addEventListener("pointerdown",event=>{if(!$("contextMenu").hidden&&!$("contextMenu").contains(event.target))closeMenu();if(!$("filterPanel").hidden&&!$("filterPanel").contains(event.target)&&!event.target.closest(".filter-button"))setFilterPanel(false);}); addEventListener("scroll",closeMenu,{passive:true,capture:true});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){if(!$("contextMenu").hidden)closeMenu();else if(!$("filterPanel").hidden)setFilterPanel(false);else if($("toolbar").classList.contains("search-open")){$("toolbar").classList.remove("search-open");$("searchToggle").setAttribute("aria-expanded","false");$("searchToggle").focus();}else if(!$("viewer").hidden)closeViewer();else if(state.selectMode)setSelectMode(false);}else if(!$("viewer").hidden&&event.key==="ArrowLeft")moveViewer(-1);else if(!$("viewer").hidden&&event.key==="ArrowRight")moveViewer(1);else if(!$("viewer").hidden&&event.key==="Tab")trapViewerFocus(event);});
  $("selectBtn").addEventListener("click",()=>setSelectMode(!state.selectMode)); $("exitSelect").addEventListener("click",()=>setSelectMode(false)); $("selectPage").addEventListener("click",toggleSelectPage); $("deleteSelected").addEventListener("click",deleteSelected);
  addEventListener("beforeunload",event=>{if(state.bulkDeleting){event.preventDefault();event.returnValue="";}});
  initializeControls();resizeObserver.observe($("galleryGrid"));loadPage();
})();
