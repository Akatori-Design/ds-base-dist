#!/usr/bin/env node
// ds-base installer — installs any of four products into the project in the current
// directory: 1) DS Designer  2) UX Designer  3) Brand Designer  (agents)  4) DS base kit.
// Zero dependencies (Node 18+).
//
// Buyers: approve this computer on the course site, then install what they bought (T-050).
//   curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs
//   node /tmp/ds-base-init.mjs            # shows a code to approve, then asks which products
// The install key stays in ~/.config/ds-base (owner-only) and is never printed.
//
// Owner: install straight from the private repo with DS_BASE_TOKEN (or --github to be asked for it).
//
// Options:
//   --products ds,ux,brand,kit   pick products without the question (any combination)
//   --all                 every product your account includes
//   --check               sign in if needed, list the products you can install, and stop
//   --sign-out            remove this computer's install key
//   --agent               legacy: DS Designer only · --with-ux / --no-ux: legacy add/skip UX Designer
//   --a11y-level A|AA     accessibility level the agents and checks enforce (T-054). Default AA; asked on
//                         first install, kept on updates. Change it later with this flag or in .ds-base.json.
//   --update-kit          also update the installed kit's components (otherwise asked; default No)
//   --use-stock-tokens <names|all>  replace your values for these tokens with ds-base's, or take a
//                         stock fix by its ID (e.g. T-048). A backup is kept.
//   --site <url>          course site to sign in to (default: set when published)
//   --github              install from the private repo with a GitHub token (owner)
//   --ref <branch|tag>    version to install with --github (default: main)
//   --repo <owner/name>   default: Akatori-Design/ds-base
//   --source <dir>        install from a local checkout instead of GitHub (no token needed)
//   --dir <path>          code base dir in the host (default: src/ if the host uses it, else .)
//   --force               overwrite files that differ (default: keep yours, report them)
//   --dry-run             show what would change, write nothing
//   --yes                 accept defaults (install dependencies, add scripts)
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execSync } from "node:child_process";

// ---- args -----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const REPO = opt("repo", "Akatori-Design/ds-base");
const REF = opt("ref", "main");
const SOURCE = opt("source");
const FORCE = flag("force"), DRY = flag("dry-run"), YES = flag("yes");
const HOST = process.cwd();
let TOKEN = process.env.DS_BASE_TOKEN;
const SITE = (opt("site") || process.env.DS_BASE_SITE || "https://no-figma-design.pages.dev").replace(/\/+$/, ""); // filled in by install/publish.mjs
const MODE = SOURCE ? "local" : TOKEN || flag("github") ? "github" : "account";
const NEEDS_APPROVAL = 10; // exit code: show the code to the buyer, then run this again

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const die = (msg) => { console.error(c.r(`✗ ${msg}`)); process.exit(1); };

// ---- source: GitHub (private, token) or local checkout ---------------------------------
const gh = async (path, accept = "application/vnd.github+json") => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ds-base-init" },
  });
  if (res.status === 401 || res.status === 403) die("GitHub refused the token (401/403). It needs Contents: read-only on " + REPO + ".");
  if (res.status === 404) die(`Not found on GitHub: ${REPO} @ ${REF} (${path.split("?")[0]}). Is the repo name/ref right, and does the token include this repo?`);
  if (!res.ok) die(`GitHub error ${res.status} for ${path.split("?")[0]}`);
  return res;
};

// ---- account install: one approved computer per buyer (T-050) -----------------------------
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "ds-base");
const CONFIG_FILE = join(CONFIG_DIR, "install.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readConfig = () => { try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; } };
const siteEntry = () => readConfig()[SITE] ?? {};
function saveEntry(entry) {
  const all = readConfig();
  if (Object.keys(entry).length) all[SITE] = entry; else delete all[SITE];
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    chmodSync(CONFIG_FILE, 0o600);
  } catch (e) { die(`Couldn't save the install key in ${CONFIG_DIR} (${e.code ?? e.message}). Run the installer in your own terminal.`); }
}
function checkSite() {
  let url;
  try { url = new URL(SITE); } catch { die("This installer has no course site set. Download the latest one from ds-base-dist."); }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) die("The course site must use https.");
}
async function call(path, init = {}) {
  try { return await fetch(`${SITE}/api/install/${path}`, { ...init, headers: { "user-agent": "ds-base-init", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } }); }
  catch { die(`Couldn't reach ${SITE}. Check your connection and try again.`); }
}
const errorOf = async (res) => (await res.json().catch(() => ({}))).error;
const showApproval = (p) => {
  console.log(`\n${c.b("Approve this computer")}`);
  console.log(`  1. Open   ${c.b(p.verification_url)}`);
  console.log(`  2. Sign in and enter this code:  ${c.b(p.user_code)}`);
  console.log(c.d("  Only enter a code you started yourself. It expires in 10 minutes.\n"));
};
async function startApproval() {
  const res = await call("start", { method: "POST", body: JSON.stringify({ label: `${hostname()} (${{ darwin: "Mac", win32: "Windows", linux: "Linux" }[platform()] ?? platform()})` }) });
  if (!res.ok) die(res.status === 429 ? "Too many install attempts from this network. Try again in an hour." : `The course site couldn't start the install (${res.status}).`);
  const d = await res.json();
  const pending = { device_code: d.device_code, user_code: d.user_code, verification_url: d.verification_url, interval: d.interval, expires_at: Date.now() + d.expires_in * 1000 };
  saveEntry({ pending });
  return pending;
}
// Waits for approval. In a terminal it waits for the buyer; elsewhere (Claude) it checks briefly
// and exits so the code can be shown to them, and the next run picks up where this one stopped.
async function waitForKey() {
  let pending = siteEntry().pending;
  let resumed = !!pending && pending.expires_at > Date.now();
  if (!resumed) pending = await startApproval();
  showApproval(pending);
  const interactive = process.stdin.isTTY && !YES;
  const until = interactive ? pending.expires_at : resumed ? Math.min(pending.expires_at, Date.now() + 20000) : 0;
  if (interactive) console.log(c.d("Waiting for approval…"));
  while (Date.now() < until || resumed) {
    resumed = false;
    const res = await call("poll", { method: "POST", body: JSON.stringify({ device_code: pending.device_code }) });
    if (res.status === 200) {
      const d = await res.json();
      if (d.status === "approved") { saveEntry({ key: d.install_key }); console.log(c.g("✓ Computer approved.")); return d.install_key; }
    } else {
      const error = await errorOf(res);
      saveEntry({});
      if (error === "connection_limit") die("This account has used its connections for the last 30 days. Contact support for a reset.");
      if (error === "plan_required") die("Your plan doesn't include ds-base.");
      die("That code expired. Run the installer again for a new one.");
    }
    if (Date.now() + pending.interval * 1000 >= until) break;
    await sleep(pending.interval * 1000);
  }
  if (interactive) { saveEntry({}); die("The code expired. Run the installer again for a new one."); }
  console.log(`Waiting for approval. After approving, run this same command again.`);
  process.exit(NEEDS_APPROVAL);
}
let packageData = null;
async function loadPackage() {
  checkSite();
  let key = siteEntry().key;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    key ??= await waitForKey();
    const res = await call("package", { headers: { authorization: `Bearer ${key}` } });
    if (res.ok) {
      try { packageData = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")); } catch { die("The download was damaged. Please try again."); }
      return;
    }
    const error = await errorOf(res);
    if (res.status === 401) {
      saveEntry({}); key = undefined;
      console.log(c.y(error === "install_replaced" ? "! Another computer was approved for this account, so this one was disconnected." : "! This computer is no longer connected."));
      if (error === "install_revoked") die("Approve it again on the course site if your plan still includes ds-base.");
      continue;
    }
    if (res.status === 403) die("Your plan doesn't include ds-base.");
    if (res.status === 429) die("Too many downloads today. Try again tomorrow.");
    die(`The course site couldn't provide the package (${res.status}). Please try again later.`);
  }
  die("This computer couldn't be connected. Please try again.");
}

