import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

// ─── Projects ────────────────────────────────────────────────────

export async function getProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
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

export async function getTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { console.error("getTasks", error); return []; }
  return data.map(dbToTask);
}

export async function upsertTask(task) {
  const { error } = await supabase
    .from("tasks")
    .upsert(taskToDb(task), { onConflict: "id" });
  if (error) console.error("upsertTask", error);
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) console.error("deleteTask", error);
}

// ─── Companies ───────────────────────────────────────────────────

export async function getCompanies() {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .order("name", { ascending: true });
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
    .single();
  if (error) return null;
  return data?.data || null;
}

export async function savePhoto(id, dataUrl) {
  const { error } = await supabase
    .from("photos")
    .upsert({ id, data: dataUrl }, { onConflict: "id" });
  if (error) console.error("savePhoto", error);
}

// ─── Settings (team code + company settings) ─────────────────────

export async function getSetting(key) {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .single();
  if (error) return null;
  return data?.value || null;
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

// ─── DB row ↔ app object mappers ─────────────────────────────────

function dbToProject(r) {
  return {
    id:            r.id,
    name:          r.name,
    client:        r.client        || "",
    address:       r.address       || "",
    siteContact:   r.site_contact  || "",
    sitePhone:     r.site_phone    || "",
    status:        r.status        || "Active",
    headerPhotoId: r.header_photo_id || null,
    createdAt:     r.created_at,
  };
}

function projectToDb(p) {
  return {
    id:              p.id,
    name:            p.name,
    client:          p.client          || "",
    address:         p.address         || "",
    site_contact:    p.siteContact      || "",
    site_phone:      p.sitePhone        || "",
    status:          p.status          || "Active",
    header_photo_id: p.headerPhotoId   || null,
    created_at:      p.createdAt,
  };
}

function dbToTask(r) {
  return {
    id:                     r.id,
    project:                r.project,
    area:                   r.area,
    description:            r.description,
    trade:                  r.trade,
    priority:               r.priority,
    dueDate:                r.due_date,
    status:                 r.status      || "Reported",
    approval:               r.approval    || "Pending",
    photos:                 r.photos      || [],
    afterPhotos:            r.after_photos || [],
    comments:               r.comments    || [],
    statusHistory:          r.status_history || [],
    createdBy:              r.created_by,
    createdAt:              r.created_at,
    approvedBy:             r.approved_by,
    approvedAt:             r.approved_at,
    rejectionReason:        r.rejection_reason || null,
    rejectionCount:         r.rejection_count  || 0,
  };
}

function taskToDb(t) {
  return {
    id:               t.id,
    project:          t.project,
    area:             t.area,
    description:      t.description,
    trade:            t.trade,
    priority:         t.priority,
    due_date:         t.dueDate,
    status:           t.status      || "Reported",
    approval:         t.approval    || "Pending",
    photos:           t.photos      || [],
    after_photos:     t.afterPhotos || [],
    comments:         t.comments    || [],
    status_history:   t.statusHistory || [],
    created_by:       t.createdBy,
    created_at:       t.createdAt,
    approved_by:      t.approvedBy  || null,
    approved_at:      t.approvedAt  || null,
    rejection_reason: t.rejectionReason || null,
    rejection_count:  t.rejectionCount  || 0,
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
