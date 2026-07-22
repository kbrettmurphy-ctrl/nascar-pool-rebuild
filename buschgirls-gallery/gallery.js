(() => {
  "use strict";
  const TOKEN_KEY = "nascar_pool_admin_token";
  const state = { page:1, pageSize:80, folder:"all", total:0, totalPages:1, photos:[], selected:null, viewerIndex:-1, origin:null, longPressTimer:null, suppressClick:false, backfill:null, failures:[] };
  const $ = id => document.getElementById(id);

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

  async function loadPage() {
    $("expired").hidden=true; $("status").textContent="Loading…"; closeMenu();
    try {
      const data=await api(`/api/admin-buschgirls-gallery?page=${state.page}&pageSize=${state.pageSize}&folder=${encodeURIComponent(state.folder)}`);
      state.photos=data.photos; state.total=data.total; state.totalPages=data.totalPages;
      if (state.page>state.totalPages) { state.page=state.totalPages; return loadPage(); }
      renderGrid();
      $("itemCount").textContent=`${data.total.toLocaleString()} items (${data.unindexedCount.toLocaleString()} pending)`;
      $("pageLabel").textContent=`Page ${data.page} of ${data.totalPages}`;
      $("previousPage").disabled=data.page<=1; $("nextPage").disabled=data.page>=data.totalPages;
      $("status").textContent=data.photos.length ? "" : "No photos in this folder.";
    } catch(error) { handleError(error); }
  }
  function renderGrid() {
    const grid=$("galleryGrid"); grid.replaceChildren();
    state.photos.forEach((photo,index) => {
      const button=document.createElement("button"); button.type="button"; button.className=`tile${photo.thumbnailReady ? "" : " pending"}`;
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
    try { await api("/api/delete-buschgirl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:photo.id})}); closeMenu(); closeViewer(); state.photos=state.photos.filter(item=>item.id!==photo.id); state.total=Math.max(0,state.total-1); renderGrid(); $("itemCount").textContent=`${state.total.toLocaleString()} items`; $("status").textContent=`Permanently deleted ${path}.`; if(!state.photos.length&&state.page>1){state.page--;await loadPage();} } catch(error){ handleError(error); }
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

  function goBack(){ try{const ref=document.referrer?new URL(document.referrer):null;if(ref&&ref.origin===location.origin&&history.length>1){history.back();return;}}catch{} location.assign("/"); }
  $("backBtn").addEventListener("click",goBack); document.querySelectorAll(".returnBtn").forEach(button=>button.addEventListener("click",()=>location.assign("/")));
  $("folderFilter").addEventListener("change",event=>{state.folder=event.target.value;state.page=1;loadPage();}); $("previousPage").addEventListener("click",()=>{if(state.page>1){state.page--;loadPage();}}); $("nextPage").addEventListener("click",()=>{if(state.page<state.totalPages){state.page++;loadPage();}});
  $("contextMenu").addEventListener("click",event=>{const action=event.target.closest("button")?.dataset.action;if(action==="view"){const index=state.photos.findIndex(x=>x.id===state.selected?.id);openViewer(index);}else if(action==="delete"&&state.selected)permanentDelete(state.selected);});
  $("viewerClose").addEventListener("click",closeViewer); $("viewerPrevious").addEventListener("click",()=>moveViewer(-1)); $("viewerNext").addEventListener("click",()=>moveViewer(1)); $("viewerDelete").addEventListener("click",()=>{const photo=state.photos[state.viewerIndex];if(photo)permanentDelete(photo);});
  document.addEventListener("pointerdown",event=>{if(!$("contextMenu").hidden&&!$("contextMenu").contains(event.target))closeMenu();}); addEventListener("scroll",closeMenu,{passive:true,capture:true});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){if(!$("contextMenu").hidden)closeMenu();else if(!$("viewer").hidden)closeViewer();else if(!$("maintenance").hidden)$("maintenance").hidden=true;}else if(!$("viewer").hidden&&event.key==="ArrowLeft")moveViewer(-1);else if(!$("viewer").hidden&&event.key==="ArrowRight")moveViewer(1);else if(!$("viewer").hidden&&event.key==="Tab")trapViewerFocus(event);});
  $("maintenanceBtn").addEventListener("click",()=>{$("maintenance").hidden=false;$("closeMaintenance").focus();}); $("closeMaintenance").addEventListener("click",()=>{$("maintenance").hidden=true;}); $("startBackfill").addEventListener("click",startBackfill); $("pauseBackfill").addEventListener("click",()=>{state.backfill.paused=true;paintProgress("Pausing after active batch.");}); $("resumeBackfill").addEventListener("click",()=>{state.backfill.paused=false;paintProgress("Resuming from database state.");runBackfill();}); $("stopBackfill").addEventListener("click",()=>{state.backfill.stopped=true;paintProgress("Stopped.");}); $("retryBackfill").addEventListener("click",async()=>{const photos=state.failures.map(x=>x.photo);state.failures=[];state.backfill={completed:0,failed:0,total:photos.length,paused:false,stopped:false,duplicateGroups:new Set()};await runBackfill(photos);state.backfill.stopped=true;paintProgress("Retry complete.");}); $("reviewDuplicates").addEventListener("click",reviewDuplicates);
  loadPage();
})();
