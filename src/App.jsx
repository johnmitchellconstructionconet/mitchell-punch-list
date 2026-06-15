import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  getProjects, upsertProject, deleteProject,
  getTasks, upsertTask, deleteTask,
  getCompanies, upsertCompany, deleteCompany,
  getPhoto, savePhoto as dbSavePhoto,
  getSetting, setSetting,
  wipeAll as dbWipeAll,
} from "./supabase.js";

/* ================================================================
   PUNCH LIST SYSTEM — White-label, company-configurable
   Supabase-backed persistent storage
   ================================================================ */

/* ─── Print to PDF utility ──────────────────────────────────────
   Opens an invisible iframe, writes HTML into it, triggers the
   browser print dialog (Save as PDF). No file download needed.
   ────────────────────────────────────────────────────────────── */
function printHTML(html) {
  // Remove any existing print iframe
  const existing = document.getElementById("__print_frame__");
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "__print_frame__";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;opacity:0;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Give images and fonts time to load, then print
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Clean up after a delay to allow print dialog to open
      setTimeout(() => iframe.remove(), 3000);
    }, 600);
  };

  // Fallback if onload doesn't fire
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {}
    setTimeout(() => iframe.remove(), 3000);
  }, 1500);
}

const DEFAULT_SETTINGS = {
  name: "", tagline: "", address: "", city: "", state: "", zip: "",
  phone: "", email: "", website: "", license: "",
  accentColor: "#BBA270", logoUrl: "",
};

const CompanyCtx = React.createContext(DEFAULT_SETTINGS);
const useCompany = () => React.useContext(CompanyCtx);

const C = {
  ink: "#1C1A18", paper: "#FAFAF8", card: "#FFFFFF",
  line: "#E8E5E0", lineHvy: "#CCC8C2", taupe: "#8A8279",
  gold: "#BBA270", goldDark: "#8F7427", stone: "#B5B0A8",
  sage: "#6E9964", rust: "#B04035", amber: "#B08A2E", mist: "#F2F0EC",
};

const STATUS_META = {
  Reported:  { bg:"#F0EDE8", fg:"#8A6E4A", label:"Reported"  },
  Scheduled: { bg:"#EDF1F7", fg:"#4A6080", label:"Scheduled" },
  Done:      { bg:"#EAF2E8", fg:"#4A7A40", label:"Done"      },
};
const STATUSES = ["Reported","Scheduled","Done"];

const APPROVAL_META = {
  Pending:  { bg:"#F5F3F0", fg:"#8A8279", label:"Pending"  },
  Approved: { bg:"#EAF2E8", fg:"#4A7A40", label:"Approved" },
  Rejected: { bg:"#F9EDEC", fg:"#B04035", label:"Rejected" },
};
const PRIORITIES = ["High","Medium","Low"];
const PRI_FG = { High:C.rust, Medium:C.amber, Low:C.taupe };

const uid     = () => Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const today   = () => new Date().toISOString().slice(0,10);
const fmtDate = iso => {
  if(!iso) return "—";
  const d = new Date(iso+"T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const fmtDT = ts => new Date(ts).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const esc   = s  => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

const compress = (file,maxDim=1280,q=0.75) => new Promise(res=>{
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const sc=Math.min(1,maxDim/Math.max(img.width,img.height));
      const cv=document.createElement("canvas");
      cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
      res(cv.toDataURL("image/jpeg",q));
    };
    img.src=r.result;
  };
  r.readAsDataURL(file);
});

/* ================================================================ ROOT */
export default function App() {
  const jobParam = (() => {
    try { return new URLSearchParams(window.location.search).get("job"); } catch { return null; }
  })();
  if (jobParam) return <JobLinkApp jobId={jobParam} />;
  return <InternalApp />;
}

