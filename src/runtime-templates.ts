/**
 * Injected runtime templates. These are emitted into the hardened client and
 * the generated server skeleton. They are intentionally dependency-free so the
 * bundle stays self-contained.
 *
 * Honesty: `opaque` encoding below is wire OBFUSCATION, not confidentiality.
 * Real confidentiality for relocated calls comes from HTTPS. Sealed modules use
 * real AES-256-GCM with a server-fetched key (that key never ships).
 */

/** Shared opaque wire encoder (XOR + base64). Same on client and server. */
export function encodeHelperSource(wireKeyB64: string): string {
  return `
const __wk = Uint8Array.from(atob(${JSON.stringify(wireKeyB64)}), c => c.charCodeAt(0));
function __opaque(obj){
  const s = new TextEncoder().encode(JSON.stringify(obj));
  const out = new Uint8Array(s.length);
  for (let i=0;i<s.length;i++) out[i] = s[i] ^ __wk[i % __wk.length];
  return btoa(String.fromCharCode(...out));
}
function __unopaque(str){
  const bin = Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin[i] ^ __wk[i % __wk.length];
  return JSON.parse(new TextDecoder().decode(out));
}
`.trim();
}

/** Client-side runtime: transport config, relocated call, sealed loader. */
export function clientRuntimeSource(opts: {
  endpoint: string;
  keyEndpoint: string;
  wireKeyB64: string;
  /** true: ESM `export function __configureShield` (library/flatten mode).
   *  false: attach to globalThis (plugin mode; chunk-format agnostic). */
  exportConfigure?: boolean;
}): string {
  const configureLine =
    opts.exportConfigure === false
      ? "globalThis.__configureShield = function(o){ return __shield.configure(o); };"
      : "export function __configureShield(o){ return __shield.configure(o); }";
  return `
${encodeHelperSource(opts.wireKeyB64)}
const __shield = (() => {
  let _transport = async (payload) => {
    const res = await fetch(${JSON.stringify(opts.endpoint)}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("reashield: transport failed");
    return res.json();
  };
  let _keyTransport = async (op) => {
    const res = await fetch(${JSON.stringify(opts.keyEndpoint)} + "?op=" + encodeURIComponent(op));
    if (!res.ok) throw new Error("reashield: key fetch failed");
    return (await res.json()).k;
  };
  const _keyCache = new Map();
  let _authToken = null;
  async function _getKey(op){
    if (_keyCache.has(op)) return _keyCache.get(op);
    const k = await _keyTransport(op);
    _keyCache.set(op, k);
    return k;
  }
  async function _aesDecrypt(keyB64, blob){
    const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const iv = Uint8Array.from(atob(blob.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(blob.ct), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(pt);
  }
  const _sealCache = new Map();
  return {
    configure(o){ if(o && o.transport) _transport=o.transport; if(o && o.keyTransport) _keyTransport=o.keyTransport; if(o && o.authToken) _authToken=o.authToken; },
    async call(op, args){
      const payload = { op, d: __opaque(args) };
      if (_authToken) payload.t = typeof _authToken === "function" ? await _authToken() : _authToken;
      const r = await _transport(payload);
      return __unopaque(r.d);
    },
    async sealed(op, blob, params){
      let fn = _sealCache.get(op);
      if (!fn) {
        const keyB64 = await _getKey(op);
        const src = await _aesDecrypt(keyB64, blob);
        // src is "return (async function(a,b){...}).apply(null, arguments)"
        fn = new Function("return (" + src + ")")();
        _sealCache.set(op, fn);
      }
      return fn.apply(null, params);
    },
  };
})();
${configureLine}
`.trim();
}