const source = MODE === "account"
  ? {
      label: "your ds-base purchase",
      version: async () => packageData.version,
      list: async () => Object.keys(packageData.files),
      read: async (p) => { const f = packageData.files[p]; if (f === undefined) die(`The package is missing ${p}.`); return f; },
    }
  : SOURCE
  ? {
      label: `local ${resolve(SOURCE)}`,
      version: async () => { try { return execSync("git rev-parse HEAD", { cwd: SOURCE }).toString().trim(); } catch { return "local"; } },
      list: async () => {
        // Tracked + new (untracked, not ignored) files, so local installs match the working tree
        const out = execSync("git ls-files --cached --others --exclude-standard", { cwd: SOURCE }).toString().trim().split("\n");
        return out;
      },
      read: async (p) => readFileSync(join(SOURCE, p), "utf8"),
    }
  : {
      label: `github.com/${REPO} @ ${REF}`,
      version: async () => (await (await gh(`commits/${encodeURIComponent(REF)}`, "application/vnd.github.sha")).text()).trim(),
      list: async () => (await (await gh(`git/trees/${encodeURIComponent(REF)}?recursive=1`)).json()).tree.filter((t) => t.type === "blob").map((t) => t.path),
      read: async (p) => (await gh(`contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(REF)}`, "application/vnd.github.raw+json")).text(),
    };

// Token: from DS_BASE_TOKEN, else asked for (hidden) in an interactive terminal. Never stored or printed.
function readHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
if (flag("sign-out")) {
  checkSite(); saveEntry({});
  console.log("✓ This computer's install key was removed. To free the connection, disconnect it on the course site too.");
  process.exit(0);
}
if (MODE === "account") await loadPackage(); // sign in before asking anything else
if (flag("check")) {
  if (MODE !== "account") die("--check is for account installs.");
  console.log(`Products you can install: ${packageData.products.join(",")}`);
  console.log(`Version: ${packageData.version.slice(0, 7)}`);
  process.exit(0);
}
if (MODE === "github" && !TOKEN) {
  if (!process.stdin.isTTY) die("DS_BASE_TOKEN is not set. Run: export DS_BASE_TOKEN=github_pat_...  (or use --source <local checkout>)");
  console.log(`${c.b("Access token")} ${c.d("— fine-grained GitHub token with Contents: read-only on " + REPO + ". Input is hidden and never stored.")}`);
  TOKEN = await readHidden("Token: ");
  if (!TOKEN) die("No token entered.");
}

// ---- host checks -------------------------------------------------------------------------
const hostPkgPath = join(HOST, "package.json");
if (!existsSync(hostPkgPath)) die(`No package.json in ${HOST}. Run this from the root of the project you're installing into.`);
const hostPkg = JSON.parse(readFileSync(hostPkgPath, "utf8"));
const allDeps = { ...hostPkg.dependencies, ...hostPkg.devDependencies };

