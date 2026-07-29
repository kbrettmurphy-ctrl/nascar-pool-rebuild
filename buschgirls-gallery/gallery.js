(() => {
  "use strict";
  const TOKEN_KEY = "nascar_pool_admin_token";
  const state = { page:1, pageSize:80, columns:0, folder:"all", search:"", sort:"newest", activeState:"all", indexingState:"all", duplicateState:"all", total:0, totalPages:1, photos:[], selected:null, viewerIndex:-1, origin:null, longPressTimer:null, suppressClick:false, backfill:null, failures:[], requestId:0 };
  const $ = id => document.getElementById(id);
  const validFolders = new Set(["all","soft","old","spicy","spicier"]);
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
  function formatDate(value) { const d=new Date(value); return Number.isNaN(d.valueOf()) ? "Unknown date" : d.toLocaleString(); }
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
      button.addEventListener("click",()=>{ if(state.suppressClick){state.suppressClick=false;return;} openViewer(index,button); });
      button.addEventListener("contextmenu",event=>{ event.preventDefault(); openMenu(photo,event.clientX,event.clientY); });
      button.addEventListener("pointerdown",event=>startLongPress(event,photo));
      ["pointerup","pointercancel","pointermove"].forEach(name=>button.addEventListener(name,cancelLongPress));
      grid.append(button);
    });
  }
  function startLongPress(event,photo) { if(event.pointerType==="mouse")return; cancelLongPress(); const x=event.clientX,y=event.clientY; state.longPressTimer=setTimeout(()=>{state.suppressClick=true;openMenu(photo,x,y);},550); }
  function cancelLongPress(){ clearTimeout(state.longPressTimer); state.longPressTimer=null; }
  function openMenu(photo,x,y) { closeViewer(); state.selected=photo; $("contextPath").textContent=`${photo.folder}/${photo.filename}`; $("contextDate").textContent=formatDate(photo.uploaded_at); const menu=$("contextMenu"); menu.hidden=false; const rect=menu.getBoundingClientRect(); menu.style.left=`${Math.max(8,Math.min(x,innerWidth-rect.width-8))}px`; menu.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-8))}px`; menu.querySelector("button")?.focus(); }
  function closeMenu(){ $("contextMenu").hidden=true; state.selected=null; }

  function openViewer(index,origin) { closeMenu(); const photo=state.photos[index]; if(!photo)return; state.viewerIndex=index; state.origin=origin || document.activeElement; $("viewerImage").src=photo.url; $("viewerImage").alt=photo.filename; $("viewerTitle").textContent=photo.filename; $("viewerMeta").textContent=`${photo.folder} · ${formatDate(photo.uploaded_at)}`; $("viewerPrevious").disabled=index===0; $("viewerNext").disabled=index===state.photos.length-1; $("viewer").hidden=false; document.body.style.overflow="hidden"; $("viewerClose").focus(); }
  function closeViewer(){ if($("viewer").hidden)return; $("viewer").hidden=true; $("viewerImage").removeAttribute("src"); document.body.style.overflow=""; const origin=state.origin; state.viewerIndex=-1; state.origin=null; origin?.focus?.(); }
  function moveViewer(delta){ const next=state.viewerIndex+delta; if(next>=0&&next<state.photos.length)openViewer(next,state.origin); }
  function trapViewerFocus(event){ const controls=Array.from($("viewer").querySelectorAll("button:not(:disabled)")); if(!controls.length)return; const first=controls[0],last=controls.at(-1); if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();} }
  async function permanentDelete(photo) {
    const path=`${photo.folder}/${photo.filename}`;
    if(!confirm(`Permanently delete ${path}?\n\nThis action cannot be undone.`))return;
    try { await api("/api/delete-buschgirl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:photo.id})}); closeMenu(); closeViewer(); await loadPage(); $("status").textContent=`Permanently deleted ${path}.`; } catch(error){ handleError(error); }
  }

  async function makeThumbnail(blob) {
    const decoded=await decodeImage(blob);
    try { const scale=Math.min(1,460/Math.max(decoded.width,decoded.height)); const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(decoded.width*scale)); canvas.height=Math.max(1,Math.round(decoded.height*scale)); canvas.getContext("2d").drawImage(decoded.source,0,0,canvas.width,canvas.height); return await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Thumbnail generation failed")),"image/webp",.68)); } finally { decoded.release(); }
  }
  async function decodeImage(blob){if(typeof createImageBitmap==="function"){const bitmap=await createImageBitmap(blob,{imageOrientation:"from-image"});return{source:bitmap,width:bitmap.width,height:bitmap.height,release:()=>bitmap.close()};}const url=URL.createObjectURL(blob);try{const image=new Image();image.decoding="async";image.src=url;await image.decode();return{source:image,width:image.naturalWidth,height:image.naturalHeight,release:()=>URL.revokeObjectURL(url)};}catch(error){URL.revokeObjectURL(url);throw error;}}
  async function sha256(blob){ const bytes=await blob.arrayBuffer(); const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)); return Array.from(hash,b=>b.toString(16).padStart(2,"0")).join(""); }
  async function processBackfillPhoto(photo) { const response=await fetch(photo.url,{cache:"no-store",referrerPolicy:"same-origin"}); if(!response.ok)throw new Error(`Download failed (${response.status})`); const original=await response.blob(); const [hash,thumbnail]=await Promise.all([sha256(original),makeThumbnail(original)]); const form=new FormData(); form.append("photoId",photo.id); form.append("sha256",hash); form.append("thumbnail",thumbnail,`${photo.id}.webp`); return api("/api/index-buschgirl",{method:"POST",body:form}); }
  function paintProgress(message) { const job=state.backfill; if(!job)return; const done=job.completed+job.failed; const percentage=job.total?Math.min(100,Math.round(done/job.total*100)):0; $("maintenanceBar").value=percentage; $("maintenanceProgress").textContent=`${message} ${done} / ${job.total} (${percentage}%). Failed: ${job.failed}. ${job.paused?"Paused.":""}`; $("pauseBackfill").disabled=job.paused||job.stopped; $("resumeBackfill").disabled=!job.paused||job.stopped; $("stopBackfill").disabled=job.stopped; $("retryBackfill").disabled=!state.failures.length||!job.stopped; }
  async function runBackfill(retryPhotos=null) {
    while(!state.backfill.stopped) {
      if(state.backfill.paused){paintProgress("Waiting.");return;}
      let photos=retryPhotos; retryPhotos=null;
      if(!photos){ const excluded=state.failures.map(item=>item.photo.id).slice(-50).join(","); const batch=await api(`/api/admin-buschgirls-backfill?limit=20&exclude=${encodeURIComponent(excluded)}`); state.backfill.remaining=batch.remaining+state.failures.length; if(!state.backfill.total)state.backfill.total=state.backfill.remaining+state.backfill.completed; photos=batch.photos; if(!photos.length){state.backfill.stopped=true;paintProgress(state.failures.length ? `Stopped with ${state.failures.length} remaining failure(s).` : "Complete.");return;} }
      for(let i=0;i<photos.length&&!state.backfill.stopped&&!state.backfill.paused;i+=4){ const group=photos.slice(i,i+4); await Promise.all(group.map(async photo=>{ try{const result=await processBackfillPhoto(photo);state.backfill.completed++;if(result.duplicateGroup)state.backfill.duplicateGroups.add(result.id);}catch(error){state.backfill.failed++;state.failures.push({photo,error:error.message||String(error)});state.failures=state.failures.slice(-50);if(error.status===401){state.backfill.stopped=true;showExpired();}} })); paintProgress("Indexing."); }
      renderFailures();
    }
  }
  function renderFailures(){ const box=$("failureList"); box.replaceChildren(); state.failures.slice(-10).forEach(item=>{const p=document.createElement("p");p.textContent=`${item.photo.folder}/${item.photo.filename}: ${item.error}`;box.append(p);}); }
  async function startBackfill(){ const allowed=Date.now()>=new Date("2026-08-09T00:00:00-04:00").getTime(); if(!allowed){alert("Do not run this production backfill before August 9, 2026.");return;} if(!confirm("Start the manual thumbnail and SHA-256 backfill? Approximately 2,605 originals / 683 MB will be downloaded once. Keep this tab open while a batch runs."))return; state.failures=[];state.backfill={completed:0,failed:0,total:0,paused:false,stopped:false,duplicateGroups:new Set()};paintProgress("Starting.");await runBackfill(); }
  async function reviewDuplicates(){ try{const data=await api("/api/admin-buschgirls-duplicates");const box=$("duplicateList");box.replaceChildren();const title=document.createElement("p");title.textContent=`${data.totalGroups} exact duplicate hash group(s). No files were changed.`;box.append(title);data.groups.forEach(group=>{const p=document.createElement("p");p.textContent=group.photos.map(x=>`${x.folder}/${x.filename}`).join(" ↔ ");box.append(p);});}catch(error){handleError(error);} }

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
  const resizeObserver=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const columns=countGridColumns();if(columns===state.columns)return;const oldOffset=(state.page-1)*state.pageSize;const pageSize=pageSizeForColumns(columns);state.columns=columns;if(pageSize===state.pageSize)return;state.pageSize=pageSize;state.page=Math.floor(oldOffset/pageSize)+1;loadPage();},220);});

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
  $("contextMenu").addEventListener("click",event=>{const action=event.target.closest("button")?.dataset.action;if(action==="view"){const index=state.photos.findIndex(x=>x.id===state.selected?.id);openViewer(index);}else if(action==="delete"&&state.selected)permanentDelete(state.selected);});
  $("viewerClose").addEventListener("click",closeViewer); $("viewerPrevious").addEventListener("click",()=>moveViewer(-1)); $("viewerNext").addEventListener("click",()=>moveViewer(1)); $("viewerDelete").addEventListener("click",()=>{const photo=state.photos[state.viewerIndex];if(photo)permanentDelete(photo);});
  document.addEventListener("pointerdown",event=>{if(!$("contextMenu").hidden&&!$("contextMenu").contains(event.target))closeMenu();if(!$("filterPanel").hidden&&!$("filterPanel").contains(event.target)&&!event.target.closest(".filter-button"))setFilterPanel(false);}); addEventListener("scroll",closeMenu,{passive:true,capture:true});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){if(!$("contextMenu").hidden)closeMenu();else if(!$("filterPanel").hidden)setFilterPanel(false);else if($("toolbar").classList.contains("search-open")){$("toolbar").classList.remove("search-open");$("searchToggle").setAttribute("aria-expanded","false");$("searchToggle").focus();}else if(!$("viewer").hidden)closeViewer();else if(!$("maintenance").hidden)$("maintenance").hidden=true;}else if(!$("viewer").hidden&&event.key==="ArrowLeft")moveViewer(-1);else if(!$("viewer").hidden&&event.key==="ArrowRight")moveViewer(1);else if(!$("viewer").hidden&&event.key==="Tab")trapViewerFocus(event);});
  $("maintenanceBtn").addEventListener("click",()=>{$("maintenance").hidden=false;$("closeMaintenance").focus();}); $("closeMaintenance").addEventListener("click",()=>{$("maintenance").hidden=true;}); $("startBackfill").addEventListener("click",startBackfill); $("pauseBackfill").addEventListener("click",()=>{state.backfill.paused=true;paintProgress("Pausing after active batch.");}); $("resumeBackfill").addEventListener("click",()=>{state.backfill.paused=false;paintProgress("Resuming from database state.");runBackfill();}); $("stopBackfill").addEventListener("click",()=>{state.backfill.stopped=true;paintProgress("Stopped.");}); $("retryBackfill").addEventListener("click",async()=>{const photos=state.failures.map(x=>x.photo);state.failures=[];state.backfill={completed:0,failed:0,total:photos.length,paused:false,stopped:false,duplicateGroups:new Set()};await runBackfill(photos);state.backfill.stopped=true;paintProgress("Retry complete.");}); $("reviewDuplicates").addEventListener("click",reviewDuplicates);
  initializeControls();resizeObserver.observe($("galleryGrid"));loadPage();
})();
