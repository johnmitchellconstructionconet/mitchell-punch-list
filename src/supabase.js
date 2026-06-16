import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

// Wrap any promise with a timeout so queries never hang forever
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Projects ────────────────────────────────────────────────────

export async function getProjects() {
  const { data, error } = await withTimeout(
    supabase.from("projects").select("*").order("created_at", { ascending: false })
  );
  if (error) { console.error("getProjects", error); return []; }
  return data.map(dbToProject);
}

export async function upsertProject(project) {
  const { error } = await supabase
    .from("projects")
    .upsert(projectToDb(project), { onConflict: "id" });
  if (error) console.error("upsertProject", error);
}

export async function deleteProject(id) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) console.error("deleteProject", error);
}

// ─── Tasks ───────────────────────────────────────────────────────
// Initial load: fetch lightweight fields only — skip heavy JSONB columns
// that aren't needed to render the job list and task cards.
// Full task (with comments, history, photos list) loads when task is opened.

export async function getTasks() {
  const { data, error } = await withTimeout(
    supabase
      .from("tasks")
      .select("id,project,area,description,trade,trades,priority,due_date,status,approval,created_by,created_at,approved_by,approved_at,rejection_reason,my_tasks,mentions,photos")
      .order("created_at", { ascending: false })
  );
  if (error) { console.error("getTasks", error); return []; }
  return data.map(dbToTaskLight);
}

export async function getTaskFull(id) {
  const { data, error } = await withTimeout(
    supabase.from("tasks").select("*").eq("id", id).maybeSingle()
  );
  if (error) { console.error("getTaskFull", error); return null; }
  return data ? dbToTask(data) : null;
}

export async function upsertTask(task) {
  const payload = taskToDb(task);
  const { error } = await supabase
    .from("tasks")
    .upsert(payload, { onConflict: "id" });
  if (error) {
    throw new Error("Save failed: " + (error.message || JSON.stringify(error)));
  }
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) console.error("deleteTask", error);
}

// ─── Companies ───────────────────────────────────────────────────

export async function getCompanies() {
  const { data, error } = await withTimeout(
    supabase.from("companies").select("*").order("name", { ascending: true })
  );
  if (error) { console.error("getCompanies", error); return []; }
  return data.map(dbToCompany);
}

export async function upsertCompany(company) {
  const { error } = await supabase
    .from("companies")
    .upsert(companyToDb(company), { onConflict: "id" });
  if (error) console.error("upsertCompany", error);
}

export async function deleteCompany(id) {
  const { error } = await supabase.from("companies").delete().eq("id", id);
  if (error) console.error("deleteCompany", error);
}

// ─── Photos ──────────────────────────────────────────────────────

export async function getPhoto(id) {
  const { data, error } = await supabase
    .from("photos")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return data?.data || null;
}

export async function savePhoto(id, dataUrl) {
  const { error } = await supabase
    .from("photos")
    .upsert({ id, data: dataUrl }, { onConflict: "id" });
  if (error) console.error("savePhoto", error);
}

// ─── Settings ────────────────────────────────────────────────────

export async function getSetting(key) {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) return null;
  return data?.value || null;
}

// Get all settings in one query instead of 3 separate calls
export async function getAllSettings() {
  const { data, error } = await withTimeout(
    supabase.from("settings").select("key,value")
  );
  if (error) { console.error("getAllSettings", error); return {}; }
  const map = {};
  for (const row of (data || [])) map[row.key] = row.value;
  return map;
}

export async function setSetting(key, value) {
  const { error } = await supabase
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) console.error("setSetting", error);
}

// ─── Wipe everything ─────────────────────────────────────────────

