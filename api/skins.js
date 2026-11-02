// DiamondTier skin helper. Asks Mojang for the skin each player is wearing right now.
// It runs on Vercel because Mojang blocks Cloudflare's servers. Nothing is stored.
//   GET /api/skins?names=oLineage,sssap
const timeout = (ms) => AbortSignal.timeout(ms);

async function accountId(name) {
  for (const u of ["https://api.mojang.com/users/profiles/minecraft/", "https://api.minecraftservices.com/minecraft/profile/lookup/name/"]) {
    try {
      const r = await fetch(u + encodeURIComponent(name), { signal: timeout(5000) });
      if (r.status === 404 || r.status === 204) return { none: true };
      if (r.ok) { const j = await r.json(); if (j && j.id) return { id: j.id, name: j.name }; }
    } catch (e) {}
  }
  return null;
}

async function skin(name) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return { none: true };
  const prof = await accountId(name);
  if (!prof) return { error: "lookup", why: "no account id" };
  if (prof.none) return { none: true, src: "mojang" };
  // ask Mojang's skin server; if it is slow or busy, wait a moment and try once more
  let s = null;
  for (let attempt = 0; attempt < 2 && !(s && s.ok); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    s = await fetch("https://sessionserver.mojang.com/session/minecraft/profile/" + prof.id + "?unsigned=true", { signal: timeout(6000) }).catch(() => null);
  }
  if (!s || !s.ok) return { error: "lookup", why: "session " + (s ? s.status : "timeout") };
  const j = await s.json();
  const prop = (j.properties || []).find((p) => p.name === "textures");
  const tex = prop ? JSON.parse(Buffer.from(prop.value, "base64").toString("utf8")) : null;
  const sk = tex && tex.textures && tex.textures.SKIN;
  if (!sk || !sk.url) return { name: j.name || prof.name, none: true, src: "mojang" };
  return { name: j.name || prof.name, url: String(sk.url).replace(/^http:/, "https:"), slim: !!(sk.metadata && sk.metadata.model === "slim"), src: "mojang" };
}

export default async function handler(req, res) {
  const names = [...new Set(String(req.query.names || req.query.name || "").split(",").map((n) => n.trim()).filter(Boolean))].slice(0, 40);
  const results = await Promise.all(names.map((n) => skin(n).catch(() => ({ error: "lookup" }))));
  const out = {};
  names.forEach((n, i) => { out[n.toLowerCase()] = results[i]; });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=20, max-age=0"); // answers reused 20s at most, so Mojang doesn't rate-limit us
  res.status(200).json(out);
}
