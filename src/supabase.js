/* ================================================================
   SUPABASE DATABASE LAYER — Punch List System
   All tables use RLS disabled (anon key has full access).
   Tables: projects, tasks, companies, photos, settings
   ================================================================ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
}

// ── Low-level fetch wrapper ──────────────────────────────────────
async function sb(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ── PROJECTS ────────────────────────────────────────────────────
export async function getProjects() {
  return sb("projects?order=created_at.desc");
}

export async function upsertProject(project) {
  return sb("projects?on_conflict=id", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(project),
  });
}

export async function deleteProject(id) {
  return sb(`projects?id=eq.${id}`, { method: "DELETE" });
}

// ── TASKS ───────────────────────────────────────────────────────
export async function getTasks() {
  return sb("tasks?order=created_at.desc");
}

export async function upsertTask(task) {
  // Supabase can't store JS undefined — strip them out
  const clean = JSON.parse(JSON.stringify(task));
  return sb("tasks?on_conflict=id", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(clean),
  });
}

export async function deleteTask(id) {
  return sb(`tasks?id=eq.${id}`, { method: "DELETE" });
}

// ── COMPANIES (Trade Directory) ──────────────────────────────────
export async function getCompanies() {
  return sb("companies?order=name.asc");
}

export async function upsertCompany(company) {
  return sb("companies?on_conflict=id", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(company),
  });
}

export async function deleteCompany(id) {
  return sb(`companies?id=eq.${id}`, { method: "DELETE" });
}

// ── PHOTOS ──────────────────────────────────────────────────────
// Photos are stored as base64 strings in a key-value table.
// Table schema: id (text PK), data (text)

export async function getPhoto(id) {
  const rows = await sb(`photos?id=eq.${encodeURIComponent(id)}&select=data`);
  return rows?.[0]?.data ?? null;
}

export async function savePhoto(id, dataUrl) {
  return sb("photos?on_conflict=id", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id, data: dataUrl }),
  });
}

// ── SETTINGS ────────────────────────────────────────────────────
// Settings are stored as key-value pairs.
// Table schema: key (text PK), value (text)

export async function getSetting(key) {
  const rows = await sb(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? null;
}

export async function setSetting(key, value) {
  return sb("settings?on_conflict=key", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key, value }),
  });
}

// ── WIPE ALL ────────────────────────────────────────────────────
// Nuclear option — deletes everything. Called from the Danger Zone in Trade Directory.
export async function wipeAll() {
  await Promise.all([
    sb("tasks?id=neq.00000000", { method: "DELETE" }),
    sb("projects?id=neq.00000000", { method: "DELETE" }),
    sb("companies?id=neq.00000000", { method: "DELETE" }),
    sb("photos?id=neq.placeholder", { method: "DELETE" }),
    sb("settings?key=neq.placeholder", { method: "DELETE" }),
  ]);
}