export async function wipeAll() {
  await Promise.all([
    supabase.from("tasks").delete().neq("id", ""),
    supabase.from("projects").delete().neq("id", ""),
    supabase.from("companies").delete().neq("id", ""),
    supabase.from("photos").delete().neq("id", ""),
    supabase.from("settings").delete().neq("key", ""),
  ]);
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractMentions(comments) {
  const re = /@([\w\s.'-]+?)(?=\s|$|[^a-zA-Z0-9\s.'-])/g;
  const out = new Set();
  for (const c of (comments || [])) {
    let m; re.lastIndex = 0;
    const text = c.text || "";
    while ((m = re.exec(text)) !== null) out.add(m[1].trim().toLowerCase());
  }
  return [...out];
}

// ─── DB row ↔ app object mappers ─────────────────────────────────

function dbToProject(r) {
  return {
    id: r.id, name: r.name,
    client:      r.client       || "",
    address:     r.address      || "",
    siteContact: r.site_contact || "",
    sitePhone:   r.site_phone   || "",
    status:      r.status       || "Active",
    createdAt:   r.created_at,
  };
}

function projectToDb(p) {
  return {
    id: p.id, name: p.name,
    client:       p.client      || "",
    address:      p.address     || "",
    site_contact: p.siteContact || "",
    site_phone:   p.sitePhone   || "",
    status:       p.status      || "Active",
    created_at:   p.createdAt,
  };
}

// Light mapper — no comments or status_history (not selected on initial load)
function dbToTaskLight(r) {
  return {
    id:              r.id,
    project:         r.project,
    area:            r.area,
    description:     r.description,
    trade:           r.trade,
    trades:          r.trades          || [],
    priority:        r.priority,
    dueDate:         r.due_date,
    status:          r.status           || "Reported",
    approval:        r.approval         || "Pending",
    photos:          r.photos           || [],
    comments:        [],      // loaded on demand when task is opened
    statusHistory:   [],      // loaded on demand
    createdBy:       r.created_by,
    createdAt:       r.created_at,
    approvedBy:      r.approved_by      || null,
    approvedAt:      r.approved_at      || null,
    rejectionReason: r.rejection_reason || null,
    rejectionPhotos: [],      // loaded on demand
    myTasks:         r.my_tasks         || [],
    mentions:        r.mentions         || [],
    _fullLoaded:     false,   // flag so TaskDetail knows to fetch full data
  };
}

// Full mapper — used when a specific task is opened
export function dbToTask(r) {
  const comments = r.comments || [];
  const savedMentions = r.mentions || [];
  const mentions = savedMentions.length > 0 ? savedMentions : extractMentions(comments);
  return {
    id:              r.id,
    project:         r.project,
    area:            r.area,
    description:     r.description,
    trade:           r.trade,
    trades:          r.trades          || [],
    priority:        r.priority,
    dueDate:         r.due_date,
    status:          r.status           || "Reported",
    approval:        r.approval         || "Pending",
    photos:          r.photos           || [],
    comments,
    statusHistory:   r.status_history   || [],
    createdBy:       r.created_by,
    createdAt:       r.created_at,
    approvedBy:      r.approved_by      || null,
    approvedAt:      r.approved_at      || null,
    rejectionReason: r.rejection_reason || null,
    rejectionPhotos: r.rejection_photos || [],
    myTasks:         r.my_tasks         || [],
    mentions,
    _fullLoaded:     true,
  };
}

export function taskToDb(t) {
  return {
    id:               t.id,
    project:          t.project,
    area:             t.area,
    description:      t.description,
    trade:            Array.isArray(t.trades)&&t.trades.length>0 ? t.trades.join(", ") : (t.trade||""),
    trades:           Array.isArray(t.trades)&&t.trades.length>0 ? t.trades : (t.trade?[t.trade]:[]),
    priority:         t.priority,
    due_date:         t.dueDate,
    status:           t.status          || "Reported",
    approval:         t.approval        || "Pending",
    photos:           t.photos          || [],
    comments:         t.comments        || [],
    status_history:   t.statusHistory   || [],
    created_by:       t.createdBy,
    created_at:       t.createdAt,
    approved_by:      t.approvedBy      || null,
    approved_at:      t.approvedAt      || null,
    rejection_reason: t.rejectionReason || null,
    rejection_photos: t.rejectionPhotos || [],
    my_tasks:         t.myTasks         || [],
    mentions:         t.mentions        || [],
  };
}

function dbToCompany(r) {
  return {
    id:          r.id,
    name:        r.name,
    tradeType:   r.trade_type   || "",
    contactName: r.contact_name || "",
    email:       r.email        || "",
    phone:       r.phone        || "",
    createdAt:   r.created_at,
  };
}

function companyToDb(c) {
  return {
    id:           c.id,
    name:         c.name,
    trade_type:   c.tradeType   || "",
    contact_name: c.contactName || "",
    email:        c.email       || "",
    phone:        c.phone       || "",
    created_at:   c.createdAt,
  };
}