/* ================================================================ JOB LINK APP */
function JobLinkApp({ jobId }) {
  const [project,    setProject]    = useState(null);
  const [tasks,      setTasks]      = useState([]);
  const [coSettings, setCoSettings] = useState({...DEFAULT_SETTINGS});
  const [loaded,     setLoaded]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [openId,      setOpenId]     = useState(null);
  const [lightbox,    setLightbox]   = useState(null);
  const [photoCache,  setPhotoCache] = useState({});
  const [tradeFilter, setTradeFilter] = useState("All");

  const load = useCallback(async () => {
    setSyncing(true);
    const [projs, allTasks, csRaw] = await Promise.all([
      getProjects(), getTasks(), getSetting("cosettings"),
    ]);
    if (csRaw) { try { setCoSettings(s=>({...s,...JSON.parse(csRaw)})); } catch {} }
    const proj = projs.find(p=>p.id===jobId);
    setProject(proj||null);
    setTasks(proj ? allTasks.filter(t=>t.project===proj.name) : []);
    setSyncing(false); setLoaded(true);
  }, [jobId]);

  useEffect(()=>{ load(); },[load]);

  useEffect(()=>{
    const interval = setInterval(()=>load(), 30000);
    return ()=>clearInterval(interval);
  },[load]);

  const loadPhoto = useCallback(async pid=>{
    if(photoCache[pid]) return photoCache[pid];
    const v = await getPhoto(pid);
    if(v) setPhotoCache(c=>({...c,[pid]:v}));
    return v;
  },[photoCache]);

  if (!loaded) return <Shell><Loader txt="Loading job…"/></Shell>;

  if (!project) return (
    <CompanyCtx.Provider value={coSettings}>
      <Shell>
        <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div style={{textAlign:"center",maxWidth:380}}>
            <Wordmark size={36}/>
            <h2 style={{...DISP,fontSize:24,margin:"20px 0 8px"}}>Job not found</h2>
            <p style={{color:C.taupe,fontSize:14}}>This link may have expired or the job doesn't exist. Contact your project team for an updated link.</p>
          </div>
        </div>
      </Shell>
    </CompanyCtx.Provider>
  );

  const trades = [...new Set(tasks.map(t=>t.trade).filter(Boolean))].sort();
  const filteredTasks = tradeFilter === "All" ? tasks : tasks.filter(t=>t.trade===tradeFilter);
  const byArea = {};
  for (const t of filteredTasks) (byArea[t.area]=byArea[t.area]||[]).push(t);
  const openCount = filteredTasks.filter(t=>t.approval!=="Approved").length;
  const doneCount = filteredTasks.filter(t=>t.approval==="Approved").length;
  const openTask  = tasks.find(t=>t.id===openId);

  const exportList = async () => {
    const tdy2 = today();
    // load photos for all visible tasks
    const pm={};
    for(const t of filteredTasks){
      const pid=t.photos?.[0];
      if(pid&&!pm[pid]) pm[pid]=await loadPhoto(pid);
    }
    const byAreaExp={};
    for(const t of filteredTasks)(byAreaExp[t.area]=byAreaExp[t.area]||[]).push(t);
    const accent=coSettings.accentColor||"#BBA270";
    const sm=s=>{const m=STATUS_META[s]||STATUS_META.Reported;return`background:${m.bg};color:${m.fg};padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;text-transform:uppercase`;};
    let body="";
    for(const [area,list] of Object.entries(byAreaExp)){
      body+=`<h3>${esc(area)}</h3><table><thead><tr><th>Photo</th><th>Description</th><th>Priority</th><th>Due</th><th>Progress</th></tr></thead><tbody>`;
      for(const t of list){
        const img=t.photos?.[0]&&pm[t.photos[0]]?`<img src="${pm[t.photos[0]]}" style="width:48px;height:48px;object-fit:cover;border-radius:5px">`:"—";
        const overdue=t.dueDate&&t.dueDate<tdy2&&t.approval!=="Approved";
        body+=`<tr><td>${img}</td><td>${esc(t.description)}</td><td style="color:${PRI_FG[t.priority]};font-weight:600">${t.priority}</td><td style="${overdue?"color:#B04035;font-weight:700":""}">${fmtDate(t.dueDate)}${overdue?" ⚠":""}	</td><td><span style="${sm(t.status)}">${t.status}</span></td></tr>`;
      }
      body+=`</tbody></table>`;
    }
    const tradeLabel=tradeFilter!=="All"?` — ${tradeFilter}`:"";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Punch List — ${esc(project.name)}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Raleway:wght@400;500;600&display=swap');
body{font-family:Raleway,sans-serif;color:#1C1A18;max-width:860px;margin:0 auto;padding:32px 24px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #1C1A18;padding-bottom:12px;margin-bottom:20px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;font-weight:600;margin:6px 0 2px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8A8279;margin:18px 0 4px;border-bottom:1px solid #E8E5E0;padding-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
th{text-align:left;color:#8A8279;border-bottom:1px solid #B5B0A8;padding:5px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em}
td{border-bottom:1px solid #F0EDE8;padding:6px;vertical-align:top}
.foot{margin-top:32px;font-size:11px;color:#B5B0A8;border-top:1px solid #E8E5E0;padding-top:8px}
.tagline{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:${accent};font-size:13px;margin-top:2px}
@media print{body{padding:0}}</style></head><body>
<div class="hdr">
  <div>
    ${coSettings.logoUrl?`<img src="${coSettings.logoUrl}" style="height:40px;max-width:180px;object-fit:contain;display:block;margin-bottom:4px" alt="">`:`<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:#8A8279;font-style:italic">${esc(coSettings.name||"")}</div>`}
    <h1>${esc(project.name)}</h1>
    <div style="font-size:12px;color:#8A8279">${[project.client,project.address].filter(Boolean).join(" · ")||""}${tradeLabel?`<b>${tradeLabel}</b>`:""}</div>
  </div>
  <div style="text-align:right;font-size:12px;color:#8A8279">
    <div>Generated ${fmtDate(tdy2)}</div>
    <div style="font-weight:700;margin-top:3px;color:#1C1A18">${openCount} open · ${doneCount} completed · ${filteredTasks.length} total</div>
  </div>
</div>
${body}
<div class="foot">${esc(coSettings.name||"")}${coSettings.tagline?`<div class="tagline">"${esc(coSettings.tagline)}"</div>`:""}</div>
</body></html>`;
    printHTML(html);
  };

  return (
    <CompanyCtx.Provider value={coSettings}>
      <Shell>
        <div style={{background:C.card,borderBottom:`1px solid ${C.line}`,padding:"12px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <Wordmark size={28}/>
          <div style={{flex:1}}/>
          <button onClick={exportList} style={{background:coSettings.accentColor||C.gold,color:"#2E2B28",border:"none",padding:"8px 14px",fontSize:13,borderRadius:7,cursor:"pointer",fontWeight:600}}>🖨 Print / Save as PDF</button>
          <button onClick={load} style={{background:"transparent",border:`1px solid ${C.line}`,padding:"8px 12px",fontSize:13,borderRadius:7,color:C.taupe,cursor:"pointer"}}>{syncing?"Syncing…":"⟳ Refresh"}</button>
        </div>
        <div style={{background:C.mist,borderBottom:`1px solid ${C.line}`}}>
          <div style={{padding:"14px 18px"}}>
          <div style={{...DISP,fontSize:28,fontWeight:600,lineHeight:1.1}}>{project.name}</div>
          <div style={{fontSize:13,color:C.taupe,marginTop:3}}>{[project.client,project.address].filter(Boolean).join(" · ")}{project.siteContact&&<span> · Site: {project.siteContact}{project.sitePhone?" "+project.sitePhone:""}</span>}</div>
          <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
            <PubStat label="Open items"   value={openCount} color={openCount>0?C.ink:C.taupe}/>
            <PubStat label="Completed"    value={doneCount} color={doneCount>0?C.sage:C.taupe}/>
            <PubStat label="Total"        value={filteredTasks.length} color={C.taupe}/>
          </div>
          {trades.length>1&&(
            <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
              <label style={{...CAPT,fontSize:10,fontWeight:700,color:C.stone,whiteSpace:"nowrap"}}>Filter by trade</label>
              <select value={tradeFilter} onChange={e=>setTradeFilter(e.target.value)}
                style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:8,padding:"9px 12px",fontSize:14,color:C.ink,maxWidth:280,width:"100%"}}>
                <option value="All">All trades</option>
                {trades.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <p style={{fontSize:12.5,color:C.stone,marginTop:10,marginBottom:0}}>Read-only view. Contact your project manager with questions.</p>
          </div>
        </div>
        <div style={{maxWidth:900,margin:"0 auto",padding:"16px 14px"}}>
          {filteredTasks.length===0&&<div style={{padding:40,textAlign:"center",color:C.taupe}}>{tradeFilter==="All"?"No punch items for this job yet.":`No items assigned to ${tradeFilter} on this job.`}</div>}
          {Object.entries(byArea).map(([area,list])=>(
            <div key={area} style={{marginBottom:20}}>
              <div style={{...CAPT,fontSize:12,fontWeight:700,color:C.taupe,marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.line}`}}>{area}</div>
              <div style={{display:"grid",gap:10,gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))"}}>
                {list.map(t=>{
                  const overdue=t.dueDate&&t.dueDate<today()&&t.approval!=="Approved";
                  return(
                    <div key={t.id} onClick={()=>setOpenId(t.id)}
                      style={{background:C.card,border:`1px solid ${C.line}`,borderLeft:`4px solid ${STATUS_META[t.status]?.fg||C.taupe}`,borderRadius:9,padding:"13px 14px",cursor:"pointer"}}>
                      {/* Status + Priority row */}
                      <div style={{display:"flex",justifyContent:"space-between",gap:6,marginBottom:8}}>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          <StatusChip status={t.status}/>
                          <ApprovalChip approval={t.approval}/>
                        </div>
                        <span style={{fontSize:12,color:PRI_FG[t.priority],fontWeight:700}}>{t.priority}</span>
                      </div>
                      {/* Description */}
                      <div style={{fontWeight:600,fontSize:14,lineHeight:1.4,marginBottom:8}}>{t.description}</div>
                      {/* Key details grid */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",fontSize:12.5,color:C.taupe,marginBottom:8}}>
                        <div><span style={{fontWeight:600,color:C.ink}}>Assignee: </span>{t.trade||"—"}</div>
                        <div><span style={{fontWeight:600,color:C.ink}}>Area: </span>{t.area||"—"}</div>
                        <div style={{color:overdue?C.rust:C.taupe,fontWeight:overdue?700:400}}>
                          <span style={{fontWeight:600,color:overdue?C.rust:C.ink}}>Due: </span>{fmtDate(t.dueDate)}{overdue?" ⚠ OVERDUE":""}
                        </div>
                        <div><span style={{fontWeight:600,color:C.ink}}>By: </span>{t.createdBy||"—"}</div>
                      </div>
                      {/* Photo strip */}
                      {(t.photos||[]).length>0&&(
                        <div style={{display:"flex",gap:5,marginTop:6}}>
                          {(t.photos||[]).slice(0,3).map(pid=><PhotoThumb key={pid} pid={pid} loadPhoto={loadPhoto} size={54}/>)}
                          {(t.photos||[]).length>3&&<div style={{width:54,height:54,borderRadius:7,background:C.mist,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.taupe,fontWeight:600}}>+{t.photos.length-3}</div>}
                        </div>
                      )}
                      <div style={{marginTop:8,fontSize:12,color:C.stone,fontStyle:"italic"}}>Tap for full details →</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {openTask&&<PubTaskDetail task={openTask} loadPhoto={loadPhoto} onLightbox={setLightbox} onClose={()=>setOpenId(null)}/>}
        {lightbox&&<Lightbox photoId={lightbox} loadPhoto={loadPhoto} onClose={()=>setLightbox(null)}/>}
        <div style={{padding:"16px 18px",borderTop:`1px solid ${C.line}`,textAlign:"center",fontSize:12,color:C.stone}}>
          <JobLinkFooter/>
        </div>
      </Shell>
    </CompanyCtx.Provider>
  );
}

function PubStat({label,value,color}){  return(
    <div>
      <div style={{...DISP,fontSize:26,fontWeight:600,color,lineHeight:1}}>{value}</div>
      <div style={{...CAPT,fontSize:10,color:C.stone,marginTop:2}}>{label}</div>
    </div>
  );
}

function PubTaskDetail({task,loadPhoto,onLightbox,onClose}){
  const co=useCompany();
  const accent=co.accentColor||C.gold;
  const overdue=task.dueDate&&task.dueDate<today()&&task.approval!=="Approved";

  // Direct link to this specific task (via job link + task anchor)
  const jobUrl=(()=>{try{return window.location.href;}catch{return "";}})();

  const timeline=[
    {ts:task.createdAt,label:"Task reported",by:task.createdBy||"Team",color:C.taupe},
    ...(task.statusHistory||[]).map(h=>({ts:h.ts,label:`Status → ${h.status}`,by:h.by,color:STATUS_META[h.status]?.fg||C.taupe})),
    ...(task.comments||[]).map(c=>({ts:c.ts,label:c.text,by:c.author,color:C.stone,isComment:true})),
  ].sort((a,b)=>a.ts-b.ts);

  return(
    <Modal onClose={onClose} wide>
      <div style={{padding:0,overflow:"hidden",borderRadius:14}}>

        {/* Header band */}
        <div style={{background:STATUS_META[task.status]?.bg||C.mist,padding:"16px 18px",borderBottom:`1px solid ${C.line}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:C.taupe,marginBottom:4}}>
                {task.project} · <span style={{color:accent}}>{task.area}</span>
              </div>
              <h2 style={{margin:"0 0 10px",fontSize:20,lineHeight:1.3,fontWeight:700}}>{task.description}</h2>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <StatusChip status={task.status} big/>
                <ApprovalChip approval={task.approval} big/>
                <span style={{...CAPT,fontSize:11,fontWeight:700,color:PRI_FG[task.priority],background:"#fff",padding:"3px 9px",borderRadius:6}}>{task.priority} Priority</span>
                {overdue&&<span style={{...CAPT,fontSize:11,fontWeight:700,color:C.rust,background:"#F9EDEC",padding:"3px 9px",borderRadius:6}}>⚠ OVERDUE</span>}
              </div>
            </div>
            <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:24,color:C.taupe,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
          </div>
        </div>

        <div style={{padding:"16px 18px"}}>

          {/* Approval banner */}
          {task.approval==="Approved"&&(
            <div style={{marginBottom:14,padding:"10px 14px",background:"#EAF2E8",border:`2px solid ${C.sage}`,borderRadius:9,color:C.sage,fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:8}}>
              ✓ Approved by {task.approvedBy} on {fmtDate(new Date(task.approvedAt).toISOString())}
            </div>
          )}
          {task.approval==="Rejected"&&(
            <div style={{marginBottom:14,padding:"10px 14px",background:"#F9EDEC",border:`2px solid ${C.rust}`,borderRadius:9,color:C.rust,fontWeight:700,fontSize:14}}>
              ✗ Rejected — work needs to be redone. See comments below.
            </div>
          )}

          {/* Full detail grid */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 20px",marginBottom:16,padding:"14px 16px",background:C.mist,borderRadius:10}}>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Assigned trade</div>
              <div style={{fontWeight:700,fontSize:14}}>{task.trade||"—"}</div>
            </div>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Location / area</div>
              <div style={{fontWeight:700,fontSize:14}}>{task.area||"—"}</div>
            </div>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Due date</div>
              <div style={{fontWeight:700,fontSize:14,color:overdue?C.rust:C.ink}}>{fmtDate(task.dueDate)}{overdue?" ⚠":""}</div>
            </div>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Reported by</div>
              <div style={{fontWeight:700,fontSize:14}}>{task.createdBy||"—"}</div>
            </div>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Job</div>
              <div style={{fontWeight:700,fontSize:14}}>{task.project||"—"}</div>
            </div>
            <div>
              <div style={{...CAPT,fontSize:10,color:C.stone,marginBottom:3}}>Reported on</div>
              <div style={{fontWeight:700,fontSize:14}}>{fmtDate(new Date(task.createdAt).toISOString())}</div>
            </div>
          </div>

          {/* Photos — full size */}
          {(task.photos||[]).length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,marginBottom:10}}>Photos ({task.photos.length})</div>
              <div style={{display:"grid",gap:8,gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))"}}>
                {(task.photos||[]).map(pid=>(
                  <PhotoThumb key={pid} pid={pid} loadPhoto={loadPhoto} size={140} onClick={()=>onLightbox(pid)}/>
                ))}
              </div>
              <div style={{fontSize:12,color:C.stone,marginTop:6}}>Tap any photo to enlarge.</div>
            </div>
          )}

          {/* Comments */}
          {(task.comments||[]).filter(c=>!c.text.startsWith("REJECTED:")).length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,marginBottom:8}}>Notes</div>
              <div style={{display:"grid",gap:7}}>
                {(task.comments||[]).map(c=>(
                  <div key={c.id} style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:8,padding:"9px 12px"}}>
                    <div style={{fontSize:12,color:C.taupe,marginBottom:2}}><b style={{color:c.role==="internal"?C.ink:accent}}>{c.author}</b> · {fmtDT(c.ts)}</div>
                    <div style={{fontSize:14,whiteSpace:"pre-wrap",color:c.text.startsWith("REJECTED:")?C.rust:C.ink,fontWeight:c.text.startsWith("REJECTED:")?600:400}}>{c.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {timeline.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,marginBottom:10}}>Activity timeline</div>
              <div style={{position:"relative",paddingLeft:22}}>
                <div style={{position:"absolute",left:6,top:6,bottom:6,width:2,background:C.line}}/>
                {timeline.map((ev,i)=>(
                  <div key={i} style={{position:"relative",marginBottom:12}}>
                    <div style={{position:"absolute",left:-18,top:4,width:10,height:10,borderRadius:"50%",background:ev.color,border:"2px solid #fff",boxShadow:`0 0 0 1.5px ${ev.color}`}}/>
                    <div style={{fontSize:11.5,color:C.stone}}>{fmtDT(ev.ts)}</div>
                    <div style={{fontSize:13.5,fontWeight:ev.isComment?400:600,marginTop:1,color:ev.isComment?C.taupe:C.ink}}>{ev.label}</div>
                    <div style={{fontSize:11.5,color:C.stone}}>by {ev.by}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Direct link */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 14px",background:C.mist,borderRadius:9,border:`1px solid ${C.line}`}}>
            <div>
              <div style={{...CAPT,fontSize:9.5,fontWeight:700,color:C.stone,marginBottom:2}}>Job punch list link</div>
              <div style={{fontSize:12,color:C.taupe,maxWidth:340,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{jobUrl}</div>
            </div>
            <button
              onClick={()=>{try{navigator.clipboard.writeText(jobUrl);window.alert("Link copied!");}catch{window.alert(jobUrl);}}}
              style={{background:accent,color:"#2E2B28",border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
              📋 Copy link
            </button>
          </div>

        </div>
      </div>
    </Modal>
  );
}

/* ================================================================ INTERNAL APP */
function InternalApp() {
  const [authed,       setAuthed]       = useState(false);
  const [user,         setUser]         = useState(null);
  const [projects,     setProjects]     = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [companies,    setCompanies]    = useState([]);
  const [teamCode,     setTeamCode]     = useState("");
  const [loaded,       setLoaded]       = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [coSettings,   setCoSettings]   = useState({...DEFAULT_SETTINGS});
  const [showSettings, setShowSettings] = useState(false);
  const [view,         setView]         = useState("main");
  const [currentJob,   setCurrentJob]   = useState(null);
  const [taskMode,     setTaskMode]     = useState("list");
  const [filters,      setFilters]      = useState({status:"All",trade:"All",q:""});
  const [showBatch,    setShowBatch]    = useState(false);
  const [openTaskId,   setOpenTaskId]   = useState(null);
  const [showNew,      setShowNew]      = useState(false);
  const [showNewJob,   setShowNewJob]   = useState(false);
  const [showEditJob,  setShowEditJob]  = useState(false);
  const [showEmail,    setShowEmail]    = useState(false);
  const [showEmailAll, setShowEmailAll] = useState(false);
  const [showQR,       setShowQR]       = useState(null);
  const [showDir,      setShowDir]      = useState(false);
  const [showImport,   setShowImport]   = useState(false);
  const [annotate,     setAnnotate]     = useState(null);
  const [lightbox,     setLightbox]     = useState(null);
  const [photoCache,   setPhotoCache]   = useState({});
  const [pendingNotif, setPendingNotif] = useState({});

  const loadAll = useCallback(async()=>{
    setSyncing(true);
    const [p, t, c, tc, cs] = await Promise.all([
      getProjects(), getTasks(), getCompanies(),
      getSetting("teamcode"), getSetting("cosettings"),
    ]);
    setProjects(p);
    setTasks(t);
    setCompanies(c);
    setTeamCode(tc||"");
    if(cs) { try { setCoSettings(s=>({...s,...JSON.parse(cs)})); } catch {} }
    setSyncing(false); setLoaded(true);
  },[]);

  useEffect(()=>{ if(authed) loadAll(); },[authed,loadAll]);

  useEffect(()=>{
    if(!authed) return;
    const interval = setInterval(()=>loadAll(), 30000);
    return ()=>clearInterval(interval);
  },[authed,loadAll]);

  // ── Persist helpers ──
  const pP = async (next) => {
    setProjects(next);
    // upsert changed ones — for simplicity upsert the one passed if array
  };
  const addProject = async (proj) => {
    setProjects(p=>[proj,...p]);
    await upsertProject(proj);
  };
  const updateProjectState = async (proj) => {
    setProjects(p=>p.map(x=>x.id===proj.id?proj:x));
    await upsertProject(proj);
  };

  const addTask = async (task) => {
    setTasks(t=>[task,...t]);
    await upsertTask(task);
  };
  const updateTaskById = async (id, patch) => {
    setTasks(t=>t.map(x=>x.id===id?{...x,...patch}:x));
    await upsertTask({...tasks.find(x=>x.id===id)||{},...patch,id});
  };
  const removeTask = async (id) => {
    setTasks(t=>t.filter(x=>x.id!==id));
    await deleteTask(id);
  };

  const addCompany = async (co) => {
    setCompanies(c=>[...c,co]);
    await upsertCompany(co);
  };
  const updateCompany = async (co) => {
    setCompanies(c=>c.map(x=>x.id===co.id?co:x));
    await upsertCompany(co);
  };
  const removeCompany = async (id) => {
    setCompanies(c=>c.filter(x=>x.id!==id));
    await deleteCompany(id);
  };

  const pTC = async v => { setTeamCode(v); await setSetting("teamcode", v); };
  const pCS = async v => { setCoSettings(v); await setSetting("cosettings", JSON.stringify(v)); };

  const markNotif = (trade,id) => setPendingNotif(p=>({...p,[trade]:[...new Set([...(p[trade]||[]),id])]}));

  const loadPhoto = useCallback(async pid=>{
    if(photoCache[pid]) return photoCache[pid];
    const v = await getPhoto(pid);
    if(v) setPhotoCache(c=>({...c,[pid]:v}));
    return v;
  },[photoCache]);

  const savePhoto = async dataUrl => {
    const pid = uid();
    await dbSavePhoto(pid, dataUrl);
    setPhotoCache(c=>({...c,[pid]:dataUrl}));
    return pid;
  };

  const wipeAll = async () => {
    await dbWipeAll();
    setProjects([]); setTasks([]); setCompanies([]); setTeamCode("");
    setPhotoCache({}); setUser(null); setAuthed(false); setCurrentJob(null); setView("main");
  };

  const trades    = [...new Set(tasks.map(t=>t.trade).filter(Boolean))].sort();
  const tradeOpts = [...new Set([...companies.map(c=>c.name),...trades])].sort();
  const emailMap  = Object.fromEntries(companies.filter(c=>c.email).map(c=>[c.name,c.email]));
  const currProj  = projects.find(p=>p.name===currentJob);

  const visible = tasks
    .filter(t=>(!currentJob||currentJob==="ALL")?true:t.project===currentJob)
    .filter(t=>filters.status==="All"||t.status===filters.status)
    .filter(t=>filters.trade==="All"||t.trade===filters.trade)
    .filter(t=>!filters.q||(t.description+" "+t.area+" "+t.project+" "+t.trade).toLowerCase().includes(filters.q.toLowerCase()))
    .sort((a,b)=>(a.status==="Done")-(b.status==="Done")||(a.dueDate||"9999").localeCompare(b.dueDate||"9999"));

  const openTask = tasks.find(t=>t.id===openTaskId);

  const loadCode = async () => { const v = await getSetting("teamcode"); return v||""; };

  if(!authed) return <Shell><InternalLogin loadCode={loadCode} onAuth={name=>{setUser(name);setAuthed(true);}}/></Shell>;
  if(!loaded) return <Shell><Loader txt="Loading…"/></Shell>;

  return(
    <CompanyCtx.Provider value={coSettings}>
    <Shell>
      {view==="report"&&(
        <Report tasks={visible} jobLabel={currentJob==="ALL"||!currentJob?"All jobs":currentJob}
          filters={filters} userName={user} loadPhoto={loadPhoto} project={currProj} onBack={()=>setView("main")}/>
      )}
      {view==="main"&&(
        <div className="no-print">
          <InternalHeader userName={user} syncing={syncing} onSync={loadAll}
            onSignOut={()=>{setAuthed(false);setUser(null);setLoaded(false);setCurrentJob(null);}}/>
          {currentJob===null?(
            <Dashboard projects={projects} tasks={tasks}
              onOpenJob={n=>{setCurrentJob(n);setFilters({status:"All",trade:"All",q:""});setTaskMode("list");}}
              onAllJobs={()=>{setCurrentJob("ALL");setTaskMode("list");}}
              onCalendar={()=>{setCurrentJob("ALL");setTaskMode("calendar");}}
              onNewJob={()=>setShowNewJob(true)}
              onDirectory={()=>setShowDir(true)}
              onEmail={()=>setShowEmail(true)}
              onSettings={()=>setShowSettings(true)}
              onStatusChange={async(proj,newStatus)=>await updateProjectState({...proj,status:newStatus})}/>
          ):(
            <>
              <JobBar project={currProj} jobLabel={currentJob==="ALL"?"All jobs":currentJob}
                onBack={()=>setCurrentJob(null)}
                onQR={currProj?()=>setShowQR(currProj):null}
                onEdit={currProj?()=>setShowEditJob(true):null}
                onEmailAll={currProj?()=>setShowEmailAll(true):null}/>
              <InternalToolbar filters={filters} setFilters={setFilters} trades={trades}
                taskMode={taskMode} setTaskMode={setTaskMode}
                onNew={()=>setShowNew(true)} onReport={()=>setView("report")}
                onBatch={()=>setShowBatch(true)} counts={visible}/>
              {taskMode==="calendar"
                ?<CalendarView tasks={visible} onOpen={setOpenTaskId}/>
                :<TaskList tasks={visible} showProject={currentJob==="ALL"} onOpen={setOpenTaskId} loadPhoto={loadPhoto}/>}
            </>
          )}
        </div>
      )}

      {showNewJob&&<NewJobModal onCancel={()=>setShowNewJob(false)} onCreate={async j=>{await addProject(j);setShowNewJob(false);setCurrentJob(j.name);}}/>}
      {showEditJob&&currProj&&<EditJobModal project={currProj} onCancel={()=>setShowEditJob(false)} onSave={async j=>{await updateProjectState(j);setShowEditJob(false);}}/>}
      {showNew&&<NewTaskModal userName={user} lockedProject={currentJob&&currentJob!=="ALL"?currentJob:null}
        projects={projects.filter(p=>p.status==="Active")} trades={tradeOpts} companies={companies}
        savePhoto={savePhoto} requestAnnotate={(d,cb)=>setAnnotate({dataUrl:d,onSave:cb})}
        onCancel={()=>setShowNew(false)} onCreate={async t=>{await addTask(t);setShowNew(false);}}/>}
      {openTask&&<TaskDetail task={openTask} userName={user}
        loadPhoto={loadPhoto} savePhoto={savePhoto}
        trades={trades} projects={projects} companies={companies}
        requestAnnotate={(d,cb)=>setAnnotate({dataUrl:d,onSave:cb})}
        onLightbox={setLightbox} onClose={()=>setOpenTaskId(null)}
        onUpdate={async patch=>{
          if(patch.status&&patch.status!==openTask.status) markNotif(openTask.trade,openTask.id);
          await updateTaskById(openTask.id, patch);
        }}
        onDelete={async()=>{await removeTask(openTask.id);setOpenTaskId(null);}}/>}
      {annotate&&<Annotator dataUrl={annotate.dataUrl} onCancel={()=>setAnnotate(null)} onSave={async out=>{await annotate.onSave(out);setAnnotate(null);}}/>}
      {lightbox&&<Lightbox photoId={lightbox} loadPhoto={loadPhoto} onClose={()=>setLightbox(null)}/>}
      {showBatch&&<BatchModal
        tasks={currentJob&&currentJob!=="ALL"?tasks.filter(t=>t.project===currentJob):tasks}
        trades={trades}
        onApply={async (selectedIds,newStatus)=>{
          const toUpdate = tasks.filter(t=>selectedIds.includes(t.id));
          for (const t of toUpdate) {
            const patch = {status:newStatus,statusHistory:[...(t.statusHistory||[]),{status:newStatus,by:user,ts:Date.now()}]};
            await updateTaskById(t.id, patch);
          }
          setShowBatch(false);
        }}
        onClose={()=>setShowBatch(false)}/>}
      {showEmail&&<EmailModal tasks={tasks} emailMap={emailMap} pendingNotif={pendingNotif}
        onClearNotif={t=>setPendingNotif(p=>{const n={...p};delete n[t];return n;})} onClose={()=>setShowEmail(false)}/>}
      {showEmailAll&&currProj&&<EmailAllModal
        job={currProj}
        tasks={tasks.filter(t=>t.project===currProj.name&&t.approval!=="Approved")}
        emailMap={emailMap}
        loadPhoto={loadPhoto}
        onClose={()=>setShowEmailAll(false)}/>}
      {showQR&&<QRModal project={showQR} onClose={()=>setShowQR(null)}/>}
      {showDir&&<DirectoryModal companies={companies} teamCode={teamCode} onSaveTC={pTC}
        onUpsert={async co=>{
          const ex=companies.some(c=>c.id===co.id);
          if(ex) await updateCompany(co); else await addCompany(co);
        }}
        onDelete={removeCompany}
        onImport={()=>setShowImport(true)} onWipe={wipeAll} onClose={()=>setShowDir(false)}/>}
      {showImport&&<ImportModal companies={companies} onImport={async newCos=>{
        for (const co of newCos) await addCompany(co);
        setShowImport(false);
      }} onClose={()=>setShowImport(false)}/>}
      {showSettings&&<CompanySettings settings={coSettings} onSave={async v=>{await pCS(v);setShowSettings(false);}} onClose={()=>setShowSettings(false)}/>}
    </Shell>
    </CompanyCtx.Provider>
  );
}

/* ================================================================ DESIGN PRIMITIVES */
const DISP = {fontFamily:"'TAN Garland','Cormorant Garamond',Georgia,serif",letterSpacing:"0.01em"};
const CAPT = {fontFamily:"Raleway,sans-serif",textTransform:"uppercase",letterSpacing:"0.08em"};

function Shell({children}){
  const co=useCompany();
  const accent=co.accentColor||C.gold;
  return(
    <div style={{minHeight:"100vh",background:"#FAFAF8",color:C.ink,fontFamily:"Raleway,system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Raleway:wght@300;400;500;600;700&family=Sacramento&family=Allura&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        input,select,textarea,button{font-family:Raleway,system-ui,sans-serif;font-size:15px;}
        input,select,textarea{background:#fff;border:1px solid ${C.line};border-radius:8px;padding:11px 12px;width:100%;color:${C.ink};}
        input:focus,select:focus,textarea:focus{outline:2px solid ${accent};outline-offset:1px;border-color:${accent};}
        button{cursor:pointer;border:none;border-radius:8px;font-weight:600;}
        @media print{.no-print{display:none!important}body{background:#fff}}
      `}</style>
      {children}
    </div>
  );
}

function Wordmark({size=32,forceText}){
  const co=useCompany();
  const c=C.taupe;
  if(co.logoUrl&&!forceText){
    return <img src={co.logoUrl} alt={co.name} style={{height:size*1.4,maxWidth:size*6,objectFit:"contain",display:"block"}}/>;
  }
  const words=(co.name||"Punch List").trim().split(/\s+/);
  const first=words[0]||"";
  const rest=words.slice(1).join(" ");
  return(
    <div style={{lineHeight:1,display:"inline-block"}}>
      <div style={{whiteSpace:"nowrap",fontStyle:"italic"}}>
        <span style={{fontFamily:"'Sacramento',cursive",fontSize:size*1.25,color:c}}>{first.charAt(0)}</span>
        <span style={{fontFamily:"'Allura',cursive",fontSize:size,color:c}}>{first.slice(1)}{rest?" ":""}</span>
        {rest&&<span style={{fontFamily:"'Allura',cursive",fontSize:size*0.85,color:c}}>{rest}</span>}
      </div>
      {words.length>1&&(
        <div style={{...CAPT,fontSize:Math.max(7,size*0.26),color:c,display:"flex",alignItems:"center",gap:5,marginTop:1}}>
          <span style={{flex:1,height:1.5,background:c}}/>
          <span style={{whiteSpace:"nowrap"}}>{words.slice(1).join(" ")}</span>
          <span style={{flex:1,height:1.5,background:c}}/>
        </div>
      )}
    </div>
  );
}

function Btn({kind="primary",children,...p}){
  const co=useCompany();
  const accent=co.accentColor||C.gold;
  const S={
    primary:{background:accent,color:"#2E2B28"},
    dark:{background:C.ink,color:"#fff"},
    green:{background:C.sage,color:"#fff"},
    red:{background:C.rust,color:"#fff"},
    ghost:{background:"transparent",color:C.ink,border:`1px solid ${C.line}`},
  }[kind]||{};
  return <button {...p} style={{padding:"11px 16px",minHeight:44,fontSize:14,...S,...(p.style||{})}}>{children}</button>;
}

function StatusChip({status,big}){
  const m=STATUS_META[status]||STATUS_META.Reported;
  return <span style={{...CAPT,background:m.bg,color:m.fg,fontWeight:700,fontSize:big?13:11,padding:big?"5px 12px":"3px 9px",borderRadius:6,whiteSpace:"nowrap"}}>{m.label}</span>;
}

function ApprovalChip({approval,big}){
  const m=APPROVAL_META[approval||"Pending"]||APPROVAL_META.Pending;
  return <span style={{...CAPT,background:m.bg,color:m.fg,fontWeight:700,fontSize:big?13:11,padding:big?"5px 12px":"3px 9px",borderRadius:6,whiteSpace:"nowrap"}}>{m.label}</span>;
}

const Lbl=({children})=><label style={{fontSize:12.5,fontWeight:600,color:C.taupe,display:"block",marginBottom:5}}>{children}</label>;
const Loader=({txt="Loading…"})=><div style={{padding:60,textAlign:"center",color:C.taupe}}>{txt}</div>;

function Modal({children,onClose,wide,xwide}){
  return(
    <div className="no-print" onClick={onClose}
      style={{position:"fixed",inset:0,background:"rgba(30,28,26,0.55)",zIndex:50,display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:"22px 8px"}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:C.paper,borderRadius:14,width:"100%",maxWidth:xwide?1160:wide?980:620,boxShadow:"0 16px 48px rgba(0,0,0,0.26)"}}>
        {children}
      </div>
    </div>
  );
}

function InternalLogin({loadCode,onAuth}){
  const [name,setName]=useState(""); const [code,setCode]=useState(""); const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const enter=async()=>{
    if(!name.trim())return; setBusy(true); setErr("");
    const tc=await loadCode();
    if(tc&&code.trim()!==tc){setErr("Incorrect access code.");setBusy(false);return;}
    onAuth(name.trim());
  };
  return(
    <div style={{minHeight:"100vh",background:"#F5F4F1",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.card,borderRadius:18,padding:"40px 36px",width:"100%",maxWidth:400,boxShadow:"0 8px 32px rgba(0,0,0,0.08)",border:`1px solid ${C.line}`}}>
        <div style={{textAlign:"center",marginBottom:16}}><Wordmark size={38}/></div>
        <div style={{...CAPT,fontSize:11,color:C.taupe,textAlign:"center",marginBottom:4}}>Internal Team Portal</div>
        <h1 style={{...DISP,fontSize:34,fontWeight:600,margin:"0 0 22px",textAlign:"center",lineHeight:1}}>Sign In</h1>
        <Lbl>Your name</Lbl>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="First and last name" style={{marginBottom:13}} onKeyDown={e=>e.key==="Enter"&&name.trim()&&enter()}/>
        <Lbl>Team access code</Lbl>
        <input type="password" value={code} onChange={e=>setCode(e.target.value)} placeholder="••••••" style={{marginBottom:6}} onKeyDown={e=>e.key==="Enter"&&name.trim()&&enter()}/>
        <p style={{fontSize:12.5,color:C.taupe,margin:"0 0 14px"}}>Set in the Trade Directory. Leave blank if none configured yet.</p>
        {err&&<div style={{background:"#F2DEDA",color:C.rust,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600,marginBottom:12}}>{err}</div>}
        <Btn kind="dark" disabled={!name.trim()||busy} style={{width:"100%",opacity:name.trim()?1:0.4,fontSize:16}} onClick={enter}>{busy?"Checking…":"Sign in →"}</Btn>
      </div>
    </div>
  );
}

function InternalPortalLabel(){
  const co=useCompany();
  return <div style={{...DISP,fontSize:19,fontWeight:600,color:C.taupe,borderLeft:`1px solid ${C.line}`,paddingLeft:12}}>{co.name?co.name+" — Punch List":"Punch List"}</div>;
}

function InternalHeader({userName,syncing,onSync,onSignOut}){
  return(
    <div style={{background:C.card,borderBottom:`1px solid ${C.line}`,padding:"10px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <Wordmark size={28}/>
      <InternalPortalLabel/>
      <div style={{flex:1}}/>
      <div style={{textAlign:"right",fontSize:13,color:C.taupe}}>{userName}<div style={{...CAPT,fontSize:10,color:C.stone}}>Team</div></div>
      <button onClick={onSync} style={{background:C.mist,color:C.ink,padding:"9px 11px",fontSize:13,border:`1px solid ${C.line}`,borderRadius:8}}>{syncing?"Syncing…":"⟳"}</button>
      <button onClick={onSignOut} style={{background:"transparent",color:C.taupe,padding:"9px 8px",fontSize:13,border:`1px solid ${C.line}`,borderRadius:8}}>Sign out</button>
    </div>
  );
}

function Dashboard({projects,tasks,onOpenJob,onAllJobs,onCalendar,onNewJob,onDirectory,onEmail,onSettings,onStatusChange,loadPhoto}){
  const co=useCompany();
  const [jobFilter,setJobFilter]=useState("Active");
  const stats=n=>{const l=tasks.filter(t=>t.project===n);return{total:l.length,open:l.filter(t=>t.status!=="Done").length,rej:l.filter(t=>t.approval==="Rejected").length,done:l.filter(t=>t.status==="Done").length,approved:l.filter(t=>t.approval==="Approved").length,overdue:l.filter(t=>t.status!=="Done"&&t.dueDate&&t.dueDate<today()).length};};
  const tot={open:tasks.filter(t=>t.status!=="Done").length,rej:tasks.filter(t=>t.approval==="Rejected").length,over:tasks.filter(t=>t.status!=="Done"&&t.dueDate&&t.dueDate<today()).length};
  const allSorted=[...projects].sort((a,b)=>b.createdAt-a.createdAt);
  const filtered=jobFilter==="All"?allSorted:allSorted.filter(p=>p.status===(jobFilter==="Closed"?"Closed":"Active"));
  const STATUS_OPTIONS=["Active","Closed"];
  const STATUS_COLORS={Active:C.sage,Closed:C.taupe};
  return(
    <div style={{padding:16,maxWidth:1100,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <h2 style={{...DISP,fontSize:30,fontWeight:600,margin:0,flex:1}}>Jobs</h2>
        <Btn kind="ghost" onClick={onAllJobs} style={{fontSize:13}}>All tasks</Btn>
        <Btn kind="ghost" onClick={onCalendar} style={{fontSize:13}}>📅 Calendar</Btn>
        <Btn kind="ghost" onClick={onEmail} style={{fontSize:13}}>✉ Email trades</Btn>
        <Btn kind="ghost" onClick={onDirectory} style={{fontSize:13}}>Trade directory</Btn>
        <Btn kind="ghost" onClick={onSettings} style={{fontSize:13}}>⚙ Settings</Btn>
        <Btn onClick={onNewJob}>+ New job</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginBottom:14}}>
        <StatCard label="Open items" value={tot.open} color={C.ink}/>
        <StatCard label="Approval rejected" value={tot.rej} color={tot.rej?C.rust:C.taupe}/>
        <StatCard label="Overdue" value={tot.over} color={tot.over?C.rust:C.taupe}/>
      </div>

      {/* Filter tabs */}
      <div style={{display:"flex",gap:0,border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden",width:"fit-content",marginBottom:14}}>
        {["Active","Closed","All"].map(f=>(
          <button key={f} onClick={()=>setJobFilter(f)}
            style={{background:jobFilter===f?C.ink:"#fff",color:jobFilter===f?"#fff":C.ink,padding:"9px 16px",fontSize:13,fontWeight:600,border:"none",borderRadius:0}}>
            {f} <span style={{opacity:0.6,fontWeight:400}}>({f==="All"?projects.length:projects.filter(p=>p.status===f).length})</span>
          </button>
        ))}
      </div>

      {filtered.length===0&&<div style={{padding:40,textAlign:"center",color:C.taupe,background:C.card,borderRadius:12,border:`1px dashed ${C.line}`}}>{jobFilter==="Closed"?"No closed jobs.":"No jobs yet. Create your first job to start a punch list."}</div>}
      <div style={{display:"grid",gap:10,gridTemplateColumns:"repeat(auto-fill,minmax(285px,1fr))"}}>
        {filtered.map(p=>{
          const s=stats(p.name); const pct=s.total?Math.round((s.done/s.total)*100):0; const apct=s.total?Math.round((s.approved/s.total)*100):0;
          const statusColor=STATUS_COLORS[p.status]||C.taupe;
          return(
            <div key={p.id} style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:12,overflow:"hidden",opacity:p.status==="Closed"?0.7:1}}>
              <div style={{padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3}}>
                  <div style={{...DISP,fontSize:19,fontWeight:600,lineHeight:1.15,cursor:"pointer",flex:1}} onClick={()=>onOpenJob(p.name)}>{p.name}</div>
                  <select value={p.status} onClick={e=>e.stopPropagation()}
                    onChange={e=>{e.stopPropagation();onStatusChange(p,e.target.value);}}
                    style={{fontSize:11,fontWeight:700,color:statusColor,border:`1.5px solid ${statusColor}`,borderRadius:6,padding:"3px 7px",background:"#fff",cursor:"pointer",height:"fit-content"}}>
                    {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{fontSize:12.5,color:C.taupe,margin:"3px 0 10px",cursor:"pointer"}} onClick={()=>onOpenJob(p.name)}>{[p.client,p.address].filter(Boolean).join(" · ")||"—"}{p.siteContact&&<span style={{fontSize:11.5}}> · {p.siteContact}{p.sitePhone?" · "+p.sitePhone:""}</span>}</div>
                <div style={{height:6,background:C.mist,borderRadius:4,overflow:"hidden",marginBottom:9,cursor:"pointer"}} onClick={()=>onOpenJob(p.name)}><div style={{width:pct+"%",height:"100%",background:pct===100?C.sage:(co.accentColor||C.gold)}}/></div>
                <div style={{display:"flex",gap:12,fontSize:13,flexWrap:"wrap",cursor:"pointer"}} onClick={()=>onOpenJob(p.name)}>
                  <span><b>{s.open}</b> open</span>
                  {s.rej>0&&<span style={{color:C.rust,fontWeight:700}}>{s.rej} rejected</span>}
                  {s.overdue>0&&<span style={{color:C.rust,fontWeight:700}}>{s.overdue} overdue</span>}
                  <span style={{color:C.taupe}}>{pct}% done · {apct}% approved</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({label,value,color}){
  return(<div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:12,padding:"12px 15px"}}>
    <div style={{...DISP,fontSize:32,fontWeight:600,color,lineHeight:1}}>{value}</div>
    <div style={{...CAPT,fontSize:10,color:C.taupe,marginTop:4,fontWeight:600}}>{label}</div>
  </div>);
}

function JobBar({project,jobLabel,onBack,onQR,onEmailAll,onEdit}){
  return(
    <div style={{background:C.card,borderBottom:`1px solid ${C.line}`,padding:"9px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <button onClick={onBack} style={{background:"transparent",border:`1px solid ${C.line}`,padding:"8px 11px",fontSize:13,borderRadius:8}}>← Jobs</button>
      <div style={{flex:1}}>
        <div style={{...DISP,fontSize:20,fontWeight:600}}>{jobLabel}</div>
        {project&&<div style={{fontSize:12,color:C.taupe}}>{[project.client,project.address,project.siteContact&&("Site contact: "+project.siteContact+(project.sitePhone?" · "+project.sitePhone:""))].filter(Boolean).join(" · ")}</div>}
      </div>
      {onEdit&&<Btn kind="ghost" onClick={onEdit} style={{fontSize:13}}>✏ Edit job</Btn>}
      {onEmailAll&&<Btn kind="ghost" onClick={onEmailAll} style={{fontSize:13}}>✉ Email all trades</Btn>}
      {onQR&&<Btn kind="ghost" onClick={onQR} style={{fontSize:13}}>QR / Share link</Btn>}
    </div>
  );
}

function InternalToolbar({filters,setFilters,trades,taskMode,setTaskMode,onNew,onReport,onBatch,counts}){
  const open=counts.filter(t=>t.status!=="Done").length;
  const rej=counts.filter(t=>t.approval==="Rejected").length;
  return(
    <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.line}`,background:C.card}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
        <div style={{display:"flex",border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}>
          {[["list","List"],["calendar","📅"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTaskMode(v)} style={{background:taskMode===v?C.ink:"#fff",color:taskMode===v?"#fff":C.ink,padding:"10px 13px",borderRadius:0,fontSize:14,border:"none"}}>{l}</button>
          ))}
        </div>
        <select style={{width:"auto"}} value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}>
          <option>All</option>{STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select style={{width:"auto"}} value={filters.trade} onChange={e=>setFilters({...filters,trade:e.target.value})}>
          <option>All</option>{trades.map(t=><option key={t}>{t}</option>)}
        </select>
        <input placeholder="Search…" value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})} style={{flex:1,minWidth:130}}/>
        <Btn onClick={onNew}>+ Task</Btn>
        <Btn kind="ghost" onClick={onBatch}>Batch update</Btn>
        <Btn kind="ghost" onClick={onReport}>Report</Btn>
      </div>
      <div style={{marginTop:8,fontSize:13,color:C.taupe}}><b style={{color:C.ink}}>{open}</b> open{rej>0&&<span style={{color:C.rust,fontWeight:700}}> · {rej} approval rejected</span>}</div>
    </div>
  );
}

function TaskList({tasks,showProject,onOpen,loadPhoto}){
  if(!tasks.length) return <div style={{padding:50,textAlign:"center",color:C.taupe}}>No tasks match. Adjust the filters or create the first punch item.</div>;
  return(
    <div style={{padding:12,display:"grid",gap:9,gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))"}}>
      {tasks.map(t=><TaskCard key={t.id} task={t} showProject={showProject} onOpen={()=>onOpen(t.id)} loadPhoto={loadPhoto}/>)}
    </div>
  );
}

function TaskCard({task,showProject,onOpen,loadPhoto}){
  const overdue=task.dueDate&&task.dueDate<today()&&task.status!=="Done";
  const accent=STATUS_META[task.status]?.fg||C.taupe;
  return(
    <div onClick={onOpen} style={{background:C.card,border:`1px solid ${C.line}`,borderLeft:`5px solid ${accent}`,borderRadius:10,cursor:"pointer",overflow:"hidden"}}>

      {/* Section 1 — Location header */}
      <div style={{padding:"8px 13px",borderBottom:`1px solid ${C.line}`,background:C.mist,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0,flex:1}}>
          <span style={{...CAPT,fontSize:9,color:C.stone,flexShrink:0}}>Location</span>
          <span style={{fontSize:12.5,fontWeight:700,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {showProject?`${task.project} — `:""}{task.area}
          </span>
        </div>
        <div style={{display:"flex",gap:3,flexShrink:0}}>
          <span style={{...CAPT,background:STATUS_META[task.status]?.bg,color:STATUS_META[task.status]?.fg,fontWeight:700,fontSize:10,padding:"2px 7px",borderRadius:5,whiteSpace:"nowrap"}}>{task.status}</span>
          <span style={{...CAPT,background:APPROVAL_META[task.approval||"Pending"]?.bg,color:APPROVAL_META[task.approval||"Pending"]?.fg,fontWeight:700,fontSize:10,padding:"2px 7px",borderRadius:5,whiteSpace:"nowrap"}}>{task.approval||"Pending"}</span>
        </div>
      </div>

      {/* Section 2 — Task description (most prominent) */}
      <div style={{padding:"11px 13px 10px",borderBottom:`1px solid ${C.line}`}}>
        <div style={{...CAPT,fontSize:9,color:C.stone,marginBottom:4}}>Task</div>
        <div style={{fontWeight:700,fontSize:15,lineHeight:1.4,color:C.ink}}>{task.description}</div>
      </div>

      {/* Section 3 — Key details */}
      <div style={{padding:"9px 13px",borderBottom:(task.photos||[]).length>0||((task.comments||[]).length>0)?`1px solid ${C.line}`:"none",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px 12px",fontSize:12.5}}>
        <div>
          <div style={{...CAPT,fontSize:9,color:C.stone,marginBottom:2}}>Assignee</div>
          <div style={{fontWeight:600,color:C.ink}}>{task.trade||"—"}</div>
        </div>
        <div>
          <div style={{...CAPT,fontSize:9,color:C.stone,marginBottom:2}}>Priority</div>
          <div style={{fontWeight:700,color:PRI_FG[task.priority]}}>{task.priority}</div>
        </div>
        <div>
          <div style={{...CAPT,fontSize:9,color:C.stone,marginBottom:2}}>Due date</div>
          <div style={{fontWeight:600,color:overdue?C.rust:C.ink}}>{fmtDate(task.dueDate)}{overdue?" ⚠":""}</div>
        </div>
        <div>
          <div style={{...CAPT,fontSize:9,color:C.stone,marginBottom:2}}>Reported by</div>
          <div style={{fontWeight:600,color:C.ink}}>{task.createdBy||"—"}</div>
        </div>
      </div>

      {/* Section 4 — Photos + comments */}
      {((task.photos||[]).length>0||(task.comments||[]).length>0)&&(
        <div style={{padding:"8px 13px",display:"flex",alignItems:"center",gap:8,background:"#FAFAF8"}}>
          {(task.photos||[]).length>0&&(
            <div style={{display:"flex",gap:4,flex:1}}>
              {(task.photos||[]).slice(0,4).map(pid=><PhotoThumb key={pid} pid={pid} loadPhoto={loadPhoto} size={48}/>)}
              {(task.photos||[]).length>4&&<div style={{width:48,height:48,borderRadius:7,background:C.mist,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.taupe,fontWeight:600}}>+{task.photos.length-4}</div>}
            </div>
          )}
          {(task.comments||[]).length>0&&(
            <div style={{fontSize:12,color:C.taupe,whiteSpace:"nowrap",marginLeft:"auto"}}>💬 {task.comments.length} note{task.comments.length!==1?"s":""}</div>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoThumb({pid,loadPhoto,size=70,onClick}){
  const [src,setSrc]=useState(null);
  useEffect(()=>{let live=true;if(pid)loadPhoto(pid).then(v=>live&&setSrc(v));return()=>{live=false;};},[pid,loadPhoto]);
  return(
    <div onClick={onClick} style={{width:size,height:size,borderRadius:8,background:C.mist,flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",color:C.stone,fontSize:10.5,cursor:onClick?"pointer":"default"}}>
      {pid?(src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"…"):"No photo"}
    </div>
  );
}

function TaskDetail({task,userName,loadPhoto,savePhoto,requestAnnotate,onLightbox,onClose,onUpdate,onDelete,trades,projects,companies}){
  const co=useCompany();
  const accent=co?.accentColor||C.gold;
  const [editing,setEditing]=useState(false);
  const [editF,setEditF]=useState({area:task.area,description:task.description,trade:task.trade,priority:task.priority,dueDate:task.dueDate||""});
  const [comment,setComment]=useState("");
  const fileRef=useRef();
  const overdue=task.dueDate&&task.dueDate<today()&&task.status!=="Done";

  const addComment=text=>{if(!text.trim())return;onUpdate({comments:[...(task.comments||[]),{id:uid(),author:userName,role:"internal",text:text.trim(),ts:Date.now()}]});setComment("");};
  const addPhoto=async e=>{const file=e.target.files[0];e.target.value="";if(!file)return;const c=await compress(file);requestAnnotate(c,async ann=>{const pid=await savePhoto(ann);onUpdate({photos:[...(task.photos||[]),pid]});});};
  const saveEdit=()=>{onUpdate({area:editF.area.trim(),description:editF.description.trim(),trade:editF.trade.trim(),priority:editF.priority,dueDate:editF.dueDate});setEditing(false);};

  const tradeInfo=companies?.find(c=>c.name===task.trade);

  const timeline=[
    {ts:task.createdAt,label:"Task reported",by:task.createdBy||"Team",color:C.taupe},
    ...(task.statusHistory||[]).map(h=>({ts:h.ts,label:`Status → ${h.status}`,by:h.by,color:STATUS_META[h.status]?.fg||C.taupe})),
    ...(task.comments||[]).map(c=>({ts:c.ts,label:c.text,by:c.author,color:C.stone,isComment:true})),
  ].sort((a,b)=>a.ts-b.ts);

  const Section=({title,children,noBorder})=>(
    <div style={{marginBottom:0}}>
      <div style={{...CAPT,fontSize:10,fontWeight:700,color:C.stone,padding:"10px 18px 6px",background:C.mist,borderTop:`1px solid ${C.line}`,borderBottom:`1px solid ${C.line}`}}>{title}</div>
      <div style={{padding:"12px 18px",borderBottom:noBorder?`none`:`1px solid ${C.line}`}}>{children}</div>
    </div>
  );

  return(
    <Modal onClose={onClose} wide>
      <div style={{padding:0,overflow:"hidden",borderRadius:14}}>

        {/* ── Header ── */}
        <div style={{padding:"16px 18px",background:STATUS_META[task.status]?.bg||C.mist,borderBottom:`1px solid ${C.line}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:C.taupe,marginBottom:4}}>
                {task.project} · <span style={{color:accent}}>{task.area}</span>
                {tradeInfo&&<span style={{fontWeight:400}}> · {tradeInfo.contactName||tradeInfo.name}{tradeInfo.phone?" · "+tradeInfo.phone:""}</span>}
              </div>
              <h2 style={{margin:"0 0 9px",fontSize:21,lineHeight:1.3,fontWeight:700}}>{task.description}</h2>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <StatusChip status={task.status} big/>
                <ApprovalChip approval={task.approval} big/>
                <span style={{...CAPT,fontSize:11,fontWeight:700,color:PRI_FG[task.priority],background:"rgba(255,255,255,0.7)",padding:"3px 9px",borderRadius:6}}>{task.priority}</span>
                {overdue&&<span style={{...CAPT,fontSize:11,fontWeight:700,color:C.rust,background:"#F9EDEC",padding:"3px 9px",borderRadius:6}}>⚠ OVERDUE</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:7,flexShrink:0}}>
              <Btn kind="ghost" onClick={()=>{setEditF({area:task.area,description:task.description,trade:task.trade,priority:task.priority,dueDate:task.dueDate||""});setEditing(!editing);}} style={{fontSize:13,padding:"8px 12px"}}>
                {editing?"✕ Cancel":"✏ Edit"}
              </Btn>
              <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:24,color:C.taupe,lineHeight:1,cursor:"pointer"}}>×</button>
            </div>
          </div>
        </div>

        {/* ── Edit form ── */}
        {editing&&(
          <div style={{padding:"14px 18px",background:"#FFFEF9",borderBottom:`1px solid ${C.line}`}}>
            <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr"}}>
              <div><Lbl>Room / area</Lbl><input value={editF.area} onChange={e=>setEditF(f=>({...f,area:e.target.value}))}/></div>
              <div><Lbl>Assigned trade</Lbl>
                <select value={editF.trade} onChange={e=>setEditF(f=>({...f,trade:e.target.value}))}>
                  <option value="">— Select —</option>
                  {(trades||[]).filter(t=>companies?.find(c=>c.name===t)).length>0&&<optgroup label="Trade Directory">{(trades||[]).filter(t=>companies?.find(c=>c.name===t)).map(t=><option key={t} value={t}>{t}</option>)}</optgroup>}
                  {(trades||[]).filter(t=>!companies?.find(c=>c.name===t)).length>0&&<optgroup label="Other">{(trades||[]).filter(t=>!companies?.find(c=>c.name===t)).map(t=><option key={t} value={t}>{t}</option>)}</optgroup>}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}><Lbl>Description</Lbl><textarea rows={2} value={editF.description} onChange={e=>setEditF(f=>({...f,description:e.target.value}))}/></div>
              <div><Lbl>Priority</Lbl><select value={editF.priority} onChange={e=>setEditF(f=>({...f,priority:e.target.value}))}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></div>
              <div><Lbl>Due date</Lbl><input type="date" value={editF.dueDate} onChange={e=>setEditF(f=>({...f,dueDate:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:9,marginTop:11,justifyContent:"flex-end"}}>
              <Btn kind="ghost" onClick={()=>setEditing(false)}>Cancel</Btn>
              <Btn onClick={saveEdit} disabled={!editF.area.trim()||!editF.description.trim()||!editF.trade.trim()}>Save changes</Btn>
            </div>
          </div>
        )}

        {/* ── Task details grid ── */}
        <Section title="Task Details">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px 16px"}}>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Assignee</div><div style={{fontWeight:700}}>{task.trade||"—"}</div>{tradeInfo?.contactName&&<div style={{fontSize:12,color:C.taupe}}>{tradeInfo.contactName}</div>}{tradeInfo?.phone&&<div style={{fontSize:12,color:C.taupe}}>{tradeInfo.phone}</div>}</div>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Location</div><div style={{fontWeight:700}}>{task.area||"—"}</div></div>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Priority</div><div style={{fontWeight:700,color:PRI_FG[task.priority]}}>{task.priority}</div></div>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Due date</div><div style={{fontWeight:700,color:overdue?C.rust:C.ink}}>{fmtDate(task.dueDate)}{overdue?" ⚠":""}</div></div>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Reported by</div><div style={{fontWeight:700}}>{task.createdBy||"—"}</div></div>
            <div><div style={{...CAPT,fontSize:9.5,color:C.stone,marginBottom:3}}>Reported on</div><div style={{fontWeight:700}}>{fmtDate(new Date(task.createdAt).toISOString().slice(0,10))}</div></div>
          </div>
          {task.approval==="Approved"&&(
            <div style={{marginTop:12,padding:"9px 12px",background:"#EAF2E8",border:`1.5px solid ${C.sage}`,borderRadius:8,color:C.sage,fontWeight:700,fontSize:13}}>
              ✓ Approved by {task.approvedBy} — {fmtDate(new Date(task.approvedAt).toISOString().slice(0,10))}
            </div>
          )}
        </Section>

        {/* ── Progress & Approval actions ── */}
        <Section title="Progress & Approval">
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",paddingBottom:10,marginBottom:10,borderBottom:`1px solid ${C.line}`}}>
            <span style={{...CAPT,fontSize:10,color:C.taupe,fontWeight:600}}>Progress:</span>
            {["Reported","Scheduled","Done"].map((s,i,arr)=>(
              <React.Fragment key={s}>
                <Btn kind={task.status===s?"dark":"ghost"} style={{padding:"7px 13px",fontSize:13,opacity:task.status===s?1:0.65}}
                  onClick={()=>task.status!==s&&onUpdate({status:s,statusHistory:[...(task.statusHistory||[]),{status:s,by:userName,ts:Date.now()}]})}>
                  {s}
                </Btn>
                {i<arr.length-1&&<span style={{color:C.lineHvy,fontSize:16}}>→</span>}
              </React.Fragment>
            ))}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{...CAPT,fontSize:10,color:C.taupe,fontWeight:600}}>Approval:</span>
            <Btn kind="green" style={{padding:"7px 13px",fontSize:13}} onClick={()=>onUpdate({approval:"Approved",status:"Done",approvedBy:userName,approvedAt:Date.now(),statusHistory:[...(task.statusHistory||[]),{status:"Approved",by:userName,ts:Date.now()}]})}>✓ Approve</Btn>
            <Btn kind="red" style={{padding:"7px 13px",fontSize:13}} onClick={()=>{const r=window.prompt("Rejection reason:");if(!r?.trim())return;onUpdate({approval:"Rejected",status:"Reported",approvedBy:null,approvedAt:null,statusHistory:[...(task.statusHistory||[]),{status:"Rejected",by:userName,ts:Date.now()}],comments:[...(task.comments||[]),{id:uid(),author:userName,role:"internal",text:"REJECTED: "+r.trim(),ts:Date.now()}]});}}>✗ Reject</Btn>
            {task.approval==="Approved"&&<Btn kind="ghost" style={{padding:"7px 13px",fontSize:13}} onClick={()=>onUpdate({approval:"Pending",status:"Reported",approvedBy:null,approvedAt:null})}>Clear</Btn>}
            <div style={{flex:1}}/>
            <Btn kind="ghost" style={{color:C.rust,fontSize:13,padding:"7px 13px"}} onClick={()=>window.confirm("Delete this task?")&&onDelete()}>Delete</Btn>
          </div>
        </Section>

        {/* ── Photos ── */}
        <Section title={`Photos (${(task.photos||[]).length})`}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {(task.photos||[]).map(pid=><PhotoThumb key={pid} pid={pid} loadPhoto={loadPhoto} size={100} onClick={()=>onLightbox(pid)}/>)}
            <button onClick={()=>fileRef.current.click()}
              style={{width:100,height:100,borderRadius:8,border:`2px dashed ${C.line}`,background:"#fff",color:C.taupe,fontSize:13,cursor:"pointer"}}>
              📷 Add
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={addPhoto} style={{display:"none"}}/>
          </div>
          {(task.photos||[]).length>0&&<div style={{fontSize:12,color:C.stone,marginTop:6}}>Tap any photo to enlarge.</div>}
        </Section>

        {/* ── Comments ── */}
        <Section title="Notes & Comments">
          <div style={{display:"grid",gap:7,marginBottom:10}}>
            {(task.comments||[]).length===0&&<div style={{fontSize:13.5,color:C.taupe}}>No comments yet.</div>}
            {(task.comments||[]).map(c=>(
              <div key={c.id} style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:8,padding:"9px 12px",borderLeft:`3px solid ${c.role==="internal"?accent:C.line}`}}>
                <div style={{fontSize:12,color:C.taupe,marginBottom:3}}><b style={{color:c.role==="internal"?accent:C.ink}}>{c.author}</b> · {fmtDT(c.ts)}</div>
                <div style={{fontSize:14,whiteSpace:"pre-wrap",color:c.text.startsWith("REJECTED:")?C.rust:C.ink,fontWeight:c.text.startsWith("REJECTED:")?600:400}}>{c.text}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a note…" onKeyDown={e=>e.key==="Enter"&&addComment(comment)}/>
            <Btn kind="ghost" onClick={()=>addComment(comment)}>Post</Btn>
          </div>
        </Section>

        {/* ── Timeline ── */}
        <Section title="Activity Timeline" noBorder>
          <div style={{position:"relative",paddingLeft:22}}>
            <div style={{position:"absolute",left:6,top:4,bottom:4,width:2,background:C.line}}/>
            {timeline.map((ev,i)=>(
              <div key={i} style={{position:"relative",marginBottom:13}}>
                <div style={{position:"absolute",left:-18,top:4,width:10,height:10,borderRadius:"50%",background:ev.color,border:"2px solid #fff",boxShadow:`0 0 0 1.5px ${ev.color}`}}/>
                <div style={{fontSize:11.5,color:C.stone}}>{fmtDT(ev.ts)}</div>
                <div style={{fontSize:13.5,fontWeight:ev.isComment?400:600,marginTop:1,color:ev.isComment?C.taupe:C.ink}}>{ev.label}</div>
                <div style={{fontSize:11.5,color:C.stone}}>by {ev.by}</div>
              </div>
            ))}
          </div>
        </Section>

      </div>
    </Modal>
  );
}

function NewJobModal({onCancel,onCreate}){
  const [f,setF]=useState({name:"",client:"",address:"",siteContact:"",sitePhone:""}); const set=k=>e=>setF({...f,[k]:e.target.value}); const ok=f.name.trim();
  return(<Modal onClose={onCancel}><div style={{padding:18}}>
    <h2 style={{...DISP,fontSize:26,margin:"0 0 13px"}}>New Job</h2>
    <Lbl>Job name</Lbl><input value={f.name} onChange={set("name")} placeholder="e.g. Blackburn Residence" style={{marginBottom:11}}/>
    <Lbl>Client</Lbl><input value={f.client} onChange={set("client")} placeholder="Optional" style={{marginBottom:11}}/>
    <Lbl>Address</Lbl><input value={f.address} onChange={set("address")} placeholder="Optional" style={{marginBottom:11}}/>
    <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr",marginBottom:14}}>
      <div><Lbl>Site contact</Lbl><input value={f.siteContact} onChange={set("siteContact")} placeholder="Name"/></div>
      <div><Lbl>Site contact phone</Lbl><input type="tel" value={f.sitePhone} onChange={set("sitePhone")} placeholder="(417) 555-0100"/></div>
    </div>
    <div style={{display:"flex",gap:9,justifyContent:"flex-end"}}><Btn kind="ghost" onClick={onCancel}>Cancel</Btn><Btn disabled={!ok} style={{opacity:ok?1:0.4}} onClick={()=>onCreate({id:uid(),name:f.name.trim(),client:f.client.trim(),address:f.address.trim(),siteContact:f.siteContact.trim(),sitePhone:f.sitePhone.trim(),status:"Active",createdAt:Date.now()})}>Create</Btn></div>
  </div></Modal>);
}

function EditJobModal({project,onCancel,onSave}){
  const [f,setF]=useState({name:project.name,client:project.client||"",address:project.address||"",siteContact:project.siteContact||"",sitePhone:project.sitePhone||""});
  const set=k=>e=>setF({...f,[k]:e.target.value}); const ok=f.name.trim();
  return(<Modal onClose={onCancel}><div style={{padding:18}}>
    <h2 style={{...DISP,fontSize:26,margin:"0 0 13px"}}>Edit Job</h2>
    <Lbl>Job name</Lbl><input value={f.name} onChange={set("name")} style={{marginBottom:11}}/>
    <Lbl>Client</Lbl><input value={f.client} onChange={set("client")} placeholder="Optional" style={{marginBottom:11}}/>
    <Lbl>Address</Lbl><input value={f.address} onChange={set("address")} placeholder="Optional" style={{marginBottom:11}}/>
    <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr",marginBottom:14}}>
      <div><Lbl>Site contact</Lbl><input value={f.siteContact} onChange={set("siteContact")} placeholder="Name"/></div>
      <div><Lbl>Site contact phone</Lbl><input type="tel" value={f.sitePhone} onChange={set("sitePhone")} placeholder="(417) 555-0100"/></div>
    </div>
    <div style={{display:"flex",gap:9,justifyContent:"flex-end"}}>
      <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
      <Btn disabled={!ok} style={{opacity:ok?1:0.4}} onClick={()=>onSave({...project,name:f.name.trim(),client:f.client.trim(),address:f.address.trim(),siteContact:f.siteContact.trim(),sitePhone:f.sitePhone.trim()})}>Save changes</Btn>
    </div>
  </div></Modal>);
}

function NewTaskModal({userName,lockedProject,projects,companies,trades,savePhoto,requestAnnotate,onCancel,onCreate}){
  const [f,setF]=useState({project:lockedProject||projects[0]?.name||"",area:"",description:"",trade:"",priority:"Medium",dueDate:today()});
  const [photos,setPhotos]=useState([]); const fileRef=useRef();
  const set=k=>e=>setF({...f,[k]:e.target.value}); const ok=f.project&&f.area&&f.description&&f.trade;
  const hFile=async e=>{const file=e.target.files[0];e.target.value="";if(!file)return;const c=await compress(file);requestAnnotate(c,async ann=>setPhotos(p=>[...p,ann]));};
  const create=async()=>{const ids=[];for(const p of photos)ids.push(await savePhoto(p));onCreate({id:uid(),...f,project:f.project.trim(),area:f.area.trim(),trade:f.trade.trim(),status:"Reported",approval:"Pending",photos:ids,comments:[],statusHistory:[],createdBy:userName,createdAt:Date.now(),approvedBy:null,approvedAt:null});};

  // Build trade options: companies from directory first, then any trades on tasks not in directory
  const companyNames = companies.map(c=>c.name);
  const extraTrades  = trades.filter(t=>!companyNames.includes(t));

  return(<Modal onClose={onCancel}><div style={{padding:18}}>
    <h2 style={{...DISP,fontSize:26,margin:"0 0 13px"}}>New Punch Item</h2>
    <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr"}}>
      <div><Lbl>Job</Lbl>{lockedProject?<input value={lockedProject} disabled style={{background:"#EDEDE8"}}/>:<select value={f.project} onChange={set("project")}>{projects.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select>}</div>
      <div><Lbl>Room / area</Lbl><input value={f.area} onChange={set("area")} placeholder="e.g. Primary Bath"/></div>
      <div style={{gridColumn:"1 / -1"}}><Lbl>Task description</Lbl><textarea rows={3} value={f.description} onChange={set("description")} placeholder="Specific and verifiable."/></div>
      <div>
        <Lbl>Assigned trade</Lbl>
        <select value={f.trade} onChange={set("trade")} style={{color:f.trade?undefined:C.stone}}>
          <option value="">— Select trade —</option>
          {companyNames.length>0&&<optgroup label="Trade Directory">{companyNames.map(n=><option key={n} value={n}>{n}</option>)}</optgroup>}
          {extraTrades.length>0&&<optgroup label="Other (not in directory)">{extraTrades.map(n=><option key={n} value={n}>{n}</option>)}</optgroup>}
        </select>
        {f.trade&&companies.find(c=>c.name===f.trade)&&(()=>{
          const co=companies.find(c=>c.name===f.trade);
          return <div style={{fontSize:12,color:C.taupe,marginTop:4}}>{[co.tradeType,co.contactName,co.phone].filter(Boolean).join(" · ")||"No contact info"}</div>;
        })()}
        {f.trade&&!companies.find(c=>c.name===f.trade)&&<div style={{fontSize:12,color:C.amber,marginTop:4}}>Not in trade directory — add them to send emails.</div>}
      </div>
      <div><Lbl>Priority</Lbl><select value={f.priority} onChange={set("priority")}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></div>
      <div><Lbl>Due date</Lbl><input type="date" value={f.dueDate} onChange={set("dueDate")}/></div>
      <div><Lbl>Photos</Lbl><Btn kind="ghost" style={{width:"100%"}} onClick={()=>fileRef.current.click()}>📷 Add photo</Btn><input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={hFile} style={{display:"none"}}/></div>
    </div>
    {photos.length>0&&<div style={{display:"flex",gap:7,marginTop:10,flexWrap:"wrap"}}>{photos.map((p,i)=><img key={i} src={p} alt="" style={{width:66,height:66,objectFit:"cover",borderRadius:7}}/>)}</div>}
    <div style={{display:"flex",gap:9,marginTop:16,justifyContent:"flex-end"}}><Btn kind="ghost" onClick={onCancel}>Cancel</Btn><Btn disabled={!ok} style={{opacity:ok?1:0.4}} onClick={create}>Create task</Btn></div>
  </div></Modal>);
}

function Annotator({dataUrl,onCancel,onSave}){
  const cvRef=useRef(); const imgRef=useRef(); const sRef=useRef([]); const curRef=useRef(null);
  const [color,setColor]=useState("#E8230D"); const [pen,setPen]=useState(4); const [,setT]=useState(0);
  const cRef=useRef(color); cRef.current=color; const pRef=useRef(pen); pRef.current=pen;

  const COLORS=[
    {hex:"#E8230D",label:"Red"},
    {hex:"#FF6B00",label:"Orange"},
    {hex:"#FFD60A",label:"Yellow"},
    {hex:"#1FC94B",label:"Green"},
    {hex:"#1FA2FF",label:"Blue"},
    {hex:"#A855F7",label:"Purple"},
    {hex:"#FF69B4",label:"Pink"},
    {hex:"#FFFFFF",label:"White"},
    {hex:"#2E2B28",label:"Black"},
  ];

  const THICKNESSES=[
    {value:2, label:"Fine (2px)"},
    {value:4, label:"Thin (4px)"},
    {value:7, label:"Medium (7px)"},
    {value:12,label:"Thick (12px)"},
    {value:20,label:"Heavy (20px)"},
    {value:32,label:"Brush (32px)"},
  ];

  useEffect(()=>{const img=new Image();img.onload=()=>{imgRef.current=img;const cv=cvRef.current;cv.width=img.width;cv.height=img.height;redraw();};img.src=dataUrl;},[dataUrl]);

  const redraw=()=>{
    const cv=cvRef.current;if(!cv||!imgRef.current)return;
    const ctx=cv.getContext("2d");ctx.drawImage(imgRef.current,0,0);
    for(const s of curRef.current?[...sRef.current,curRef.current]:sRef.current){
      ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.lineCap="round";ctx.lineJoin="round";
      ctx.beginPath();s.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
    }
  };

  const pos=e=>{const cv=cvRef.current;const r=cv.getBoundingClientRect();return[((e.clientX-r.left)/r.width)*cv.width,((e.clientY-r.top)/r.height)*cv.height];};
  const onPD=e=>{e.preventDefault();cvRef.current.setPointerCapture(e.pointerId);curRef.current={color:cRef.current,size:pRef.current,points:[pos(e)]};};
  const onPM=e=>{if(!curRef.current)return;curRef.current.points.push(pos(e));redraw();};
  const onPU=()=>{if(curRef.current){sRef.current.push(curRef.current);curRef.current=null;setT(v=>v+1);}};

  return(<div className="no-print" style={{position:"fixed",inset:0,background:"#111",zIndex:80,display:"flex",flexDirection:"column"}}>
    <div style={{padding:"10px 14px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",background:"#1a1918"}}>
      <span style={{...DISP,color:"#fff",fontSize:18,fontWeight:600,marginRight:4}}>Mark Up Photo</span>

      {/* Color swatches */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
        {COLORS.map(c=>(
          <button key={c.hex} onClick={()=>setColor(c.hex)} title={c.label}
            style={{width:28,height:28,borderRadius:"50%",background:c.hex,
              border:color===c.hex?"3px solid #fff":"2px solid rgba(255,255,255,0.2)",
              boxShadow:color===c.hex?"0 0 0 2px #555":"none",cursor:"pointer",flexShrink:0}}/>
        ))}
      </div>

      {/* Thickness dropdown */}
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{color:"#888",fontSize:12,whiteSpace:"nowrap"}}>Thickness</span>
        <select value={pen} onChange={e=>setPen(Number(e.target.value))}
          style={{background:"#2a2826",color:"#fff",border:"1px solid #555",borderRadius:6,padding:"6px 10px",fontSize:13,cursor:"pointer"}}>
          {THICKNESSES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {/* Live preview of current color + thickness */}
        <svg width="50" height="28" style={{flexShrink:0}}>
          <line x1="4" y1="14" x2="46" y2="14" stroke={color} strokeWidth={Math.min(pen,20)} strokeLinecap="round"/>
        </svg>
      </div>

      <button onClick={()=>{sRef.current.pop();redraw();setT(v=>v+1);}} disabled={!sRef.current.length}
        style={{background:"#2a2826",color:"#fff",padding:"8px 12px",opacity:sRef.current.length?1:0.4,border:"none",borderRadius:8,cursor:"pointer"}}>
        ↩ Undo
      </button>
      <div style={{flex:1}}/>
      <button onClick={onCancel} style={{background:"transparent",color:"#ccc",border:"1px solid #555",padding:"9px 14px",borderRadius:8,cursor:"pointer"}}>Cancel</button>
      <Btn onClick={()=>onSave(cvRef.current.toDataURL("image/jpeg",0.82))}>Save</Btn>
    </div>
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:10,minHeight:0}}>
      <canvas ref={cvRef} onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
        style={{maxWidth:"100%",maxHeight:"100%",touchAction:"none",borderRadius:6,background:"#000",cursor:"crosshair"}}/>
    </div>
    <div style={{textAlign:"center",color:"#555",fontSize:12,paddingBottom:10}}>
      Draw to circle or mark up the issue. Pick color and thickness above. ↩ Undo to remove last stroke.
    </div>
  </div>);
}

function Lightbox({photoId,loadPhoto,onClose}){
  const [src,setSrc]=useState(null);
  useEffect(()=>{loadPhoto(photoId).then(setSrc);},[photoId,loadPhoto]);
  return(<div className="no-print" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(20,18,16,0.92)",zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",padding:14}}>
    {src?<img src={src} alt="" style={{maxWidth:"100%",maxHeight:"100%",borderRadius:8}}/>:<span style={{color:"#fff"}}>Loading…</span>}
  </div>);
}

function CalendarView({tasks,onOpen}){
  const co=useCompany();
  const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
  const byDay={};for(const t of tasks)if(t.dueDate)(byDay[t.dueDate]=byDay[t.dueDate]||[]).push(t);
  const y=month.getFullYear(),m=month.getMonth();
  const cells=[...Array(new Date(y,m,1).getDay()).fill(null),...Array.from({length:new Date(y,m+1,0).getDate()},(_,i)=>i+1)];
  const iso=d=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const tdy=today();
  return(<div style={{padding:14,maxWidth:1100,margin:"0 auto"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
      <Btn kind="ghost" onClick={()=>setMonth(new Date(y,m-1,1))}>←</Btn>
      <div style={{...DISP,fontSize:26,fontWeight:600,flex:1,textAlign:"center"}}>{month.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
      <Btn kind="ghost" onClick={()=>setMonth(new Date(y,m+1,1))}>→</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:5}}>
      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{...CAPT,fontSize:10,fontWeight:600,color:C.taupe,textAlign:"center",padding:"3px 0"}}>{d}</div>)}
      {cells.map((d,i)=>{
        if(!d)return<div key={"e"+i}/>;
        const key=iso(d);const list=byDay[key]||[];const isT=key===tdy;const over=key<tdy&&list.some(t=>t.status!=="Done");
        return(<div key={key} style={{background:C.card,border:isT?`2px solid ${co?.accentColor||C.gold}`:`1px solid ${C.line}`,borderRadius:7,minHeight:80,padding:4}}>
          <div style={{fontSize:12,fontWeight:700,color:over?C.rust:isT?C.goldDark:C.taupe,marginBottom:2}}>{d}</div>
          {list.slice(0,3).map(t=>{const mt=STATUS_META[t.status];return<div key={t.id} onClick={()=>onOpen(t.id)} title={t.description} style={{background:mt.bg,color:mt.fg,fontSize:10,fontWeight:600,borderRadius:4,padding:"2px 4px",marginBottom:2,cursor:"pointer",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.area}: {t.description}</div>;})}
          {list.length>3&&<div style={{fontSize:10,color:C.taupe}}>+{list.length-3}</div>}
        </div>);
      })}
    </div>
  </div>);
}

function QRModal({project,onClose}){
  const co=useCompany();
  const baseUrl=(()=>{try{return window.location.href.split("?")[0];}catch{return "";}})();
  const url=`${baseUrl}?job=${project.id}`;
  const canvasRef=useRef();
  const [qrReady,setQrReady]=useState(false);
  const [emailCopied,setEmailCopied]=useState(false);
  const [posterMsg,setPosterMsg]=useState("");

  useEffect(()=>{
    if(!url) return;
    const script=document.createElement("script");
    script.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload=()=>{
      if(canvasRef.current){
        canvasRef.current.innerHTML="";
        new window.QRCode(canvasRef.current,{text:url,width:240,height:240,colorDark:"#2E2B28",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.H});
        setQrReady(true);
      }
    };
    document.head.appendChild(script);
    return()=>{try{document.head.removeChild(script);}catch{}};
  },[url]);

  const getQRDataUrl=()=>{
    try{const img=canvasRef.current?.querySelector("img");if(img)return img.src;const cv=canvasRef.current?.querySelector("canvas");if(cv)return cv.toDataURL("image/png");}catch{}return null;
  };
  const copy=()=>{try{navigator.clipboard.writeText(url);window.alert("Link copied!");}catch{window.alert(url);}};
  const emailLink=async()=>{
    const subject=`Punch list — ${project.name}`;
    const body=[`Hi,`,``,`Here is the punch list link for ${project.name}:`,url,``,`Open the link to view your current punch list items and status.`,``,`Thank you,`,co.name].join("\n");
    try{await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);setEmailCopied(true);setTimeout(()=>setEmailCopied(false),3000);}
    catch{window.prompt("Copy this email text:",`Subject: ${subject}\n\n${body}`);}
  };
  const printQR=()=>{
    const qrDataUrl=getQRDataUrl()||"";
    const jobInfo=[project.client,project.address].filter(Boolean).join(" · ");
    const coAddr=[co.address,co.city,co.state,co.zip].filter(Boolean).join(", ");
    const coContact=[co.phone,co.website].filter(Boolean).join(" · ");
    const accent=co.accentColor||"#BBA270";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR — ${esc(project.name)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Raleway,sans-serif;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}.page{width:100%;max-width:480px;border:2px solid #E8E5E0;border-radius:16px;padding:32px;text-align:center}.co-name{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#1C1A18;margin-bottom:8px}.job-name{font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:600;color:#1C1A18;margin:16px 0 5px}.qr-wrap{display:inline-block;padding:14px;background:#fff;border:1px solid #E8E5E0;border-radius:12px;margin:16px 0}.qr-img{display:block;width:240px;height:240px}.footer{font-size:11px;color:#B5B0A8;margin-top:8px}.url{font-size:9px;color:#B5B0A8;word-break:break-all;margin-top:14px;padding-top:12px;border-top:1px solid #E8E5E0}@media print{body{padding:16px}}</style></head><body>
<div class="page">
  ${co.logoUrl?`<img src="${co.logoUrl}" style="max-height:60px;max-width:200px;object-fit:contain;margin-bottom:8px" alt="${esc(co.name)}"><br>`:""}
  <div class="co-name">${esc(co.name)}</div>
  <div class="job-name">${esc(project.name)}</div>
  ${jobInfo?`<div style="font-size:13px;color:#8A8279;margin-bottom:6px">${esc(jobInfo)}</div>`:""}
  <div class="qr-wrap">${qrDataUrl?`<img src="${qrDataUrl}" class="qr-img" alt="QR Code">`:`<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999">QR not available</div>`}</div>
  <div style="font-size:13px;color:#8A8279;margin-bottom:12px">Scan to view punch list for this job.</div>
  ${coAddr?`<div class="footer">${esc(co.name)} · ${esc(coAddr)}</div>`:""}
  ${coContact?`<div class="footer">${esc(coContact)}</div>`:""}
  <div class="url">${esc(url)}</div>
</div>
</body></html>`;
    printHTML(html);
    setPosterMsg("Print dialog opening — choose 'Save as PDF'.");
    setTimeout(()=>setPosterMsg(""),5000);
  };

  return(<Modal onClose={onClose} wide><div style={{padding:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
      <div>
        <h2 style={{...DISP,fontSize:26,margin:"0 0 3px"}}>{project.name}</h2>
        <div style={{fontSize:13,color:C.taupe}}>{[project.client,project.address].filter(Boolean).join(" · ")}</div>
      </div>
      <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:20,alignItems:"start"}}>
      <div style={{textAlign:"center"}}>
        <div style={{padding:10,background:"#fff",borderRadius:12,border:`1px solid ${C.line}`,minWidth:260,minHeight:260,display:"flex",alignItems:"center",justifyContent:"center"}}><div ref={canvasRef}/></div>
        {!qrReady&&<div style={{fontSize:12,color:C.taupe,marginTop:8}}>Generating QR…</div>}
      </div>
      <div>
        <div style={{background:"#F8F7F5",border:`1px solid ${C.line}`,borderRadius:8,padding:"10px 13px",fontSize:11.5,fontFamily:"monospace",wordBreak:"break-all",color:C.ink,marginBottom:14,lineHeight:1.6}}>{url}</div>
        <div style={{display:"grid",gap:8}}>
          <Btn onClick={copy} style={{width:"100%"}}>📋 Copy link</Btn>
          <Btn kind="ghost" onClick={emailLink} style={{width:"100%"}}>{emailCopied?"✓ Email text copied — paste into mail app":"✉ Copy email text"}</Btn>
          <Btn kind="ghost" onClick={printQR} style={{width:"100%"}}>🖨 Print QR poster as PDF</Btn>
          {posterMsg&&<div style={{fontSize:12.5,color:C.sage,fontWeight:600,padding:"6px 10px",background:"#EAF2E8",borderRadius:7}}>{posterMsg}</div>}
        </div>
        <p style={{fontSize:12.5,color:C.taupe,marginTop:14,lineHeight:1.6}}>Anyone with this link sees a read-only punch list for <b>{project.name}</b> only.</p>
      </div>
    </div>
  </div></Modal>);
}

function EmailModal({tasks,emailMap,pendingNotif,onClearNotif,onClose}){
  const co=useCompany();
  const [mode,setMode]=useState("status");
  const tdy=today(); const soon=(()=>{const d=new Date();d.setDate(d.getDate()+3);return d.toISOString().slice(0,10);})();
  const relevant=tasks.filter(t=>mode==="all"?t.status!=="Approved":mode==="overdue"?t.status!=="Approved"&&t.dueDate&&t.dueDate<=soon:Object.entries(pendingNotif).some(([tr,ids])=>tr===t.trade&&ids.includes(t.id)));
  const byTrade={}; for(const t of relevant)(byTrade[t.trade]=byTrade[t.trade]||[]).push(t);
  const names=mode==="status"?Object.keys(pendingNotif).filter(tr=>pendingNotif[tr]?.length):Object.keys(byTrade).sort();
  const bodyFor=(trade,list)=>{
    const lines=[`Hi ${trade} team,`,"",mode==="status"?"Status update on your punch list items:":mode==="overdue"?"Items overdue or due within 3 days:":"Your current open punch list items:",""];
    const bj={}; for(const t of list)(bj[t.project]=bj[t.project]||[]).push(t);
    for(const [job,items] of Object.entries(bj)){lines.push(job.toUpperCase());for(const t of items){lines.push(`  • ${t.area}: ${t.description}`);lines.push(`    Status: ${t.status} | Due: ${fmtDate(t.dueDate)}${t.dueDate&&t.dueDate<tdy?" (PAST DUE)":""}`);}lines.push("");}
    lines.push("Thank you,",co.name); return lines.join("\n");
  };
  const openMail=(trade,list)=>{
    const to=emailMap[trade]||"";
    const subj={status:"Punch list status update",all:"Open punch list items",overdue:"Punch list reminder"};
    const subject=co.name+" — "+subj[mode];
    const body=bodyFor(trade,list).slice(0,1800);
    const href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a=document.createElement("a");a.href=href;a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
    try{navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`);}catch{}
    if(mode==="status")onClearNotif(trade);
  };
  const pending=Object.values(pendingNotif).flat().length;
  return(<Modal onClose={onClose} wide><div style={{padding:18}}>
    <h2 style={{...DISP,fontSize:26,margin:"0 0 6px"}}>Email Trades</h2>
    <p style={{color:C.taupe,fontSize:13.5,marginTop:0}}>Opens in your mail app fully written. Review and send.</p>
    <div style={{display:"flex",gap:0,border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden",width:"fit-content",marginBottom:14}}>
      {[["status",`Status updates${pending>0?` (${pending})`:""}`],["all","All open"],["overdue","Due soon"]].map(([v,l])=>(
        <button key={v} onClick={()=>setMode(v)} style={{background:mode===v?C.ink:"#fff",color:mode===v?"#fff":C.ink,padding:"10px 14px",borderRadius:0,fontSize:13.5,border:"none"}}>{l}</button>
      ))}
    </div>
    {names.length===0&&<div style={{padding:28,textAlign:"center",color:C.taupe,background:"#fff",borderRadius:10,border:`1px dashed ${C.line}`}}>{mode==="status"?"No pending status changes to send.":"Nothing to send."}</div>}
    {names.map(trade=>{const list=mode==="status"?tasks.filter(t=>t.trade===trade&&pendingNotif[trade]?.includes(t.id)):byTrade[trade]||[];const rej=list.filter(t=>t.approval==="Rejected").length;const od=list.filter(t=>t.dueDate&&t.dueDate<tdy).length;
      return(<div key={trade} style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:10,padding:"11px 14px",marginBottom:9,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 180px",minWidth:0}}><div style={{fontWeight:700}}>{trade}</div>
        <div style={{fontSize:13,color:C.taupe}}>{list.length} item{list.length!==1?"s":""}{rej>0&&<span style={{color:C.rust,fontWeight:700}}> · {rej} rejected</span>}{od>0&&<span style={{color:C.rust,fontWeight:700}}> · {od} past due</span>}{" · "}{emailMap[trade]||<span style={{color:C.rust}}>no email</span>}</div></div>
        <Btn onClick={()=>openMail(trade,list)}>✉ Email</Btn>
        <Btn kind="ghost" onClick={async()=>{try{await navigator.clipboard.writeText(bodyFor(trade,list));window.alert("Copied.");}catch{window.alert("Use Email button.");}if(mode==="status")onClearNotif(trade);}}>Copy</Btn>
      </div>);
    })}
    <div style={{display:"flex",justifyContent:"flex-end",marginTop:6}}><Btn kind="ghost" onClick={onClose}>Done</Btn></div>
  </div></Modal>);
}

function EmailAllModal({job,tasks,emailMap,loadPhoto,onClose}){
  const co=useCompany();
  const [step,setStep]=useState("ready"); // ready | pdf | email | done
  const tdy=today();

  const jobUrl=(()=>{try{return window.location.href.split("?")[0]+"?job="+job.id;}catch{return "";}})();

  const byTrade={};
  for(const t of tasks)(byTrade[t.trade]=byTrade[t.trade]||[]).push(t);
  const trades=Object.keys(byTrade).sort();
  const tradesWithEmail=trades.filter(t=>emailMap[t]);
  const tradesNoEmail=trades.filter(t=>!emailMap[t]);

  // Clean short email body — just the prompt + link
  const buildBody=()=>[
    `Hi,`,``,
    `Please find the attached punch list for ${job.name}.`,``,
    `You can also view and print your current items online at any time:`,
    jobUrl,``,
    `If you have any questions, don't hesitate to reach out.`,``,
    `Thank you,`,
    co.name,
    co.phone||"",
    co.email||"",
  ].filter(l=>l!==undefined).join("\n");

  // Generate PDF then open email
  const handleSendAll=async()=>{
    setStep("pdf");
    // Build report HTML for the punch list
    const pm={};
    for(const t of tasks){const pid=t.photos?.[0];if(pid&&!pm[pid])try{pm[pid]=await loadPhoto(pid);}catch{}}
    const accent=co.accentColor||"#BBA270";
    const logoHtml=co.logoUrl?`<img src="${co.logoUrl}" style="height:40px;max-width:160px;object-fit:contain;display:block;margin-bottom:6px" alt="">`:`<div style="font-family:Georgia,serif;font-size:22px;font-style:italic;color:#7B756E">${esc(co.name||"")}</div>`;
    const sm=s=>{const m=STATUS_META[s]||STATUS_META.Reported;return`background:${m.bg};color:${m.fg};padding:2px 8px;border-radius:5px;font-weight:700;font-size:10px;text-transform:uppercase`;};
    // Group by area
    const byArea={};for(const t of tasks)(byArea[t.area]=byArea[t.area]||[]).push(t);
    let body="";
    for(const [area,list] of Object.entries(byArea)){
      body+=`<h3>${esc(area)}</h3><table><thead><tr><th>Photo</th><th>Task</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead><tbody>`;
      for(const t of list){
        const img=t.photos?.[0]&&pm[t.photos[0]]?`<img src="${pm[t.photos[0]]}" style="width:48px;height:48px;object-fit:cover;border-radius:5px">`:"—";
        const od=t.dueDate&&t.dueDate<tdy;
        body+=`<tr><td>${img}</td><td>${esc(t.description)}</td><td>${esc(t.trade)}</td><td style="color:${PRI_FG[t.priority]||"#888"};font-weight:600">${t.priority}</td><td style="${od?"color:#B04035;font-weight:700":""}">${fmtDate(t.dueDate)}${od?" ⚠":""}</td><td><span style="${sm(t.status)}">${t.status}</span></td></tr>`;
      }
      body+=`</tbody></table>`;
    }
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Punch List — ${esc(job.name)}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Raleway:wght@400;600;700&display=swap');
body{font-family:Raleway,sans-serif;color:#2E2B28;max-width:860px;margin:0 auto;padding:28px 24px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2E2B28;padding-bottom:12px;margin-bottom:20px}
h1{font-size:26px;font-weight:700;margin:4px 0 2px}h3{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#7B756E;margin:16px 0 4px;border-bottom:1px solid #E8E5E0;padding-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#7B756E;border-bottom:1px solid #B2A98B;padding:4px 6px;font-size:10px;text-transform:uppercase}
td{border-bottom:1px solid #E8E4DE;padding:5px 6px;vertical-align:top}.meta{text-align:right;font-size:12px;color:#555}
.foot{margin-top:32px;font-size:11px;color:#9A9590;border-top:1px solid #E8E5E0;padding-top:8px}
@media print{body{padding:0}}</style></head><body>
<div class="hdr"><div>${logoHtml}<h1>${esc(job.name)}</h1><div style="font-size:12px;color:#8A8279">${[job.client,job.address].filter(Boolean).join(" · ")||""}</div></div>
<div class="meta"><div>Punch List</div><div>${fmtDate(today())}</div><div style="margin-top:4px;font-weight:700">${tasks.length} open item${tasks.length!==1?"s":""}</div></div></div>
${body}
<div class="foot">${esc(co.name)}${co.phone?" · "+esc(co.phone):""}${co.email?" · "+esc(co.email):""}</div>
</body></html>`;
    printHTML(html);
    // After a moment, open the email
    setTimeout(()=>{
      const bcc=tradesWithEmail.map(t=>emailMap[t]).join(",");
      const subject=`${co.name} — Punch list: ${job.name}`;
      const body2=buildBody().slice(0,1900);
      const to=co.email||"";
      const href=`mailto:${encodeURIComponent(to)}?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body2)}`;
      const a=document.createElement("a");a.href=href;a.target="_blank";a.rel="noopener";
      document.body.appendChild(a);a.click();a.remove();
      setStep("done");
    },1200);
  };

  const openOne=(trade)=>{
    const to=emailMap[trade]||"";
    const subject=`${co.name} — Punch list: ${job.name}`;
    const body=[`Hi ${trade} team,`,``,`Please find the attached punch list for ${job.name}.`,``,`You can also view and print your current items online:`,jobUrl,``,`Thank you,`,co.name].join("\n").slice(0,1900);
    const href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a=document.createElement("a");a.href=href;a.target="_blank";a.rel="noopener";
    document.body.appendChild(a);a.click();a.remove();
  };

  return(<Modal onClose={onClose} wide><div style={{padding:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
      <div>
        <h2 style={{...DISP,fontSize:26,margin:"0 0 3px"}}>Email All Trades</h2>
        <div style={{fontSize:13,color:C.taupe}}>{job.name}</div>
      </div>
      <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
    </div>

    {tradesWithEmail.length>0?(
      <div style={{background:step==="done"?"#EAF2E8":C.mist,border:`1.5px solid ${step==="done"?C.sage:C.line}`,borderRadius:12,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:15,color:step==="done"?C.sage:C.ink,marginBottom:6}}>
          {step==="done"?"✓ PDF opened + email ready to send"
           :step==="pdf"||step==="email"?"Opening PDF, then email…"
           :"Send punch list to all trades"}
        </div>
        <div style={{fontSize:13,color:C.taupe,marginBottom:16,lineHeight:1.7}}>
          <b>Step 1</b> — Print dialog opens so you can save the PDF.<br/>
          <b>Step 2</b> — Your mail app opens pre-addressed. Attach the PDF and hit send.<br/>
          You're in the To field. All {tradesWithEmail.length} trade{tradesWithEmail.length!==1?"s":""} are BCC'd.
          {!co.email&&<span style={{color:C.amber,display:"block",marginTop:6}}>⚠ Add your email in ⚙ Settings to be included in the To field.</span>}
        </div>
        {step==="ready"&&(
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <Btn onClick={handleSendAll} style={{fontSize:15,padding:"12px 24px"}}>🖨 Generate PDF + Open Email</Btn>
            <div style={{fontSize:12,color:C.taupe}}>
              To: {co.email||"(your email)"}<br/>
              BCC: {tradesWithEmail.map(t=>emailMap[t]).join(", ").slice(0,70)}{tradesWithEmail.map(t=>emailMap[t]).join(", ").length>70?"…":""}
            </div>
          </div>
        )}
        {(step==="pdf"||step==="email")&&(
          <div style={{fontSize:13,color:C.taupe,fontStyle:"italic"}}>Working… save the PDF, then attach it to the email that opens.</div>
        )}
        {step==="done"&&(
          <div style={{fontSize:13,color:C.sage,fontWeight:600}}>Attach the PDF to the email draft in your mail app, then hit send.</div>
        )}
      </div>
    ):(
      <div style={{padding:24,textAlign:"center",color:C.taupe,background:C.mist,borderRadius:12,marginBottom:16}}>
        No trades have email addresses on file. Add them in Trade Directory.
      </div>
    )}

    {trades.length>0&&(<>
      <div style={{...CAPT,fontSize:10,fontWeight:700,color:C.taupe,marginBottom:8}}>Or email individually</div>
      <div style={{display:"grid",gap:7}}>
        {trades.map(trade=>{
          const list=byTrade[trade]||[];
          const email=emailMap[trade];
          const overdue=list.filter(t=>t.dueDate&&t.dueDate<tdy).length;
          return(
            <div key={trade} style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:9,padding:"10px 13px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",opacity:!email?0.55:1}}>
              <div style={{flex:"1 1 160px",minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{trade}</div>
                <div style={{fontSize:12,color:C.taupe,marginTop:1}}>
                  {list.length} item{list.length!==1?"s":""}
                  {overdue>0&&<span style={{color:C.rust,fontWeight:700}}> · {overdue} overdue</span>}
                  {" · "}{email||<span style={{color:C.rust}}>no email on file</span>}
                </div>
              </div>
              {email&&<Btn kind="ghost" onClick={()=>openOne(trade)} style={{fontSize:12,padding:"7px 12px"}}>✉ Email</Btn>}
            </div>
          );
        })}
      </div>
    </>)}

    {tradesNoEmail.length>0&&(
      <div style={{marginTop:12,fontSize:13,color:C.taupe,padding:"10px 14px",background:C.mist,borderRadius:8}}>
        <b>{tradesNoEmail.length} trade{tradesNoEmail.length!==1?"s":""}</b> missing email: {tradesNoEmail.join(", ")}. Add in Trade Directory.
      </div>
    )}

    {trades.length===0&&(
      <div style={{padding:32,textAlign:"center",color:C.taupe,background:"#fff",borderRadius:10,border:`1px dashed ${C.line}`}}>
        No open items on this job — nothing to send.
      </div>
    )}

    <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
      <Btn kind="ghost" onClick={onClose}>Done</Btn>
    </div>
  </div></Modal>);
}

function DirectoryModal({companies,teamCode,onSaveTC,onUpsert,onDelete,onImport,onWipe,onClose}){  const [editing,setEditing]=useState(null); const [tc,setTc]=useState(teamCode||""); const [flash,setFlash]=useState(false);
  const sorted=[...companies].sort((a,b)=>a.name.localeCompare(b.name));
  return(<Modal onClose={onClose} xwide><div style={{padding:18}}>
    <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10,flexWrap:"wrap"}}>
      <h2 style={{...DISP,fontSize:28,fontWeight:600,margin:0,flex:1}}>Trade Directory</h2>
      <Btn kind="ghost" onClick={onImport} style={{fontSize:13}}>⬆ Import spreadsheet</Btn>
      <Btn onClick={()=>setEditing("new")}>+ Add company</Btn>
      <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
    </div>
    <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:12,padding:13,marginBottom:12,display:"flex",gap:9,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div style={{flex:"1 1 240px"}}><Lbl>Team access code</Lbl><input value={tc} onChange={e=>setTc(e.target.value)} placeholder="Leave blank for open access"/></div>
      <Btn kind="dark" onClick={()=>{onSaveTC(tc);setFlash(true);setTimeout(()=>setFlash(false),1500);}}>{flash?"✓ Saved":"Save"}</Btn>
    </div>
    {sorted.length===0&&<div style={{padding:28,textAlign:"center",color:C.taupe,background:C.card,borderRadius:12,border:`1px dashed ${C.line}`}}>No companies yet.</div>}
    <div style={{display:"grid",gap:8}}>
      {sorted.map(co=>(<div key={co.id} style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:10,padding:"10px 13px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:"2 1 150px",minWidth:0}}><div style={{fontWeight:700}}>{co.name}</div><div style={{...CAPT,fontSize:10,color:C.taupe}}>{co.tradeType||"—"}</div></div>
        <div style={{flex:"2 1 180px",fontSize:13,color:C.taupe}}><div>{co.contactName||"—"}</div><div>{co.email||<span style={{color:C.rust}}>no email</span>}{co.phone?" · "+co.phone:""}</div></div>
        <div style={{display:"flex",gap:7}}><Btn kind="ghost" onClick={()=>setEditing(co)} style={{padding:"8px 12px",fontSize:13}}>Edit</Btn><Btn kind="ghost" style={{color:C.rust,padding:"8px 12px",fontSize:13}} onClick={()=>window.confirm(`Remove ${co.name}?`)&&onDelete(co.id)}>Remove</Btn></div>
      </div>))}
    </div>
    {editing&&<CompanyForm company={editing==="new"?null:editing} existingNames={companies.filter(c=>editing==="new"||c.id!==editing.id).map(c=>c.name.trim().toLowerCase())} onCancel={()=>setEditing(null)} onSave={async co=>{await onUpsert(co);setEditing(null);}}/>}
    <div style={{marginTop:20,padding:13,border:`1px solid ${C.rust}`,borderRadius:12,background:"#FBF3F1"}}>
      <div style={{...CAPT,fontSize:11,fontWeight:700,color:C.rust,marginBottom:5}}>Danger zone</div>
      <div style={{fontSize:13.5,color:C.taupe,marginBottom:10}}>Permanently erases every job, task, photo, and contact. Cannot be undone.</div>
      <Btn kind="red" onClick={async()=>{if(!window.confirm("Erase ALL data for everyone?"))return;if(!window.confirm("Final confirmation."))return;await onWipe();}}>Erase all data</Btn>
    </div>
  </div></Modal>);
}

function CompanyForm({company,existingNames,onCancel,onSave}){
  const [f,setF]=useState(company||{id:uid(),name:"",tradeType:"",contactName:"",email:"",phone:"",createdAt:Date.now()});
  const [err,setErr]=useState(""); const set=k=>e=>setF({...f,[k]:e.target.value});
  const save=()=>{if(!f.name.trim())return setErr("Name required.");if(existingNames.includes(f.name.trim().toLowerCase()))return setErr("Already exists.");onSave({...f,name:f.name.trim(),email:f.email.trim(),phone:f.phone.trim(),tradeType:f.tradeType.trim(),contactName:f.contactName.trim()});};
  return(<Modal onClose={onCancel}><div style={{padding:18}}>
    <h2 style={{...DISP,fontSize:24,margin:"0 0 13px"}}>{company?"Edit":"Add"} Company</h2>
    <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr"}}>
      <div style={{gridColumn:"1/-1"}}><Lbl>Company name</Lbl><input value={f.name} onChange={set("name")}/></div>
      <div><Lbl>Trade type</Lbl><input value={f.tradeType} onChange={set("tradeType")} placeholder="e.g. Tile, Paint"/></div>
      <div><Lbl>Contact name</Lbl><input value={f.contactName} onChange={set("contactName")}/></div>
      <div><Lbl>Email</Lbl><input type="email" value={f.email} onChange={set("email")}/></div>
      <div><Lbl>Phone</Lbl><input type="tel" value={f.phone} onChange={set("phone")}/></div>
    </div>
    {err&&<div style={{background:"#F2DEDA",color:C.rust,borderRadius:8,padding:"9px 11px",fontSize:13,fontWeight:600,marginTop:11}}>{err}</div>}
    <div style={{display:"flex",gap:9,marginTop:14,justifyContent:"flex-end"}}><Btn kind="ghost" onClick={onCancel}>Cancel</Btn><Btn onClick={save}>Save</Btn></div>
  </div></Modal>);
}

function ImportModal({companies,onImport,onClose}){
  const [rows,setRows]=useState(null); const [mapping,setMapping]=useState({}); const [status,setStatus]=useState(""); const [error,setError]=useState(""); const fileRef=useRef();
  const FIELDS=["name","tradeType","contactName","email","phone"];
  const FLABELS={name:"Company name *",tradeType:"Trade type",contactName:"Contact name",email:"Email",phone:"Phone"};
  const parseCSV=text=>{const lines=text.split(/\r?\n/).filter(l=>l.trim());return lines.map(line=>{const cells=[];let cur="",inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===","&&!inQ){cells.push(cur.trim());cur="";}else cur+=ch;}cells.push(cur.trim());return cells;});};
  const handleFile=async e=>{const file=e.target.files[0];e.target.value="";if(!file)return;setError("");setRows(null);setMapping({});
    try{let text="";
      if(file.name.endsWith(".csv")){text=await file.text();}
      else{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs");const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];text=XLSX.utils.sheet_to_csv(ws);}
      const parsed=parseCSV(text);if(parsed.length<2){setError("File appears empty.");return;}
      setRows(parsed);
      const hdr=parsed[0].map(h=>h.toLowerCase().replace(/[^a-z]/g,""));
      const AUTO={name:["name","company","companyname","trade","tradename"],tradeType:["tradetype","type","specialty"],contactName:["contact","contactname","firstname","fullname"],email:["email","emailaddress","mail"],phone:["phone","phonenumber","mobile","cell"]};
      const am={};FIELDS.forEach(field=>{const idx=hdr.findIndex(h=>AUTO[field].some(k=>h.includes(k)));if(idx>=0)am[idx]=field;});
      setMapping(am); setStatus(`Found ${parsed.length-1} row${parsed.length!==2?"s":""}.`);
    }catch{setError("Could not read file. Try saving as CSV.");}
  };
  const colCount=rows?.[0]?.length||0;
  const doImport=()=>{if(!rows||rows.length<2){setError("No data loaded.");return;}const nameCol=Object.entries(mapping).find(([,v])=>v==="name")?.[0];if(nameCol===undefined){setError("Map the Company name column first.");return;}
    const have=new Set(companies.map(c=>c.name.trim().toLowerCase())); const newCos=[];let skip=0;
    for(let i=1;i<rows.length;i++){const row=rows[i];if(!row||row.every(c=>!c.trim()))continue;const name=(row[Number(nameCol)]||"").trim();if(!name){skip++;continue;}if(have.has(name.toLowerCase())){skip++;continue;}
      const co={id:uid(),name,createdAt:Date.now(),tradeType:"",contactName:"",email:"",phone:""};for(const [ci,field] of Object.entries(mapping)){if(field!=="name")co[field]=(row[Number(ci)]||"").trim();}newCos.push(co);}
    if(!newCos.length){setError(`No new companies to add.${skip>0?` ${skip} row(s) skipped.`:""}`);return;}
    setStatus(`Importing ${newCos.length} company${newCos.length!==1?"s":""}…`); onImport(newCos);};
  return(<Modal onClose={onClose} xwide><div style={{padding:18}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
      <h2 style={{...DISP,fontSize:26,margin:0,flex:1}}>Import from Spreadsheet</h2>
      <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
    </div>
    <div style={{background:C.mist,borderRadius:10,padding:13,marginBottom:14,fontSize:13.5}}>Accepted: <b>CSV (.csv)</b> or <b>Excel (.xlsx/.xls)</b>. One company per row with headers.</div>
    <div style={{display:"flex",gap:9,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <Btn onClick={()=>fileRef.current.click()}>📂 Choose file</Btn>
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{display:"none"}}/>
      <Btn kind="ghost" onClick={()=>{const csv="Company Name,Trade Type,Contact Name,Email,Phone\nOzark Tile & Stone,Tile,Mike Smith,mike@ozarktile.com,(417) 555-0101";const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="trades-template.csv";document.body.appendChild(a);a.click();a.remove();}}>⬇ Template</Btn>
      {status&&<span style={{fontSize:13,color:C.sage,fontWeight:600}}>{status}</span>}
    </div>
    {error&&<div style={{background:"#F2DEDA",color:C.rust,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600,marginBottom:12}}>{error}</div>}
    {rows&&(<>
      <h3 style={{...DISP,fontSize:18,margin:"0 0 6px"}}>Map columns</h3>
      <div style={{overflowX:"auto",marginBottom:14}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:13}}>
          <thead><tr>{Array.from({length:colCount},(_,ci)=>(<th key={ci} style={{padding:"6px 8px",borderBottom:`2px solid ${C.line}`,textAlign:"left",minWidth:110}}>
            <div style={{...CAPT,fontSize:9.5,color:C.taupe,marginBottom:4}}>Col {ci+1}</div>
            <select value={Object.entries(mapping).find(([k,])=>Number(k)===ci)?.[1]||""}
              onChange={e=>{const val=e.target.value;setMapping(prev=>{const n={...prev};Object.keys(n).forEach(k=>{if(n[k]===val)delete n[k];});if(val)n[ci]=val;else delete n[ci];return n;})}}
              style={{width:"100%",fontSize:12}}>
              <option value="">— skip —</option>{FIELDS.map(f=><option key={f} value={f}>{FLABELS[f]}</option>)}
            </select>
          </th>))}</tr></thead>
          <tbody>{rows.slice(0,5).map((row,ri)=>(<tr key={ri} style={{background:ri===0?C.mist:ri%2===0?"#fafaf8":"#fff"}}>
            {Array.from({length:colCount},(_,ci)=>(<td key={ci} style={{padding:"5px 8px",borderBottom:`1px solid ${C.line}`,color:ri===0?C.taupe:C.ink,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{rows[ri][ci]||""}</td>))}
          </tr>))}{rows.length>5&&<tr><td colSpan={colCount} style={{padding:"5px 8px",color:C.taupe,fontSize:12,fontStyle:"italic"}}>…{rows.length-5} more rows</td></tr>}</tbody>
        </table>
      </div>
      <div style={{display:"flex",gap:9,justifyContent:"flex-end"}}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="green" onClick={doImport}>Import companies</Btn></div>
    </>)}
  </div></Modal>);
}

function ReportFooterLine(){
  const co=useCompany();
  const addr=[co.address,co.city,co.state,co.zip].filter(Boolean).join(", ");
  const contact=[co.phone,co.email,co.website].filter(Boolean).join(" · ");
  return(
    <div>
      {co.name}{addr?" · "+addr:""}
      {contact&&<span> · {contact}</span>}
      {co.tagline&&<div style={{...DISP,fontStyle:"italic",color:co.accentColor||C.gold,fontSize:14,marginTop:2}}>"{co.tagline}"</div>}
    </div>
  );
}

function JobLinkFooter(){
  const co=useCompany();
  const addr=[co.city,co.state].filter(Boolean).join(", ");
  return(
    <span>{co.name}{addr?" · "+addr:""} · <i style={{fontFamily:"'Cormorant Garamond',Georgia,serif",color:co.accentColor||C.gold}}>"{co.tagline||""}"</i></span>
  );
}

function CompanySettings({settings,onSave,onClose}){
  const [f,setF]=useState({...settings});
  const set=k=>e=>setF({...f,[k]:e.target.value});
  const logoRef=useRef();
  const [logoPreview,setLogoPreview]=useState(settings.logoUrl||"");
  const [saving,setSaving]=useState(false);
  const handleLogo=e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const MAX=400; const sc=Math.min(1,MAX/Math.max(img.width,img.height));
        const cv=document.createElement("canvas"); cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
        cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
        const out=cv.toDataURL("image/png",0.9);
        setLogoPreview(out); setF(prev=>({...prev,logoUrl:out}));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  };
  const save=async()=>{setSaving(true);await onSave(f);setSaving(false);};
  const ACCENT_PRESETS=["#BBA270","#C0864A","#7B9E6B","#5C7A9E","#9E5C6A","#6B5C9E","#2E2B28","#8B7355"];
  return(
    <Modal onClose={onClose} wide><div style={{padding:20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <h2 style={{...DISP,fontSize:26,margin:0,flex:1}}>Company Settings</h2>
        <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
      </div>
      <div style={{background:C.mist,borderRadius:12,padding:14,marginBottom:16}}>
        <div style={{...CAPT,fontSize:11,fontWeight:700,color:C.taupe,marginBottom:10}}>Logo</div>
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{width:140,height:70,background:"#fff",borderRadius:8,border:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"center",padding:8,overflow:"hidden"}}>
            {logoPreview?<img src={logoPreview} alt="logo" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>:<span style={{fontSize:12,color:C.stone}}>No logo</span>}
          </div>
          <div>
            <Btn kind="ghost" onClick={()=>logoRef.current.click()} style={{fontSize:13,marginBottom:7}}>📁 Upload logo</Btn>
            <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} style={{display:"none"}}/>
            <br/>{logoPreview&&<button onClick={()=>{setLogoPreview("");setF(p=>({...p,logoUrl:""}));}} style={{fontSize:12,color:C.rust,background:"transparent",border:"none",cursor:"pointer",padding:0}}>Remove logo</button>}
          </div>
        </div>
      </div>
      <div style={{display:"grid",gap:11,gridTemplateColumns:"1fr 1fr",marginBottom:14}}>
        <div style={{gridColumn:"1/-1"}}><Lbl>Company name</Lbl><input value={f.name} onChange={set("name")} placeholder="Your company name"/></div>
        <div style={{gridColumn:"1/-1"}}><Lbl>Tagline</Lbl><input value={f.tagline} onChange={set("tagline")} placeholder="e.g. Building an Elevated Experience"/></div>
        <div style={{gridColumn:"1/-1"}}><Lbl>Address</Lbl><input value={f.address} onChange={set("address")}/></div>
        <div><Lbl>City</Lbl><input value={f.city} onChange={set("city")}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><Lbl>State</Lbl><input value={f.state} onChange={set("state")} placeholder="MO"/></div>
          <div><Lbl>ZIP</Lbl><input value={f.zip} onChange={set("zip")}/></div>
        </div>
        <div><Lbl>Phone</Lbl><input type="tel" value={f.phone} onChange={set("phone")}/></div>
        <div><Lbl>Email</Lbl><input type="email" value={f.email} onChange={set("email")}/></div>
        <div><Lbl>Website</Lbl><input value={f.website} onChange={set("website")}/></div>
        <div><Lbl>License #</Lbl><input value={f.license} onChange={set("license")}/></div>
      </div>
      <div style={{background:C.mist,borderRadius:12,padding:14,marginBottom:16}}>
        <div style={{...CAPT,fontSize:11,fontWeight:700,color:C.taupe,marginBottom:10}}>Accent color</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {ACCENT_PRESETS.map(c=>(
            <button key={c} onClick={()=>setF(p=>({...p,accentColor:c}))} style={{width:36,height:36,borderRadius:"50%",background:c,border:f.accentColor===c?"3px solid "+C.ink:"3px solid transparent",boxShadow:"0 0 0 1px rgba(0,0,0,0.15)",cursor:"pointer"}}/>
          ))}
          <input type="color" value={f.accentColor||"#BBA270"} onChange={set("accentColor")} style={{width:36,height:36,padding:2,borderRadius:6,border:`1px solid ${C.line}`,cursor:"pointer"}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:9,justifyContent:"flex-end"}}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={saving} style={{opacity:saving?0.6:1}} onClick={save}>{saving?"Saving…":"Save settings"}</Btn>
      </div>
    </div></Modal>
  );
}

function BatchModal({tasks,trades,onApply,onClose}){
  const [selectedTrade,setSelectedTrade]=useState(""); const [newStatus,setNewStatus]=useState("Scheduled");
  const [selected,setSelected]=useState(new Set()); const [filterStatus,setFilterStatus]=useState("All");
  const tradeTasks=tasks.filter(t=>(!selectedTrade||t.trade===selectedTrade)&&(filterStatus==="All"||t.status===filterStatus)).sort((a,b)=>(a.project+a.area+a.description).localeCompare(b.project+b.area+b.description));
  const allIds=new Set(tradeTasks.map(t=>t.id));
  const allChecked=tradeTasks.length>0&&tradeTasks.every(t=>selected.has(t.id));
  const someChecked=tradeTasks.some(t=>selected.has(t.id));
  const toggle=id=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAll=()=>{if(allChecked){setSelected(prev=>{const n=new Set(prev);allIds.forEach(id=>n.delete(id));return n;});}else{setSelected(prev=>{const n=new Set(prev);allIds.forEach(id=>n.add(id));return n;});}};
  const toApply=tradeTasks.filter(t=>selected.has(t.id));
  const byProject={};for(const t of tradeTasks)(byProject[t.project]=byProject[t.project]||[]).push(t);
  return(
    <Modal onClose={onClose} wide><div style={{padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div><h2 style={{...DISP,fontSize:26,margin:"0 0 4px"}}>Batch Status Update</h2><p style={{fontSize:13.5,color:C.taupe,margin:0}}>Select a trade, pick tasks, choose new status, apply.</p></div>
        <button onClick={onClose} style={{background:"transparent",border:"none",fontSize:22,color:C.taupe,cursor:"pointer"}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,marginBottom:14,padding:"14px 16px",background:C.mist,borderRadius:10}}>
        <div><label style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,display:"block",marginBottom:5}}>Trade</label><select value={selectedTrade} onChange={e=>{setSelectedTrade(e.target.value);setSelected(new Set());setFilterStatus("All");}} style={{width:"100%"}}><option value="">All trades</option>{trades.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        <div><label style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,display:"block",marginBottom:5}}>Current status</label><select value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setSelected(new Set());}} style={{width:"100%"}}><option>All</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
        <div><label style={{...CAPT,fontSize:11,fontWeight:600,color:C.taupe,display:"block",marginBottom:5}}>Change to</label><select value={newStatus} onChange={e=>setNewStatus(e.target.value)} style={{width:"auto",minWidth:150}}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
      </div>
      {tradeTasks.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${C.line}`}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontWeight:600,fontSize:14}}>
            <input type="checkbox" checked={allChecked} ref={el=>{if(el)el.indeterminate=someChecked&&!allChecked;}} onChange={toggleAll} style={{width:18,height:18,cursor:"pointer"}}/>
            {allChecked?"Deselect all":"Select all"} ({tradeTasks.length})
          </label>
          {toApply.length>0&&<div style={{flex:1,display:"flex",justifyContent:"flex-end"}}><Btn kind="primary" onClick={()=>onApply([...toApply.map(t=>t.id)],newStatus)} style={{padding:"9px 18px"}}>✓ Apply "{newStatus}" to {toApply.length} task{toApply.length!==1?"s":""}</Btn></div>}
        </div>
      )}
      {tradeTasks.length===0&&<div style={{padding:32,textAlign:"center",color:C.taupe,background:"#fff",borderRadius:10,border:`1px dashed ${C.line}`}}>{selectedTrade?`No tasks for ${selectedTrade}`:"Select a trade above."}</div>}
      <div style={{maxHeight:420,overflowY:"auto"}}>
        {Object.entries(byProject).map(([proj,list])=>(
          <div key={proj} style={{marginBottom:16}}>
            <div style={{...CAPT,fontSize:11,fontWeight:700,color:C.taupe,padding:"4px 0",borderBottom:`1px solid ${C.line}`,marginBottom:6}}>{proj}</div>
            {list.map(t=>(
              <label key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 10px",borderRadius:8,cursor:"pointer",background:selected.has(t.id)?"#F0EEF8":"transparent",border:`1px solid ${selected.has(t.id)?C.lineHvy:C.line}`,marginBottom:5}}>
                <input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggle(t.id)} style={{width:18,height:18,marginTop:1,flexShrink:0,cursor:"pointer"}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:12,fontWeight:600,color:C.taupe}}>{t.area}</span>
                    <StatusChip status={t.status}/><ApprovalChip approval={t.approval}/>
                  </div>
                  <div style={{fontSize:14,fontWeight:500,lineHeight:1.35}}>{t.description}</div>
                </div>
                {t.dueDate&&<div style={{fontSize:12,color:C.stone,flexShrink:0}}>Due {fmtDate(t.dueDate)}</div>}
              </label>
            ))}
          </div>
        ))}
      </div>
      {toApply.length>0&&(
        <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:13.5,color:C.taupe}}>Setting <b style={{color:C.ink}}>{toApply.length}</b> task{toApply.length!==1?"s":""} to <StatusChip status={newStatus} big/></div>
          <div style={{display:"flex",gap:9}}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={()=>onApply([...toApply.map(t=>t.id)],newStatus)}>Apply</Btn></div>
        </div>
      )}
    </div></Modal>
  );
}