/** Server-side handler + key store + adapter. */
export function serverFiles(opts: {
  adapter: "express" | "fastify" | "web" | "generic";
  endpoint: string;
  keyEndpoint: string;
  wireKeyB64: string;
  /** opId -> async function source, e.g. "async function(a,b){ ... }" */
  handlers: Record<string, string>;
  /** opId -> base64 AES key for sealed modules */
  keys: Record<string, string>;
}): Record<string, string> {
  const handlersEntries = Object.entries(opts.handlers)
    .map(([op, src]) => `  ${JSON.stringify(op)}: (${src}),`)
    .join("\n");
  const keyEntries = Object.entries(opts.keys)
    .map(([op, k]) => `  ${JSON.stringify(op)}: ${JSON.stringify(k)},`)
    .join("\n");

  const core = `
${encodeHelperSource(opts.wireKeyB64)}

const ENDPOINT = ${JSON.stringify(opts.endpoint)};
const KEY_ENDPOINT = ${JSON.stringify(opts.keyEndpoint)};

// The real logic for relocated features lives here and is never shipped to clients.
export const handlers = {
${handlersEntries}
};

// Decryption keys for sealed modules. Serve ONLY over an authenticated channel.
export const keys = {
${keyEntries}
};

// Auth seam: YOU supply the verifier. Until you call setAuthVerifier, the
// endpoint is OPEN — secure it (auth + TLS + rate limiting) before shipping.
let __authVerify = null;
export function setAuthVerifier(fn){ __authVerify = fn; }

export class ShieldUnauthorized extends Error {}

export async function handle(payload, ctx){
  if (__authVerify) {
    const ok = await __authVerify(payload && payload.t, ctx);
    if (!ok) throw new ShieldUnauthorized("reashield: unauthorized");
  }
  const fn = handlers[payload.op];
  if (!fn) throw new Error("reashield: unknown op");
  const args = __unopaque(payload.d);
  const out = await fn.apply(null, args);
  return { d: __opaque(out) };
}

export function getKey(op){
  const k = keys[op];
  if (!k) throw new Error("reashield: unknown sealed op");
  return k;
}

// Cross-runtime Web handler (Hono, Workers, Deno, Next route handlers, Bun...).
export async function webHandler(request){
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === ENDPOINT) {
    try { return Response.json(await handle(await request.json(), { request })); }
    catch (e) {
      const status = e instanceof ShieldUnauthorized ? 401 : 400;
      return Response.json({ error: String(e) }, { status });
    }
  }
  if (request.method === "GET" && url.pathname === KEY_ENDPOINT) {
    try { return Response.json({ k: getKey(url.searchParams.get("op")) }); }
    catch (e) { return Response.json({ error: String(e) }, { status: 404 }); }
  }
  return new Response("not found", { status: 404 });
}
`.trim();

  const files: Record<string, string> = {
    "handlers.js": core,
    "README.md": `# REAShield server skeleton

Generated by \`reashield build\`. **Do not ship this directory to end users** —
it contains the real logic (and keys) that were removed from the client.

- \`handle(payload)\` serves relocated calls at \`${opts.endpoint}\`.
- \`getKey(op)\` serves sealed-module keys at \`${opts.keyEndpoint}\`.

You own securing this endpoint (auth, TLS, rate limiting). REAShield scaffolds
the wiring; it does not add authentication for you.
`,
  };

  if (opts.adapter === "express") {
    files["server.js"] = `
import express from "express";
import { handle, getKey } from "./handlers.js";

const app = express();
app.use(express.json());

app.post(${JSON.stringify(opts.endpoint)}, async (req, res) => {
  try { res.json(await handle(req.body)); }
  catch (e) { res.status(400).json({ error: String(e) }); }
});

app.get(${JSON.stringify(opts.keyEndpoint)}, (req, res) => {
  try { res.json({ k: getKey(String(req.query.op)) }); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log("reashield server on :" + port));
`.trim();
  } else if (opts.adapter === "fastify") {
    files["server.js"] = `
import Fastify from "fastify";
import { handle, getKey } from "./handlers.js";

const app = Fastify();
app.post(${JSON.stringify(opts.endpoint)}, async (req) => handle(req.body));
app.get(${JSON.stringify(opts.keyEndpoint)}, async (req) => ({ k: getKey(req.query.op) }));
app.listen({ port: process.env.PORT || 8787 });
`.trim();
  }

  return files;
}
