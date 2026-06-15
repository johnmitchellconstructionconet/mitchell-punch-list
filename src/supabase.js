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
  const payload = taskToDb(task);

  // SELECT first — .upsert() is blocked by RLS on existing rows without error.
  const { data: existing, error: selectError } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", payload.id)
    .maybeSingle();

  if (selectError) {
    throw new Error("Select failed: " + (selectError.message || JSON.stringify(selectError)));
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("tasks")
      .update(payload)
      .eq("id", payload.id);
    if (updateError) {
      throw new Error("Update failed: " + (updateError.message || JSON.stringify(updateError)));
    }
  } else {
    const { error: insertError } = await supabase
      .from("tasks")
      .insert(payload);
    if (insertError) {
      throw new Error("Insert failed: " + (insertError.message || JSON.stringify(insertError)));
    }
  }
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

// ─── Settings ────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

// Parse @mentions out of comment text so the bell works without a DB column
function extractMentions(comments) {
  const re = /@([\w\s.'-]+?)(?=\s|$|[^a-zA-Z0-9\s.'-])/g;
  const out = new Set();
  for (const c of (comments || [])) {
    let m;
    re.lastIndex = 0;
    const text = c.text || "";
    while ((m = re.exec(text)) !== null) out.add(m[1].trim());
  }
  return [...out];
}

// ─── DB row ↔ app object mappers ─────────────────────────────────
// taskToDb writes ONLY columns that exist in the Supabase tasks table.
// mentions is derived in memory from comments — no DB column needed.

function dbToProject(r) {
  return {
    id:          r.id,
    name:        r.name,
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
    id:           p.id,
    name:         p.name,
    client:       p.client      || "",
    address:      p.address     || "",
    site_contact: p.siteContact || "",
    site_phone:   p.sitePhone   || "",
    status:       p.status      || "Active",
    created_at:   p.createdAt,
  };
}

function dbToTask(r) {
  const comments = r.comments || [];
  return {
    id:            r.id,
    project:       r.project,
    area:          r.area,
    description:   r.description,
    trade:         r.trade,
    priority:      r.priority,
    dueDate:       r.due_date,
    status:        r.status         || "Reported",
    approval:      r.approval       || "Pending",
    photos:        r.photos         || [],
    comments,
    statusHistory: r.status_history || [],
    createdBy:     r.created_by,
    createdAt:     r.created_at,
    approvedBy:    r.approved_by    || null,
    approvedAt:    r.approved_at    || null,
    // mentions derived from comments — no DB column required
    mentions:      extractMentions(comments),
  };
}

function taskToDb(t) {
  // IMPORTANT: only include columns that exist in your Supabase tasks table.
  // Do NOT add mentions, after_photos, rejection_reason, rejection_count,
  // rejection_history, or header_photo_id — those columns do not exist.
  return {
    id:             t.id,
    project:        t.project,
    area:           t.area,
    description:    t.description,
    trade:          t.trade,
    priority:       t.priority,
    due_date:       t.dueDate,
    status:         t.status        || "Reported",
    approval:       t.approval      || "Pending",
    photos:         t.photos        || [],
    comments:       t.comments      || [],
    status_history: t.statusHistory || [],
    created_by:     t.createdBy,
    created_at:     t.createdAt,
    approved_by:    t.approvedBy    || null,
    approved_at:    t.approvedAt    || null,
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