function Report({tasks,jobLabel,filters,userName,loadPhoto,onBack,project}){
  const co=useCompany();
  const [exporting,setExporting]=useState(false);
  const groups={};for(const t of tasks){groups[t.project]=groups[t.project]||{};(groups[t.project][t.area]=groups[t.project][t.area]||[]).push(t);}
  const open=tasks.filter(t=>t.status!=="Approved").length; const done=tasks.length-open;
  const doExport=async()=>{setExporting(true);try{
    const pm={};for(const t of tasks){const pid=t.photos?.[0];if(pid&&!pm[pid])pm[pid]=await loadPhoto(pid);}
    const sm=s=>{const m=STATUS_META[s]||STATUS_META.Reported;return`background:${m.bg};color:${m.fg};padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;text-transform:uppercase`;};
    let body="";for(const [proj,areas] of Object.entries(groups)){body+=`<h2>${esc(proj)}</h2>`;for(const [area,list] of Object.entries(areas)){body+=`<h3>${esc(area)}</h3><table><thead><tr><th>Photo</th><th>Description</th><th>Trade</th><th>Priority</th><th>Due</th><th>Progress</th><th>Approval</th><th>Approved by</th></tr></thead><tbody>`;for(const t of list){const img=t.photos?.[0]&&pm[t.photos[0]]?`<img src="${pm[t.photos[0]]}" style="width:50px;height:50px;object-fit:cover;border-radius:5px">`:"—";const appr=t.approval==="Approved"?`${fmtDate(new Date(t.approvedAt).toISOString())} — ${esc(t.approvedBy)}`:"—";const am={Approved:{bg:"#E0EDDB",fg:"#5A8A4F"},Rejected:{bg:"#F2DEDA",fg:"#A83B2E"},Pending:{bg:"#F0EDE8",fg:"#9A7B4F"}}[t.approval||"Pending"]||{bg:"#F0EDE8",fg:"#9A7B4F"};body+=`<tr><td>${img}</td><td>${esc(t.description)}</td><td>${esc(t.trade)}</td><td style="color:${PRI_FG[t.priority]};font-weight:600">${t.priority}</td><td>${fmtDate(t.dueDate)}</td><td><span style="${sm(t.status)}">${t.status}</span></td><td><span style="background:${am.bg};color:${am.fg};padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px">${t.approval||"Pending"}</span></td><td>${appr}</td></tr>`;}body+=`</tbody></table>`;}}
    const logoHtml=co.logoUrl?`<img src="${co.logoUrl}" style="height:48px;max-width:200px;object-fit:contain;display:block;margin-bottom:4px" alt="">`:`<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;color:#7B756E;font-style:italic">${esc(co.name||"")}</div>`;
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Punch List — ${esc(jobLabel)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap');body{font-family:Raleway,sans-serif;color:#2E2B28;max-width:860px;margin:0 auto;padding:32px 24px}.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #2E2B28;padding-bottom:12px}h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:600;margin:6px 0 2px}h2{font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:600;border-bottom:2px solid #DDD9D3;padding-bottom:3px;margin:24px 0 5px}h3{font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#7B756E;margin:12px 0 3px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#7B756E;border-bottom:1px solid #B2A98B;padding:5px 6px;font-size:11px;text-transform:uppercase}td{border-bottom:1px solid #E8E4DE;padding:5px 6px;vertical-align:top}.meta{text-align:right;font-size:12px;color:#555}.foot{margin-top:36px;font-size:11px;color:#9A9590;border-top:1px solid #DDD9D3;padding-top:8px}@media print{body{padding:0}}</style></head><body><div class="hdr"><div>${logoHtml}<h1>Punch List Report</h1><div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:#7B756E;margin-top:3px">${esc(jobLabel)}</div>${project&&project.siteContact?`<div style="font-size:12px;color:#8A8279;margin-top:3px">Site: ${esc(project.siteContact)}${project.sitePhone?" · "+esc(project.sitePhone):""}</div>`:""}</div><div class="meta"><div>Generated ${fmtDate(today())} by ${esc(userName)}</div><div style="font-weight:700;margin-top:3px">${open} open · ${done} approved · ${tasks.length} total</div></div></div>${body}<div class="foot">${esc(co.name)}${[co.address,co.city,co.state].filter(Boolean).length>0?" · "+[co.address,co.city,co.state].filter(Boolean).map(esc).join(", "):""}${co.phone?" · "+esc(co.phone):""}<div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:${co.accentColor||"#BBA270"};font-size:13px;margin-top:2px">"${esc(co.tagline||"")}"</div></div></body></html>`;
    printHTML(html);
  }finally{setExporting(false);}};
  return(<div style={{background:"#fff",minHeight:"100vh"}}>
    <div className="no-print" style={{padding:"11px 16px",display:"flex",gap:9,borderBottom:`1px solid ${C.line}`,alignItems:"center",flexWrap:"wrap"}}>
      <Btn kind="ghost" onClick={onBack}>← Back</Btn>
      <div style={{flex:1,fontSize:13,color:C.taupe}}>Print dialog will open — choose "Save as PDF" to save.</div>
      <Btn onClick={doExport} disabled={exporting} style={{opacity:exporting?0.6:1}}>{exporting?"Preparing…":"🖨 Print / Save as PDF"}</Btn>
    </div>
    <div style={{maxWidth:860,margin:"0 auto",padding:"28px 22px",color:C.ink}}>
      <div style={{display:"flex",justifyContent:"space-between",borderBottom:`3px solid ${C.ink}`,paddingBottom:11,gap:14}}>
        <div><Wordmark size={26}/><div style={{...DISP,fontSize:30,fontWeight:600,lineHeight:1,marginTop:7}}>Punch List Report</div><div style={{...CAPT,fontSize:13,fontWeight:600,color:C.taupe,marginTop:4}}>{jobLabel}</div></div>
        <div style={{textAlign:"right",fontSize:12.5,color:"#555"}}><div>Generated {fmtDate(today())} by {userName}</div><div style={{fontWeight:700,marginTop:3,color:C.ink}}>{open} open · {done} approved · {tasks.length} total</div></div>
      </div>
      {Object.entries(groups).map(([proj,areas])=>(<div key={proj} style={{marginTop:22}}>
        <div style={{...DISP,fontSize:20,fontWeight:600,borderBottom:`2px solid ${C.line}`,paddingBottom:3}}>{proj}</div>
        {Object.entries(areas).map(([area,list])=>(<div key={area} style={{marginTop:12}}>
          <div style={{...CAPT,fontSize:11.5,fontWeight:600,color:C.taupe}}>{area}</div>
          <table style={{width:"100%",borderCollapse:"collapse",marginTop:5,fontSize:13}}>
            <thead><tr style={{textAlign:"left",color:C.taupe,borderBottom:`1px solid ${C.stone}`}}>{["Photo","Description","Trade","Priority","Due","Progress","Approval","Approved by"].map(h=><th key={h} style={{...CAPT,fontSize:10,fontWeight:600,padding:"4px 6px"}}>{h}</th>)}</tr></thead>
            <tbody>{list.map(t=>(<tr key={t.id} style={{borderBottom:"1px solid #E8E4DE",verticalAlign:"top"}}>
              <td style={{padding:"5px 6px"}}><PhotoThumb pid={t.photos?.[0]} loadPhoto={loadPhoto} size={50}/></td>
              <td style={{padding:"5px 6px"}}>{t.description}</td>
              <td style={{padding:"5px 6px"}}>{t.trade}</td>
              <td style={{padding:"5px 6px",color:PRI_FG[t.priority],fontWeight:600}}>{t.priority}</td>
              <td style={{padding:"5px 6px"}}>{fmtDate(t.dueDate)}</td>
              <td style={{padding:"5px 6px"}}><StatusChip status={t.status}/></td>
              <td style={{padding:"5px 6px"}}><ApprovalChip approval={t.approval}/></td>
              <td style={{padding:"5px 6px"}}>{t.approval==="Approved"?`${fmtDate(new Date(t.approvedAt).toISOString())} — ${t.approvedBy}`:"—"}</td>
            </tr>))}</tbody>
          </table>
        </div>))}
      </div>))}
      <div style={{marginTop:36,fontSize:12,color:"#9A9590",borderTop:`1px solid ${C.line}`,paddingTop:7}}><ReportFooterLine/></div>
    </div>
  </div>);
}
