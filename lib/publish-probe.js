// TEMPORARY publish-reauth diagnostic harness (not product code).
// Explores which request shape lets a server-side publish pass Substack's
// `reauthentication_required` gate. Removed once the fix lands.
// Never returns or logs cookies/secrets — only status + error type.

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function acceptHeaders() {
  return { Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" };
}

function originHeaders(pub) {
  const origin = pub.startsWith("http") ? new URL(pub).origin : `https://${pub}`;
  return { Referer: `${origin}/`, Origin: origin };
}

export const PROBE_VARIANTS = {
  baseline: { headers: () => ({}), navigate: false, prepublish: false },
  ua: { headers: () => ({ "User-Agent": BROWSER_UA }), navigate: false, prepublish: false },
  accept: { headers: () => acceptHeaders(), navigate: false, prepublish: false },
  referer: { headers: (pub) => originHeaders(pub), navigate: false, prepublish: false },
  requestedwith: { headers: () => ({ "X-Requested-With": "XMLHttpRequest" }), navigate: false, prepublish: false },
  navigate: { headers: () => ({}), navigate: true, prepublish: false },
  prepublish: { headers: () => ({}), navigate: false, prepublish: true },
  all: { headers: (pub) => ({ "User-Agent": BROWSER_UA, ...acceptHeaders(), ...originHeaders(pub) }), navigate: false, prepublish: false },
  all_warm: {
    headers: (pub) => ({ "User-Agent": BROWSER_UA, ...acceptHeaders(), ...originHeaders(pub) }),
    navigate: true,
    prepublish: true,
  },
};

function baseOf(pub) {
  const origin = pub.startsWith("http") ? pub.replace(/\/+$/, "") : `https://${pub}`;
  return `${origin}/api/v1`;
}

function summarize(status, text) {
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return {
    status,
    type: j && j.type ? j.type : null,
    error: j && j.error ? String(j.error).slice(0, 140) : null,
    html: !j && /<html/i.test(text) ? "cloudflare/challenge page" : (!j ? text.replace(/\s+/g, " ").slice(0, 100) : null),
  };
}

export async function runPublishVariant({ sid, pub, id, variant }) {
  const spec = PROBE_VARIANTS[variant];
  if (!spec) throw new Error(`unknown variant: ${variant}`);
  const base = baseOf(pub);
  const headers = { Cookie: `substack.sid=${sid}`, "Content-Type": "application/json", ...spec.headers(pub) };
  const steps = [];
  if (spec.navigate) {
    const r = await fetch(`${base}/drafts/${id}`, { headers });
    steps.push({ step: "navigate", ...summarize(r.status, await r.text()) });
  }
  if (spec.prepublish) {
    const r = await fetch(`${base}/drafts/${id}/prepublish`, { headers });
    steps.push({ step: "prepublish", ...summarize(r.status, await r.text()) });
  }
  const r = await fetch(`${base}/drafts/${id}/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({ send: false, share_automatically: false }),
  });
  return { variant, steps, publish: summarize(r.status, await r.text()) };
}
