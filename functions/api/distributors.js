// /api/distributors
//  GET     -> lista todos los distribuidores con sus productos
//  POST    -> body {name, items:[{d,p}]}  crea o reemplaza un distribuidor (upsert por slug)
//  DELETE  -> ?slug=xxx   borra un distribuidor
//
// Usa la SERVICE ROLE key de Supabase (nunca se manda al navegador) asi que
// no depende de políticas RLS para funcionar.

function slugify(name) {
  let s = String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "distribuidor-" + Math.random().toString(36).slice(2, 8);
  return s.slice(0, 60);
}

function sbHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
    "content-type": "application/json",
    ...extra
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function checkEnv(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export async function onRequestGet({ env }) {
  if (!checkEnv(env)) return json({ error: "server_not_configured" }, 500);
  const url = `${env.SUPABASE_URL}/rest/v1/distributors?select=slug,name,item_count,updated_at,items&order=name.asc`;
  const resp = await fetch(url, { headers: sbHeaders(env) });
  if (!resp.ok) return json({ error: "db_error", detail: (await resp.text()).slice(0, 300) }, 502);
  const rows = await resp.json();
  return json({ distributors: rows });
}

export async function onRequestPost({ request, env }) {
  if (!checkEnv(env)) return json({ error: "server_not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }

  const name = String(body?.name || "").trim();
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!name) return json({ error: "missing_name" }, 400);

  const clean = items
    .map(o => ({ d: String(o?.d || "").trim(), p: Number(o?.p) }))
    .filter(o => o.d && Number.isFinite(o.p) && o.p > 0);

  const slug = slugify(name);
  const row = {
    slug,
    name,
    items: clean,
    item_count: clean.length,
    updated_at: new Date().toISOString()
  };

  const url = `${env.SUPABASE_URL}/rest/v1/distributors?on_conflict=slug`;
  const resp = await fetch(url, {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(row)
  });
  if (!resp.ok) return json({ error: "db_error", detail: (await resp.text()).slice(0, 300) }, 502);
  const saved = await resp.json();
  return json({ distributor: saved[0] || row });
}

export async function onRequestDelete({ request, env }) {
  if (!checkEnv(env)) return json({ error: "server_not_configured" }, 500);
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return json({ error: "missing_slug" }, 400);
  const url = `${env.SUPABASE_URL}/rest/v1/distributors?slug=eq.${encodeURIComponent(slug)}`;
  const resp = await fetch(url, { method: "DELETE", headers: sbHeaders(env) });
  if (!resp.ok) return json({ error: "db_error", detail: (await resp.text()).slice(0, 300) }, 502);
  return json({ ok: true });
}