function detectBase() {
  const forced = opt("dir");
  if (forced) return forced;
  for (const f of ["tsconfig.json", "jsconfig.json"]) {
    const p = join(HOST, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const m = text.match(/"@\/\*"\s*:\s*\[\s*"\.?\/?([^"*]*)\*"/);
    if (m) return m[1].replace(/\/$/, "") || ".";
  }
  return existsSync(join(HOST, "src")) ? "src" : ".";
}

// ---- prompts -----------------------------------------------------------------------------
// Line queue: works for a typed TTY and for piped answers (readline.question loses
// lines that arrive together and never resolves once stdin closes).
let rl = null;
const lines = [], waiting = [];
let inputClosed = false;
const ensureRl = () => {
  if (rl) return;
  rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on("close", () => { inputClosed = true; while (waiting.length) waiting.shift()(null); });
};
const nextLine = () => (ensureRl(), lines.length ? Promise.resolve(lines.shift()) : inputClosed ? Promise.resolve(null) : new Promise((r) => waiting.push(r)));
const ask = async (q, def) => {
  if (YES) return def;
  process.stdout.write(q);
  const a = await nextLine();
  if (a === null) process.stdout.write("\n");
  return (a ?? "").trim() || def;
};

const PRODUCTS = {
  ds: { key: "dsDesigner", name: "DS Designer", desc: "design-system-designer agent — tokens, components, motion, accessibility decisions" },
  ux: { key: "uxDesigner", name: "UX Designer", desc: "ux-designer agent + Dev Controls / ScreenTransition — flows, states, screens, review" },
  brand: { key: "brandDesigner", name: "Brand Designer", desc: "brand-designer agent — references → brand kit + theme settings" },
  kit: { key: "kit", name: "DS base kit", desc: "tokens, themes, components, patterns, contrast + lint checks (needs Tailwind v4)" },
};
const IDS = Object.keys(PRODUCTS);
const AVAILABLE = MODE === "account" ? IDS.filter((id) => packageData.products.includes(id)) : IDS; // what this account may install

// Products already installed here (from .ds-base.json; older lock files had mode/uxAgent).
function installedProducts() {
  try {
    const prev = JSON.parse(readFileSync(join(HOST, ".ds-base.json"), "utf8"));
    if (Array.isArray(prev.products)) return new Set(prev.products.filter((p) => IDS.includes(p)));
    return new Set(["ds", ...(prev.mode === "all" ? ["kit"] : []), ...(prev.uxAgent ? ["ux"] : [])]);
  } catch { return new Set(); }
}

// Checkbox list: ↑/↓ move, Space toggles, Enter confirms. The last row toggles every row.
function checkboxes(items, initial) {
  return new Promise((resolve) => {
    const stdin = process.stdin, out = process.stdout;
    const rows = [...items, { id: "*", name: "Install all", desc: items.length > 1 ? "every product above" : "" }];
    const on = new Set(initial);
    let i = 0, drawn = false;
    const allOn = () => items.every((it) => on.has(it.id));
    const draw = () => {
      if (drawn) out.write(`\x1b[${rows.length}A`);
      rows.forEach((r, k) => {
        const checked = r.id === "*" ? allOn() : on.has(r.id);
        const box = checked ? c.g("[x]") : "[ ]";
        const cursor = k === i ? c.b("›") : " ";
        out.write(`\x1b[2K ${cursor} ${box} ${(k === i ? c.b : (x) => x)(r.name.padEnd(16))} ${c.d(r.desc ?? "")}\n`);
      });
      drawn = true;
    };
    out.write(c.d("  ↑/↓ move · Space select · Enter confirm\n"));
    draw();
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const onKey = (k) => {
      if (k === "\u0003") { out.write("\n"); process.exit(130); }
      if (k === "\x1b[A" || k === "k") i = (i + rows.length - 1) % rows.length;
      else if (k === "\x1b[B" || k === "j") i = (i + 1) % rows.length;
      else if (k === " ") {
        const r = rows[i];
        if (r.id === "*") { const all = allOn(); items.forEach((it) => (all ? on.delete(it.id) : on.add(it.id))); }
        else on.has(r.id) ? on.delete(r.id) : on.add(r.id);
      } else if (k === "\r" || k === "\n") {
        stdin.setRawMode(false); stdin.pause(); stdin.off("data", onKey);
        return resolve([...on]);
      }
      draw();
    };
    stdin.on("data", onKey);
  });
}

async function chooseProducts() {
  const found = installedProducts();
  const installed = new Set([...found].filter((id) => AVAILABLE.includes(id)));
  const notOwned = [...found].filter((id) => !installed.has(id));
  if (notOwned.length) console.log(c.y(`! Not in your plan, so left as is: ${notOwned.map((id) => PRODUCTS[id].name).join(", ")}.`));
  const withInstalled = (picked) => new Set([...installed, ...picked]); // installed products are always kept (and updated)
  const fromFlag = opt("products");
  if (fromFlag) {
    const picked = fromFlag.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = picked.filter((x) => !IDS.includes(x));
    if (bad.length) die(`Unknown product(s): ${bad.join(", ")}. Use: ${IDS.join(", ")}`);
    const unowned = picked.filter((x) => !AVAILABLE.includes(x));
    if (unowned.length) die(`Not in your plan: ${unowned.map((x) => PRODUCTS[x].name).join(", ")}. You can install: ${AVAILABLE.join(", ")}`);
    return withInstalled(picked);
  }
  if (flag("all")) return new Set(AVAILABLE);
  if (flag("agent")) return withInstalled(["ds", ...(flag("with-ux") ? ["ux"] : [])].filter((id) => AVAILABLE.includes(id))); // legacy flags

  const remaining = AVAILABLE.filter((id) => !installed.has(id));
  if (installed.size) console.log(`\n${c.b("Installed here:")} ${[...installed].map((id) => PRODUCTS[id].name).join(", ")} ${c.d(installed.has("kit") ? "— agents update; the kit only if you say so" : "— these will be updated")}`);
  if (!remaining.length) { console.log(c.d("Every product is already installed.")); return installed; }

  console.log(`\n${c.b(installed.size ? "Add more products?" : "What do you want to install?")} ${c.d("(any combination)")}`);
  if (process.stdin.isTTY && !YES) {
    const picked = await checkboxes(remaining.map((id) => ({ id, ...PRODUCTS[id] })), installed.size || !remaining.includes("ds") ? [] : ["ds"]);
    if (!picked.length && !installed.size) die("Nothing chosen. Select at least one product with Space.");
    return withInstalled(picked);
  }
  // Non-interactive (piped answers): numbers, plus one more number for "Install all"
  remaining.forEach((id, k) => console.log(`  ${k + 1}) ${PRODUCTS[id].name.padEnd(16)} ${c.d(PRODUCTS[id].desc)}`));
  const allNo = remaining.length + 1;
  console.log(`  ${allNo}) ${"Install all".padEnd(16)} ${c.d("every product above")}`);
  const def = installed.size ? "" : "1";
  const a = await ask(`Choose numbers, comma-separated${def ? ` [${def}]` : " (Enter for none)"}: `, def);
  const nums = a.split(/[\s,]+/).filter(Boolean).map(Number);
  const picked = nums.includes(allNo) || /^all$/i.test(a) ? remaining : nums.map((n) => remaining[n - 1]).filter(Boolean);
  if (!picked.length && !installed.size) die(`Nothing chosen. Enter numbers 1–${allNo}, e.g. "1,4".`);
  return withInstalled(picked);
}

// ---- plan & write ------------------------------------------------------------------------
const plan = []; // { to, content, kind }
const results = { created: [], updated: [], same: [], kept: [], merged: [], conflicts: [], backups: [], removed: [] };

function stage(to, content, kind = "file") { plan.push({ to, content, kind }); }

// ---- three-way update (T-045) -------------------------------------------------------------
// base = what ds-base last installed for this file. With it, a client's edits and ds-base's
// changes merge; without a clean merge the client's file is never touched.
//   .ds-base/base/<path>      base copy written on every install/update
//   <path>.ds-base-update     new version saved beside a file that couldn't be merged
//   .ds-base/pending/<path>   that new version; once the client deletes the .ds-base-update
//                             file (= merged), it becomes the base.
// A file the client deleted stays deleted. The CLAUDE.md block follows the same rules as a file.
const BASE_DIR = ".ds-base/base", PENDING_DIR = ".ds-base/pending";
const SIDE = ".ds-base-update", BACKUP = ".ds-base-backup";
let prevLock = null;
const tokenNotes = { added: [], held: [], reset: [], fixes: [] };
try { prevLock = JSON.parse(readFileSync(join(HOST, ".ds-base.json"), "utf8")); } catch { /* first install */ }

const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const writeAt = (p, text) => { if (DRY) return; mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const removeAt = (p) => { if (!DRY && existsSync(p)) rmSync(p); };
const freeBackup = (abs) => { let p = abs + BACKUP; for (let n = 2; existsSync(p); n++) p = `${abs}${BACKUP}.${n}`; return p; };

function merge3(current, base, incoming) {
  const dir = join(tmpdir(), `ds-base-merge-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const [a, o, b] = ["current", "base", "incoming"].map((n) => join(dir, n));
  writeFileSync(a, current); writeFileSync(o, base); writeFileSync(b, incoming);
  try {
    return { ok: true, text: execSync(`git merge-file -p "${a}" "${o}" "${b}"`, { stdio: ["ignore", "pipe", "ignore"] }).toString() };
  } catch (e) {
    return { ok: false }; // conflicts (exit > 0) or git missing
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function apply() {
  for (const { to, content, kind } of plan) {
    const abs = join(HOST, to);
    const isBlock = kind === "block";
    const fileText = readIf(abs);
    const current = isBlock ? findBlock(fileText ?? "")?.text ?? null : fileText;
    const exists = current !== null;
    const write = (text) => writeAt(abs, isBlock ? putBlock(fileText ?? "", text) : text);
    if (kind === "ifMissing") { if (!exists) writeAt(abs, content); (exists ? results.same : results.created).push(to); continue; }
    if (kind === "tokens") { applyTokens(to, abs, fileText, content); continue; }
    const basePath = join(HOST, BASE_DIR, to), pendingPath = join(HOST, PENDING_DIR, to), side = abs + SIDE;
    const setBase = () => writeAt(basePath, content);
    let base = readIf(basePath);
    // A previous conflict the client has resolved (deleted the .ds-base-update file) → its version is the base
    const pending = readIf(pendingPath);
    if (pending !== null && !existsSync(side)) { base = pending; writeAt(basePath, pending); removeAt(pendingPath); }
    else if (pending !== null) {
      // still unresolved: refresh the saved new version and wait
      if (pending !== content) { writeAt(side, content); writeAt(pendingPath, content); }
      results.conflicts.push(to); continue;
    }

    if (!exists && base !== null && !isBlock && !FORCE) { results.removed.push(to); continue; } // the client deleted it
    if (!exists) { write(content); setBase(); results.created.push(to); continue; }
    if (current === content) { setBase(); results.same.push(to); continue; }
    if (FORCE) {
      if (base !== null && current === base) results.updated.push(to);
      else { writeAt(freeBackup(abs), current); results.backups.push(to); }
      write(content); setBase(); continue;
    }
    if (base !== null && current === base) { write(content); setBase(); results.updated.push(to); continue; }
    if (base !== null && content === base) { results.kept.push(to); continue; } // only the client changed it
    // Installs from before the block had a base: refresh it, keeping the old block as a backup.
    if (isBlock && base === null) { writeAt(freeBackup(abs), current); write(content); setBase(); results.backups.push(to); continue; }
    const m = base !== null ? merge3(current, base, content) : { ok: false };
    if (m.ok) { write(m.text); setBase(); results.merged.push(to); continue; }
    writeAt(side, content); writeAt(pendingPath, content); results.conflicts.push(to);
  }
}

// ---- token files: the project's values always stay (T-052) -----------------------------------
// An update never changes a token the project already has, edited or not. It only adds tokens
// (and new @utility/@keyframes blocks) that don't exist yet. Changed stock values are listed and
// applied only on request with --use-stock-tokens.
function cssParse(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length)); // blank comments, keep offsets
  const decls = [], blocks = [], names = new Set(), stack = [];
  let from = 0;
  const named = (stmt) => stmt.match(/^@(utility|keyframes|custom-variant)\s+([\w-]+)/);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = src.slice(from, i).trim(), n = named(prelude);
      if (n) names.add(`@${n[1]} ${n[2]}`);
      stack.push({ prelude, start: from + src.slice(from, i).search(/\S/), name: n && `@${n[1]} ${n[2]}` });
      from = i + 1;
    } else if (ch === "}") {
      const b = stack.pop();
      if (b?.name) blocks.push({ name: b.name, path: stack.map((x) => x.prelude), text: text.slice(b.start, i + 1) });
      from = i + 1;
    } else if (ch === ";") {
      const stmt = src.slice(from, i), n = named(stmt.trim());
      if (n) { names.add(`@${n[1]} ${n[2]}`); blocks.push({ name: `@${n[1]} ${n[2]}`, path: stack.map((x) => x.prelude), text: `${stmt.trim()};` }); }
      const m = stmt.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/);
      if (m && stack.length) decls.push({ path: stack.map((x) => x.prelude), prop: m[1], value: m[2], start: from + stmt.indexOf(m[2], stmt.indexOf(":")), end: from + stmt.indexOf(m[2], stmt.indexOf(":")) + m[2].length, inNamed: stack.some((x) => x.name) });
      from = i + 1;
    }
  }
  return { decls, blocks, names, props: new Set(decls.map((d) => d.prop)) };
}
const declKey = (d) => `${d.path.join(" › ")}|${d.prop}`;
const wrapIn = (path, inner) => path.reduceRight((body, prelude, k) => `${"  ".repeat(k)}${prelude} {\n${body}\n${"  ".repeat(k)}}`, inner);
const declLine = (d) => `${"  ".repeat(d.path.length)}${d.prop}: ${d.value};`;
function addNewTokens(current, incoming) {
  const cur = cssParse(current), inc = cssParse(incoming);
  const groups = new Map(), added = [];
  for (const d of inc.decls) {
    if (d.inNamed || cur.props.has(d.prop)) continue;
    const k = d.path.join(" › ");
    if (!groups.has(k)) groups.set(k, { path: d.path, lines: [] });
    groups.get(k).lines.push(declLine(d));
    added.push(d.prop);
  }
  const parts = [...groups.values()].map((g) => wrapIn(g.path, g.lines.join("\n")));
  for (const b of inc.blocks) if (!cur.names.has(b.name)) { parts.push(b.path.length ? wrapIn(b.path, b.text) : b.text); added.push(b.name); }
  if (!parts.length) return { text: current, added };
  return { text: `${current.trimEnd()}\n\n/* Added by ds-base ${version.slice(0, 7)}: new tokens only. Values above are never changed by updates (T-052). */\n${parts.join("\n\n")}\n`, added };
}
function stockChanges(base, incoming, current) {
  if (base === null) return [];
  const old = new Map(cssParse(base).decls.map((d) => [declKey(d), d]));
  const now = cssParse(current), mine = new Map(now.decls.map((d) => [declKey(d), d])), out = [];
  for (const d of cssParse(incoming).decls) {
    if (d.inNamed) continue;
    const k = declKey(d), was = old.get(k);
    if ((was && was.value !== d.value) || (!was && now.props.has(d.prop) && !mine.has(k)))
      out.push({ token: d.prop, where: d.path.at(-1), yours: mine.get(k)?.value ?? null, stock: d.value });
  }
  return out;
}
function useStock(current, incoming, names) {
  const want = (p) => names.includes(p.replace(/^--/, ""));
  const mine = new Map(cssParse(current).decls.map((d) => [declKey(d), d]));
  const edits = [], missing = [];
  for (const d of cssParse(incoming).decls) {
    if (!want(d.prop) || d.inNamed) continue;
    const have = mine.get(declKey(d));
    if (have && have.value !== d.value) edits.push({ ...have, value: d.value });
    else if (!have) missing.push(d);
  }
  let text = current;
  for (const e of edits.sort((x, y) => y.start - x.start)) text = text.slice(0, e.start) + e.value + text.slice(e.end);
  if (missing.length) text = `${text.trimEnd()}\n\n/* Stock values restored by ds-base ${version.slice(0, 7)} (--use-stock-tokens). */\n${missing.map((d) => wrapIn(d.path, declLine(d))).join("\n\n")}\n`;
  return { text, changed: [...new Set([...edits, ...missing].map((d) => d.prop))] };
}
const STOCK_TOKENS = (opt("use-stock-tokens") ?? "").split(",").map((x) => x.trim().replace(/^--/, "")).filter(Boolean);
// Stock fixes change selectors, not values (T-055). Offered while their pattern still matches; taken by ID.
const isFixId = (x) => /^[TP]-\d{3}$/i.test(x);
const fixPattern = (f) => new RegExp(f.find, "gm");
function applyFixes(to, text) {
  const out = { text, taken: [], open: [] };
  for (const f of (manifest.kit.fixes ?? []).filter((x) => x.file === to)) {
    if (!fixPattern(f).test(out.text)) continue;
    if (STOCK_TOKENS.includes("all") || STOCK_TOKENS.some((x) => x.toUpperCase() === f.id)) { out.text = out.text.replace(fixPattern(f), f.replace); out.taken.push(f.id); }
    else out.open.push({ id: f.id, file: to, what: f.what, effect: f.effect });
  }
  return out;
}
function applyTokens(to, abs, current, content) {
  const basePath = join(HOST, BASE_DIR, to), base = readIf(basePath);
  if (current === null) { writeAt(abs, content); writeAt(basePath, content); results.created.push(to); return; }
  let text = current;
  if (STOCK_TOKENS.length) {
    const r = STOCK_TOKENS.includes("all") ? { text: content, changed: ["every token"] } : useStock(current, content, STOCK_TOKENS.filter((x) => !isFixId(x)));
    if (r.text !== current) { writeAt(freeBackup(abs), current); results.backups.push(to); tokenNotes.reset.push(...r.changed.map((t) => `${t} (${to})`)); }
    text = r.text;
  }
  const fx = applyFixes(to, text);
  if (fx.taken.length && text === current) { writeAt(freeBackup(abs), current); results.backups.push(to); }
  tokenNotes.reset.push(...fx.taken.map((id) => `fix ${id} (${to})`));
  tokenNotes.fixes.push(...fx.open);
  text = fx.text;
  const r = addNewTokens(text, content);
  tokenNotes.added.push(...r.added);
  tokenNotes.held.push(...stockChanges(base, content, r.text).map((x) => ({ ...x, file: to })));
  if (r.text !== current) { writeAt(abs, r.text); results.updated.push(to); } else results.same.push(to);
  writeAt(basePath, content);
}

const BLOCK_START = "<!-- ds-base:start -->", BLOCK_END = "<!-- ds-base:end -->";
function claudeBlock(body) {
  return `${BLOCK_START}\n<!-- Managed by ds-base. Edits here are merged on update; project rules belong in docs/rules/ (L-###). -->\n${body.trim()}\n${BLOCK_END}\n`;
}
function findBlock(text) {
  const start = text.indexOf(BLOCK_START);
  const close = start < 0 ? -1 : text.indexOf(BLOCK_END, start);
  if (close < 0) return null;
  const stop = close + BLOCK_END.length;
  return { start, end: stop + (text[stop] === "\n" ? 1 : 0), text: `${text.slice(start, stop)}\n` };
}
function putBlock(text, block) {
  const found = findBlock(text);
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  return (text ? `${text.trimEnd()}\n\n` : "") + block;
}

// Pulls the reusable sections out of ds-base's own CLAUDE.md (single source of truth),
// leaving out repo-only sections such as local Commands.
// Table rows for agents/tools that weren't installed are dropped.
function extractClaudeSections(md, products) {
  const keep = ["What this is", "Where things are", "Tiers", "Non-negotiable rules", "Consumer agent quick guide"];
  const absent = [
    !products.has("ds") && "design-system-designer.md",
    !products.has("ux") && "ux-designer.md",
    !products.has("ux") && "components/ux-tools/",
    !products.has("brand") && "brand-designer.md",
    // Rows a project never needs in context: the agents have their own notes below, rule paths are
    // in "ds-base rules & updates", and the installer and contrast gate belong to ds-base itself.
    "Installer, client packages", "Contrast gate", "DS owner agent", "Brand designer agent", "UX designer agent", "Stock rules (", "Project rules in installed",
  ].filter(Boolean);
  const parts = md.split(/\n(?=## )/);
  const body = parts
    .filter((p) => keep.some((k) => p.startsWith(`## ${k}`)))
    .join("\n")
    .split("\n")
    .filter((l) => !(l.startsWith("|") && absent.some((a) => l.includes(a))))
    .join("\n");
  const owner = products.has("ds") ? "The **design-system-designer** agent (`.claude/agents/`) owns design-system decisions.\n\n" : "";
  return `## Design system (ds-base)\n${owner}${body.replace(/^## /gm, "### ")}`;
}

// Accessibility level (T-054): what the agents and checks enforce. Kept in .ds-base.json → a11yLevel.
// Existing installs keep theirs; installs from before this setting become AA (what they enforced already).
const LEVEL_IDS = ["A", "AA"];
const A_WARNING = "Level A has no contrast minimums, focus-visible or target-size rules. Most accessibility laws (EU Accessibility Act / EN 301 549, Section 508, ADA practice) reference AA.";
async function chooseA11yLevel() {
  const fromFlag = opt("a11y-level");
  if (fromFlag) {
    const v = fromFlag.trim().toUpperCase();
    if (!LEVEL_IDS.includes(v)) die(`Unknown accessibility level "${fromFlag}". Use: ${LEVEL_IDS.join(", ")}`);
    return v;
  }
  if (prevLock) return LEVEL_IDS.includes(prevLock.a11yLevel) ? prevLock.a11yLevel : "AA";
  if (!process.stdin.isTTY || YES) return "AA";
  console.log(`\n${c.b("Accessibility level")} ${c.d("(WCAG 2.2) — what the agents and checks enforce. Change it any time.")}`);
  console.log(`  1) A    ${c.d("minimum only: no contrast, focus-visible or target-size rules. Not enough for most laws.")}`);
  console.log(`  2) AA   ${c.d("recommended: the legal standard in most places (4.5:1 text, 3:1 UI, 24px targets)")}`);
  const a = (await ask("Choose [2]: ", "2")).toUpperCase();
  return { 1: "A", 2: "AA" }[a] ?? (LEVEL_IDS.includes(a) ? a : "AA");
}

// ---- main --------------------------------------------------------------------------------
console.log(`${c.b("ds-base installer")}  ${c.d(`source: ${source.label}`)}`);
const products = await chooseProducts();
const a11yLevel = await chooseA11yLevel();
const prevLevel = prevLock ? (LEVEL_IDS.includes(prevLock.a11yLevel) ? prevLock.a11yLevel : "AA") : null;
const has = (id) => products.has(id);
const mode = has("kit") ? "all" : "agent"; // kept in .ds-base.json — agents read it to know whether the kit is present
const manifest = JSON.parse(await source.read("install/manifest.json"));
const version = await source.version();
const base = detectBase();
const codePath = (p) => (base === "." ? p : `${base}/${p}`);
const skipStories = new RegExp(manifest.kit.skipPattern);
let repoFiles = null;
const listFiles = async () => (repoFiles ??= await source.list());
const stageDirs = async (dirs) => {
  for (const dir of dirs ?? [])
    for (const p of (await listFiles()).filter((f) => f.startsWith(dir + "/") && !skipStories.test(f))) stage(codePath(p), await source.read(p));
};

// Stock rules and the rule-index tool, for every product (T-052)
for (const p of manifest.shared?.root ?? []) stage(p, await source.read(p));
if ((has("ux") || has("brand")) && !has("ds"))
  console.log(c.y(`! ${[has("ux") && "UX", has("brand") && "Brand"].filter(Boolean).join(" and ")} Designer hand system changes to the DS Designer. Without it they list those requests for you instead.`));

// 1) DS Designer
if (has("ds")) for (const p of manifest.dsDesigner.root) stage(p, await source.read(p));
// 2) UX Designer — knowledge + self-contained tools (Dev Controls, ScreenTransition)
if (has("ux")) {
  for (const p of manifest.uxDesigner.root) stage(p, await source.read(p));
  await stageDirs(manifest.uxDesigner.codeDirs);
  for (const p of manifest.uxDesigner.ifMissing ?? []) stage(p, await source.read(p), "ifMissing"); // conventions evolve per project
}
// 3) Brand Designer
if (has("brand")) for (const p of manifest.brandDesigner.root) stage(p, await source.read(p));
// The project's own rules (docs/rules/, L-###), created once and never updated (T-045, T-052)
for (const [to, from] of Object.entries(manifest.hostTemplates ?? {})) if (!to.startsWith("$")) stage(to, await source.read(from), "ifMissing");
// 4) DS base kit — token files always update safely (additions only, T-052); components only when the user says so (T-045)
const kitInstalled = installedProducts().has("kit");
let updateKit = has("kit");
if (has("kit") && kitInstalled) {
  if (flag("update-kit")) updateKit = true;
  else if (flag("no-update-kit") || YES || !process.stdin.isTTY) updateKit = false;
  else {
    console.log(`\n${c.b("The DS base kit is already installed.")} ${c.d("Updating merges your edits; nothing is overwritten.")}`);
    updateKit = /^y/i.test(await ask("Update its components too? Your token values never change. [y/N]: ", "n"));
  }
}
const tokenFiles = new Set(manifest.kit.tokens ?? []);
if (has("kit")) for (const p of tokenFiles) stage(p, await source.read(p), "tokens");
const kitPaths = async () => [
  ...manifest.kit.root.filter((p) => !tokenFiles.has(p)), ...(manifest.kit.ifMissing ?? []), ...manifest.kit.code.map(codePath),
  ...(await listFiles()).filter((f) => manifest.kit.codeDirs.some((d) => f.startsWith(d + "/")) && !skipStories.test(f)).map(codePath),
];
const keptKitFiles = has("kit") && !updateKit ? await kitPaths() : []; // still installed, just not touched
if (updateKit) {
  const tw = allDeps.tailwindcss;
  if (!tw) console.log(c.y("! tailwindcss not found in package.json — the DS base kit needs Tailwind CSS v4."));
  else if (!/^[\^~]?4|^latest|^next/.test(tw)) console.log(c.y(`! tailwindcss ${tw} detected — ds-base tokens require v4 (@theme, @utility).`));
  for (const p of manifest.kit.root.filter((x) => !tokenFiles.has(x))) stage(p, await source.read(p));
  for (const p of manifest.kit.ifMissing ?? []) stage(p, await source.read(p), "ifMissing");
  for (const p of manifest.kit.code) stage(codePath(p), await source.read(p));
  await stageDirs(manifest.kit.codeDirs);
}

// One managed CLAUDE.md block for everything installed
const claudeParts = [];
if (has("kit")) claudeParts.push(extractClaudeSections(await source.read(manifest.kit.claudeSnippetFrom), products));
else if (has("ds")) claudeParts.push(await source.read(manifest.dsDesigner.claudeSnippet));
if (has("ux")) claudeParts.push(await source.read(manifest.uxDesigner.claudeSnippet));
if (has("brand")) claudeParts.push(await source.read(manifest.brandDesigner.claudeSnippet));
// How to update / add products — Claude reads this block in every session of the host project
const names = (ids) => ids.map((id) => PRODUCTS[id].name).join(", ");
const missingIds = AVAILABLE.filter((id) => !has(id));
if (manifest.rulesSnippet)
  claudeParts.push((await source.read(manifest.rulesSnippet))
    .replace("{{installed}}", names(IDS.filter(has)))
    .replace("{{missing}}", missingIds.length ? `not installed yet: ${names(missingIds)}` : "everything available is installed")
    .replaceAll("{{a11yLevel}}", a11yLevel)
    .replace("{{a11yWarning}}", a11yLevel === "A" ? `\n   - ⚠ ${A_WARNING} Treat AA criteria as strong recommendations.` : ""));
stage("CLAUDE.md", claudeBlock(claudeParts.join("\n")), "block");

// ---- moved files (T-052): stock rules now live in docs/ds-base/, project rules in docs/rules/ ----
const moveNotes = [], movedFrom = new Set();
const firstRulesRun = !!prevLock && !(prevLock.files ?? []).some((f) => f.startsWith("docs/ds-base/"));
for (const [from, to] of Object.entries(manifest.moved ?? {})) {
  if (from.startsWith("$")) continue;
  const abs = join(HOST, from);
  if (!existsSync(abs)) continue;
  movedFrom.add(from);
  const text = readFileSync(abs, "utf8");
  if (to.startsWith("docs/rules/")) { // project rules: move the L-entries, leave a pointer behind
    const rules = text.split(/\n(?=## L-\d+)/).slice(1).join("\n").trim();
    if (!rules) { if (firstRulesRun) moveNotes.push(`${from} has no rules of yours; new rules go in docs/rules/. You can delete it.`); continue; }
    const target = join(HOST, to);
    const header = readIf(target) ?? (await source.read(manifest.hostTemplates[to]));
    writeAt(target, `${header.trimEnd()}\n\n${rules}\n`);
    writeAt(abs, `# Moved\n\nThis project's rules moved to \`${to}\` (indexed in \`docs/rules/INDEX.md\`) when ds-base split stock and project rules (T-052). You can delete this file.\n`);
    moveNotes.push(`Your L-rules moved from ${from} to ${to}.`);
    continue;
  }
  const basePath = join(HOST, BASE_DIR, from), base = readIf(basePath);
  if (base !== null && text === base) { removeAt(abs); removeAt(basePath); moveNotes.push(`${from} → ${to} (stock, unchanged)`); continue; }
  const stockIds = new Set([...(await source.read(to)).matchAll(/^## ([TP]-\d+)/gm)].map((m) => m[1]));
  const yours = [...text.matchAll(/^## ([TP]-\d+)/gm)].map((m) => m[1]).filter((id) => !stockIds.has(id));
  moveNotes.push(`${from} has your edits, so it was kept. ds-base's copy is now ${to}.${yours.length ? ` Your own entries (${yours.join(", ")}) should become L-rules in docs/rules/.` : ""} Delete it once nothing you need is left in it.`);
}
if (existsSync(join(HOST, "docs/ux/CONVENTIONS.md"))) movedFrom.add("docs/ux/CONVENTIONS.md"); // project-owned since T-052
if (firstRulesRun && has("ux") && existsSync(join(HOST, "docs/ux/CONVENTIONS.md")))
  moveNotes.push("docs/ux/CONVENTIONS.md is yours. Stock conventions are now in docs/ds-base/ux/CONVENTIONS.md; move your own placements into docs/rules/ux.md as L-rules.");

apply();
if (!DRY && existsSync(join(HOST, "scripts/ds-rules.mjs"))) {
  try { execSync(`"${process.execPath}" scripts/ds-rules.mjs`, { cwd: HOST, stdio: "pipe" }); }
  catch (e) { console.log(c.y(`! The project rule index couldn't be rebuilt:\n${e.stdout}${e.stderr}`)); }
}

// ---- rules you override that changed upstream (T-045) --------------------------------------
// Fingerprints every ds-base rule (T-/P- entries, agent and playbook sections) into
// .ds-base/rules.json; on update, L-rules whose Overrides: point at a changed rule are reported.
const RULES = ".ds-base/rules.json";
const hash = (t) => createHash("sha256").update(t.trim()).digest("hex").slice(0, 16);
async function ruleFingerprints() {
  const out = {};
  const files = await listFiles();
  const read = async (p) => (files.includes(p) ? await source.read(p) : "");
  for (const p of ["docs/ds-base/DECISIONS.md", "docs/ds-base/PRODUCT_RULES.md", "tokens/DECISIONS.md", "docs/PRODUCT_RULES.md"])
    for (const part of (await read(p)).split(/\n(?=## [TP]-\d+)/)) { const id = part.match(/^## ([TP]-\d+)/)?.[1]; if (id) out[id.toLowerCase()] = hash(part); }
  for (const p of files.filter((f) => /^\.claude\/agents\/[^/]+\.md$/.test(f) || /(^|\/)ds-playbook\.md$/.test(f))) {
    const doc = p.split("/").pop().replace(/\.md$/, "");
    for (const part of (await read(p)).split(/\n(?=## )/)) { const h = part.match(/^## (.+)/)?.[1]; if (h) out[`${doc}#${h.trim()}`.toLowerCase()] = hash(part); }
  }
  return out;
}
const overrideNotes = [];
{
  const now = await ruleFingerprints();
  let before = null;
  try { before = JSON.parse(readFileSync(join(HOST, RULES), "utf8")); } catch { /* first run */ }
  const rulesDir = join(HOST, "docs/rules");
  const local = [join(HOST, "docs/agents/local-rules.md"), ...(existsSync(rulesDir) ? readdirSync(rulesDir).filter((f) => f.endsWith(".md")).map((f) => join(rulesDir, f)) : [])]
    .map((f) => readIf(f) ?? "").join("\n");
  if (before) for (const block of local.split(/\n(?=## L-\d+)/)) {
    const id = block.match(/^## (L-\d+)/)?.[1];
    const refs = (block.match(/\*{0,2}Overrides:\*{0,2}\s*(.+)/)?.[1] ?? "").split(",").map((r) => r.trim().replace(/`/g, "")).filter((r) => r && !/^none$/i.test(r));
    if (!id) continue;
    for (const ref of refs) {
      const key = ref.toLowerCase();
      const keys = Object.keys(before).filter((k) => k === key || k.startsWith(key)); // "ds-playbook#§4" matches "ds-playbook#§4 standard ux patterns"
      if (!keys.length) continue;
      const removed = keys.filter((k) => !(k in now)), changed = keys.filter((k) => k in now && now[k] !== before[k]);
      if (removed.length) overrideNotes.push(`${id} overrides ${ref}, which ds-base removed. Review: is ${id} still needed?`);
      else if (changed.length) overrideNotes.push(`${id} overrides ${ref}, which changed upstream. Your rule still applies. Review: keep, update or drop ${id}.`);
    }
  }
  writeAt(join(HOST, RULES), JSON.stringify(now, null, 1) + "\n");
}

// Files from the previous install that ds-base no longer ships (moved/removed upstream).
// Never deleted automatically — reported so the user can review and remove them.
let orphans = [];
try {
  const prev = JSON.parse(readFileSync(join(HOST, ".ds-base.json"), "utf8"));
  const now = new Set([...plan.map((p) => p.to), ...keptKitFiles]);
  orphans = (prev.files ?? []).filter((f) => !now.has(f) && !movedFrom.has(f) && existsSync(join(HOST, f)));
} catch { /* first install */ }

// Lock file — records what was installed (no secrets)
const lock = { repo: MODE === "local" ? "local" : MODE === "account" ? "account" : REPO, ref: MODE === "github" ? REF : undefined, version, products: IDS.filter(has), mode, a11yLevel, base, installedAt: new Date().toISOString(), files: [...new Set([...plan.map((p) => p.to), ...keptKitFiles])], baseDir: BASE_DIR };
if (!DRY) writeFileSync(join(HOST, ".ds-base.json"), JSON.stringify(lock, null, 2) + "\n");

// ---- report ------------------------------------------------------------------------------
const line = (label, list, color) => list.length && console.log(`${color(label.padEnd(10))} ${list.length}  ${c.d(list.slice(0, 6).join(", ") + (list.length > 6 ? ", …" : ""))}`);
console.log(`\n${c.b(DRY ? "Dry run — nothing written" : "Done")}  ${c.d(`${IDS.filter(has).map((id) => PRODUCTS[id].name).join(" + ")} · ${version.slice(0, 7)} · code base: ${base}`)}`);
line("created", results.created, c.g);
line("updated", results.updated, c.g);
line("unchanged", results.same, c.d);
line("merged", results.merged, c.g);
line("yours", results.kept, c.d);
line("backed up", results.backups, c.y);
line("to merge", results.conflicts, c.y);
line("deleted", results.removed, c.d);
if (orphans.length) {
  console.log(c.y(`  ${orphans.length} file(s) from your previous install aren't part of this install (product not chosen, or moved/removed upstream) — left in place:`));
  for (const f of orphans) console.log(c.y(`    ${f}`));
  console.log(c.y(`  Delete them once nothing imports them.`));
}
if (moveNotes.length) {
  console.log(c.b(`  Stock rules now live in docs/ds-base/ and your rules in docs/rules/ (T-052):`));
  for (const n of moveNotes) console.log(`    ${n}`);
}
if (tokenNotes.reset.length) console.log(c.g(`  Taken from stock: ${tokenNotes.reset.join(", ")}. Your previous file is saved beside it as *${BACKUP}.`));
if (tokenNotes.added.length) console.log(c.g(`  New tokens added: ${[...new Set(tokenNotes.added)].slice(0, 8).join(", ")}${tokenNotes.added.length > 8 ? ", …" : ""}. Your existing values were not changed.`));
{
  const file = join(HOST, ".ds-base/token-changes.json");
  // Keep earlier held-back values listed until the project takes them (or sets the stock value itself).
  const key = (x) => `${x.file}|${x.where}|${x.token}`;
  const fresh = new Map(tokenNotes.held.filter((x) => x.yours !== x.stock).map((x) => [key(x), x]));
  let earlier = [];
  try { earlier = JSON.parse(readFileSync(file, "utf8")).changes ?? []; } catch { /* none yet */ }
  for (const x of earlier) {
    if (fresh.has(key(x)) || !tokenFiles.has(x.file)) continue;
    const now = cssParse(readIf(join(HOST, x.file)) ?? "").decls.find((d) => d.prop === x.token && d.path.at(-1) === x.where);
    if (now && now.value !== x.stock) fresh.set(key(x), { ...x, yours: now.value });
  }
  const held = [...fresh.values()], fixes = tokenNotes.fixes;
  if (held.length || fixes.length) writeAt(file, JSON.stringify({ version, note: "Stock changes your token files don't have yet. Nothing was changed. Take one with --use-stock-tokens <token name or fix ID> (or all).", ...(fixes.length ? { fixes } : {}), changes: held }, null, 1) + "\n");
  else removeAt(file);
  if (fixes.length) {
    console.log(c.y(`  ${fixes.length} stock fix(es) not in your token files yet (nothing was changed):`));
    for (const f of fixes) console.log(c.y(`    ${f.id} (${f.file}): ${f.what}. Take it: --use-stock-tokens ${f.id}. Effect: ${f.effect}.`));
  }
  if (held.length) {
    console.log(c.y(`  ${held.length} stock token value(s) changed upstream; your values were kept:`));
    for (const x of held.slice(0, 6)) console.log(c.y(`    ${x.token} in ${x.where}: yours ${x.yours ?? "(not set here)"} · stock ${x.stock}`));
    if (held.length > 6) console.log(c.y(`    … and ${held.length - 6} more in .ds-base/token-changes.json`));
    console.log(c.y(`  To take any: --use-stock-tokens <name,name> or --use-stock-tokens all (preview with --dry-run; a backup is kept).`));
  }
}
if (overrideNotes.length) {
  console.log(c.y(`  Rules you override changed upstream (docs/rules/):`));

  for (const n of overrideNotes) console.log(c.y(`    ${n}`));
}
if (results.merged.length) console.log(c.g(`  ${results.merged.length} file(s) had your edits and ds-base changes merged automatically. Review with git diff.`));
if (results.backups.length) console.log(c.y(`  ${results.backups.length} file(s) were replaced; your versions are saved beside them as *${BACKUP}.`));
if (results.removed.length) console.log(c.d(`  ${results.removed.length} file(s) you deleted stayed deleted. To get one back, delete its copy in ${BASE_DIR}/ and run the installer again.`));
if (results.conflicts.length) {
  console.log(c.y(`  ${results.conflicts.length} file(s) couldn't be merged automatically and were left untouched. The new version is saved beside each:`));
  for (const f of results.conflicts) console.log(c.y(`    ${f}${SIDE}`));
  console.log(c.y(`  Merge what you want from it, then delete the ${SIDE} file. The next update treats it as merged.`));
  // Warn when an installed file imports one that's waiting to be merged — its API may not match.
  for (const kept of results.conflicts) {
    const name = kept.replace(/\.(tsx?|mjs)$/, "").split("/").pop();
    const users = plan.filter((p) => p.to !== kept && /\.(tsx?)$/.test(p.to) && new RegExp(`from ["'](\\./|@/components/ui/)${name}["']`).test(p.content)).map((p) => p.to.split("/").pop());
    if (users.length) console.log(c.y(`  ! ${users.join(", ")} import ${kept}, which is waiting to be merged — check its API matches.`));
  }
}

// Dependencies (kit and/or UX tools) & scripts (kit only)
if (keptKitFiles.length) console.log(c.d(`  DS base kit components left as-is. Update them with --update-kit. Token files only gained new tokens.`));
const wantDeps = [...(updateKit ? manifest.kit.dependencies : []), ...(has("ux") ? manifest.uxDesigner.dependencies ?? [] : [])];
const wantDev = updateKit ? manifest.kit.devDependencies : [];
if ((wantDeps.length || wantDev.length) && !DRY) {
  // Entries may be "name@range" (e.g. "@tanstack/react-table@^8"); presence is checked by name.
  const depName = (d) => d.replace(/^(@?[^@]+)@.*$/, "$1");
  const missing = [...new Set([...wantDeps, ...wantDev])].filter((d) => !allDeps[depName(d)]);
  const pm = existsSync(join(HOST, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(HOST, "yarn.lock")) ? "yarn" : existsSync(join(HOST, "bun.lock")) || existsSync(join(HOST, "bun.lockb")) ? "bun" : "npm";
  const add = pm === "npm" ? "install" : "add";
  const deps = [...new Set(wantDeps)].filter((d) => !allDeps[depName(d)]);
  const devs = wantDev.filter((d) => !allDeps[depName(d)]);
  if (missing.length) {
    const cmds = [deps.length && `${pm} ${add} ${deps.join(" ")}`, devs.length && `${pm} ${add} -D ${devs.join(" ")}`].filter(Boolean);
    const a = await ask(`\nInstall ${missing.length} missing package(s) with ${pm}? [Y/n]: `, "y");
    // A failed install never aborts the run (scripts and next steps still follow). npm peer-dependency
    // conflicts (ERESOLVE, often from optional peers) are retried once with --legacy-peer-deps.
    const run = (cmd) => { try { execSync(cmd, { stdio: "inherit", cwd: HOST }); return true; } catch { return false; } };
    if (/^y/i.test(a)) for (const cmd of cmds) {
      console.log(c.d(`$ ${cmd}`));
      if (run(cmd)) continue;
      if (pm === "npm") {
        const retry = `${cmd} --legacy-peer-deps`;
        console.log(c.y(`! npm couldn't resolve peer dependencies — retrying: ${retry}`));
        if (run(retry)) continue;
      }
      console.log(c.r(`✗ Package install failed. Fix the error above, then run:\n  ${cmd}`));
    }
    else console.log(`Run later:\n  ${cmds.join("\n  ")}`);
  }
}
if (updateKit && !DRY) {
  const pkg = JSON.parse(readFileSync(hostPkgPath, "utf8"));
  pkg.scripts ??= {};
  let added = 0;
  for (const [k, v] of Object.entries(manifest.kit.scripts)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; added++; }
  if (added) { writeFileSync(hostPkgPath, JSON.stringify(pkg, null, 2) + "\n"); console.log(c.g(`Added ${added} script(s): ${Object.keys(manifest.kit.scripts).join(", ")}`)); }
}

// Accessibility level (T-054)
console.log(`\n${c.b("Accessibility level:")} ${a11yLevel}${prevLevel && prevLevel !== a11yLevel ? c.y(`  (was ${prevLevel})`) : ""} ${c.d("— change with --a11y-level or a11yLevel in .ds-base.json")}`);
if (a11yLevel === "A") console.log(c.y(`! ${A_WARNING}`));
if (prevLevel && prevLevel !== a11yLevel) console.log(c.y(`! Record why the level changed: ask the design-system-designer to log it as an L-### in docs/rules/general.md.`));

// Next steps
console.log(`\n${c.b("Next")}`);
if (updateKit && !kitInstalled) {
  const cssRel = base === "." ? "tokens/tokens.css" : `${relative(base, ".")}/tokens/tokens.css`;
  console.log(`  • In your global CSS, replace ${c.b('@import "tailwindcss";')} with:\n       @import "${cssRel.startsWith(".") ? cssRel : "./" + cssRel}";  ${c.d("(adjust the path from your CSS file)")}\n       @import "${(cssRel.startsWith(".") ? cssRel : "./" + cssRel).replace("tokens.css", "themes.css")}";`);
  console.log(`    and remove shadcn's default :root/.dark color variables there — ds-base tokens replace them.`);
  console.log(`  • Pick a style on <html>, e.g. data-theme="sprint" data-primary="ink" data-surface="layered"`);
  console.log(`  • Wrap the app once in <TooltipProvider> (components/ui/tooltip).`);
  console.log(`  • Check: npm run ds:contrast && npm run ds:lint`);
}
if (has("ds")) console.log(`  • Design-system work: ask for the ${c.b("design-system-designer")} agent. On first use it inspects this project; its rules for this project go in docs/rules/.`);
if (has("ux")) {
  console.log(`  • UX work: ask for the ${c.b("ux-designer")} agent ("design the onboarding flow"). Specs go to docs/ux/.`);
  console.log(`  • Mount ${c.b("<DevControls />")} once at the app root (components/ux-tools, dev builds only).`);
}
if (missingIds.length) console.log(`  • ${c.b("Not installed yet:")} ${names(missingIds)}. Rerun the installer and pick them, or add ${c.b(`--products ${missingIds.join(",")}`)}.`);
if (has("brand")) console.log(`  • Brand work: ask for the ${c.b("brand-designer")} agent ("define our brand look from these references"). Profiles go to docs/brand/.`);
console.log(c.d(`\nInstalled files are recorded in .ds-base.json. Re-run the installer to update or add products. Nothing secret is stored in this project.`));
rl?.close();
