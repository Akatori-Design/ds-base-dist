#!/usr/bin/env node
// ds-base installer — installs any of four products into the project in the current
// directory: 1) DS Designer  2) UX Designer  3) Brand Designer  (agents)  4) DS base kit.
// Zero dependencies (Node 18+).
//
// Clients: install from the public dist repo with a password (no repo access, T-043).
//   curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs
//   node /tmp/ds-base-init.mjs            # asks for the password (hidden), then which products
// Password from DS_BASE_PASSWORD or the hidden prompt; never stored or printed.
//
// Owner: install straight from the private repo with DS_BASE_TOKEN (or --github to be asked for it).
//
// Options:
//   --products ds,ux,brand,kit   pick products without the question (any combination)
//   --all                 all four products
//   --agent               legacy: DS Designer only · --with-ux / --no-ux: legacy add/skip UX Designer
//   --bundle <url|path>   encrypted bundle to install (default: the public dist repo)
//   --github              install from the private repo with a GitHub token (owner)
//   --ref <branch|tag>    version to install with --github (default: main)
//   --repo <owner/name>   default: Akatori-Design/ds-base
//   --source <dir>        install from a local checkout instead of GitHub (no token needed)
//   --dir <path>          code base dir in the host (default: src/ if the host uses it, else .)
//   --force               overwrite files that differ (default: keep yours, report them)
//   --dry-run             show what would change, write nothing
//   --yes                 accept defaults (install dependencies, add scripts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createDecipheriv, scryptSync } from "node:crypto";
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
let PASSWORD = process.env.DS_BASE_PASSWORD;
const BUNDLE = opt("bundle", "https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/ds-base.bundle");
const MODE = SOURCE ? "local" : TOKEN || flag("github") ? "github" : "bundle";

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

// Encrypted bundle: "DSB1" | salt(16) | iv(12) | tag(16) | ciphertext (built by install/publish.mjs)
let bundleData = null;
async function loadBundle() {
  if (bundleData) return bundleData;
  let raw;
  if (/^https?:/.test(BUNDLE)) {
    const res = await fetch(BUNDLE, { headers: { "User-Agent": "ds-base-init" } });
    if (!res.ok) die(`Couldn't download the install bundle (${res.status}) from ${BUNDLE}.`);
    raw = Buffer.from(await res.arrayBuffer());
  } else raw = readFileSync(BUNDLE);
  if (raw.subarray(0, 4).toString() !== "DSB1") die("That file isn't a ds-base bundle.");
  const salt = raw.subarray(4, 20), iv = raw.subarray(20, 32), tag = raw.subarray(32, 48);
  const key = scryptSync(PASSWORD, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    bundleData = JSON.parse(gunzipSync(Buffer.concat([d.update(raw.subarray(48)), d.final()])).toString("utf8"));
  } catch { die("Wrong password (or a damaged bundle)."); }
  return bundleData;
}

const source = MODE === "bundle"
  ? {
      label: /^https?:/.test(BUNDLE) ? "ds-base install bundle" : `bundle ${resolve(BUNDLE)}`,
      version: async () => (await loadBundle()).version,
      list: async () => Object.keys((await loadBundle()).files),
      read: async (p) => { const f = (await loadBundle()).files[p]; if (f === undefined) die(`Bundle is missing ${p}.`); return f; },
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
if (MODE === "bundle" && !PASSWORD) {
  if (!process.stdin.isTTY) die("No password. Set DS_BASE_PASSWORD, or run the installer in a terminal to be asked.");
  console.log(`${c.b("Install password")} ${c.d("— from whoever gave you access. Input is hidden and never stored.")}`);
  PASSWORD = await readHidden("Password: ");
  if (!PASSWORD) die("No password entered.");
}
if (MODE === "bundle") await loadBundle(); // check the password before asking anything else
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
  const installed = installedProducts();
  const withInstalled = (picked) => new Set([...installed, ...picked]); // installed products are always kept (and updated)
  const fromFlag = opt("products");
  if (fromFlag) {
    const picked = fromFlag.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = picked.filter((x) => !IDS.includes(x));
    if (bad.length) die(`Unknown product(s): ${bad.join(", ")}. Use: ${IDS.join(", ")}`);
    return withInstalled(picked);
  }
  if (flag("all")) return new Set(IDS);
  if (flag("agent")) return withInstalled(["ds", ...(flag("with-ux") ? ["ux"] : [])]); // legacy flags

  const remaining = IDS.filter((id) => !installed.has(id));
  if (installed.size) console.log(`\n${c.b("Installed here:")} ${[...installed].map((id) => PRODUCTS[id].name).join(", ")} ${c.d("— these will be updated")}`);
  if (!remaining.length) { console.log(c.d("Every product is already installed.")); return installed; }

  console.log(`\n${c.b(installed.size ? "Add more products?" : "What do you want to install?")} ${c.d("(any combination)")}`);
  if (process.stdin.isTTY && !YES) {
    const picked = await checkboxes(remaining.map((id) => ({ id, ...PRODUCTS[id] })), installed.size ? [] : ["ds"]);
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
const results = { created: [], updated: [], same: [], kept: [] };

function stage(to, content, kind = "file") { plan.push({ to, content, kind }); }

function apply() {
  for (const { to, content, kind } of plan) {
    const abs = join(HOST, to);
    const exists = existsSync(abs);
    const current = exists ? readFileSync(abs, "utf8") : null;
    if (exists && current === content) { results.same.push(to); continue; }
    if (exists && kind === "ifMissing") { results.same.push(to); continue; }
    if (exists && kind !== "managed" && !FORCE) { results.kept.push(to); continue; }
    if (!DRY) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); }
    (exists ? results.updated : results.created).push(to);
  }
}

function claudeBlock(body) {
  const start = "<!-- ds-base:start -->", end = "<!-- ds-base:end -->";
  const block = `${start}\n<!-- Managed by ds-base installer; edits inside this block are replaced on update. -->\n${body.trim()}\n${end}\n`;
  const p = join(HOST, "CLAUDE.md");
  const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (cur.includes(start) && cur.includes(end)) return cur.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n?`), block);
  return (cur ? cur.trimEnd() + "\n\n" : "") + block;
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

// ---- main --------------------------------------------------------------------------------
console.log(`${c.b("ds-base installer")}  ${c.d(`source: ${source.label}`)}`);
const products = await chooseProducts();
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
// Agents without the kit get an empty decision log and product rules (created once)
if (!has("kit") && (has("ds") || has("ux") || has("brand")))
  for (const [to, from] of Object.entries(manifest.agentTemplates)) if (!to.startsWith("$")) stage(to, await source.read(from), "ifMissing");
// 4) DS base kit
if (has("kit")) {
  const tw = allDeps.tailwindcss;
  if (!tw) console.log(c.y("! tailwindcss not found in package.json — the DS base kit needs Tailwind CSS v4."));
  else if (!/^[\^~]?4|^latest|^next/.test(tw)) console.log(c.y(`! tailwindcss ${tw} detected — ds-base tokens require v4 (@theme, @utility).`));
  for (const p of manifest.kit.root) stage(p, await source.read(p));
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
stage("CLAUDE.md", claudeBlock(claudeParts.join("\n")), "managed");

apply();

// Files from the previous install that ds-base no longer ships (moved/removed upstream).
// Never deleted automatically — reported so the user can review and remove them.
let orphans = [];
try {
  const prev = JSON.parse(readFileSync(join(HOST, ".ds-base.json"), "utf8"));
  const now = new Set(plan.map((p) => p.to));
  orphans = (prev.files ?? []).filter((f) => !now.has(f) && existsSync(join(HOST, f)));
} catch { /* first install */ }

// Lock file — records what was installed (no secrets)
const lock = { repo: MODE === "local" ? "local" : MODE === "bundle" ? "bundle" : REPO, ref: MODE === "github" ? REF : undefined, version, products: IDS.filter(has), mode, base, installedAt: new Date().toISOString(), files: plan.map((p) => p.to) };
if (!DRY) writeFileSync(join(HOST, ".ds-base.json"), JSON.stringify(lock, null, 2) + "\n");

// ---- report ------------------------------------------------------------------------------
const line = (label, list, color) => list.length && console.log(`${color(label.padEnd(10))} ${list.length}  ${c.d(list.slice(0, 6).join(", ") + (list.length > 6 ? ", …" : ""))}`);
console.log(`\n${c.b(DRY ? "Dry run — nothing written" : "Done")}  ${c.d(`${IDS.filter(has).map((id) => PRODUCTS[id].name).join(" + ")} · ${version.slice(0, 7)} · code base: ${base}`)}`);
line("created", results.created, c.g);
line("updated", results.updated, c.g);
line("unchanged", results.same, c.d);
line("kept yours", results.kept, c.y);
if (orphans.length) {
  console.log(c.y(`  ${orphans.length} file(s) from your previous install aren't part of this install (product not chosen, or moved/removed upstream) — left in place:`));
  for (const f of orphans) console.log(c.y(`    ${f}`));
  console.log(c.y(`  Delete them once nothing imports them.`));
}
if (results.kept.length) {
  console.log(c.y(`  ${results.kept.length} existing file(s) differ and were left as-is. Re-run with --force to overwrite (review with git diff after).`));
  // Warn when installed files import a file the user kept — its API may not match.
  for (const kept of results.kept) {
    const name = kept.replace(/\.(tsx?|mjs)$/, "").split("/").pop();
    const users = plan.filter((p) => p.to !== kept && /\.(tsx?)$/.test(p.to) && new RegExp(`from ["'](\\./|@/components/ui/)${name}["']`).test(p.content)).map((p) => p.to.split("/").pop());
    if (users.length) console.log(c.y(`  ! ${users.join(", ")} import ${kept} — your version is kept, so check it exposes the same API (or use --force).`));
  }
}

// Dependencies (kit and/or UX tools) & scripts (kit only)
const wantDeps = [...(has("kit") ? manifest.kit.dependencies : []), ...(has("ux") ? manifest.uxDesigner.dependencies ?? [] : [])];
const wantDev = has("kit") ? manifest.kit.devDependencies : [];
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
if (has("kit") && !DRY) {
  const pkg = JSON.parse(readFileSync(hostPkgPath, "utf8"));
  pkg.scripts ??= {};
  let added = 0;
  for (const [k, v] of Object.entries(manifest.kit.scripts)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; added++; }
  if (added) { writeFileSync(hostPkgPath, JSON.stringify(pkg, null, 2) + "\n"); console.log(c.g(`Added ${added} script(s): ${Object.keys(manifest.kit.scripts).join(", ")}`)); }
}

// Next steps
console.log(`\n${c.b("Next")}`);
if (has("kit")) {
  const cssRel = base === "." ? "tokens/tokens.css" : `${relative(base, ".")}/tokens/tokens.css`;
  console.log(`  • In your global CSS, replace ${c.b('@import "tailwindcss";')} with:\n       @import "${cssRel.startsWith(".") ? cssRel : "./" + cssRel}";  ${c.d("(adjust the path from your CSS file)")}\n       @import "${(cssRel.startsWith(".") ? cssRel : "./" + cssRel).replace("tokens.css", "themes.css")}";`);
  console.log(`    and remove shadcn's default :root/.dark color variables there — ds-base tokens replace them.`);
  console.log(`  • Pick a style on <html>, e.g. data-theme="sprint" data-primary="ink" data-surface="layered" data-radius="soft"`);
  console.log(`  • Wrap the app once in <TooltipProvider> (components/ui/tooltip).`);
  console.log(`  • Check: npm run ds:contrast && npm run ds:lint`);
}
if (has("ds")) console.log(`  • Design-system work: ask for the ${c.b("design-system-designer")} agent. On first use it inspects this project and fills tokens/DECISIONS.md as decisions are made.`);
if (has("ux")) {
  console.log(`  • UX work: ask for the ${c.b("ux-designer")} agent ("design the onboarding flow"). Specs go to docs/ux/.`);
  console.log(`  • Mount ${c.b("<DevControls />")} once at the app root (components/ux-tools, dev builds only).`);
}
if (has("brand")) console.log(`  • Brand work: ask for the ${c.b("brand-designer")} agent ("define our brand look from these references"). Profiles go to docs/brand/.`);
console.log(c.d(`\nInstalled files are recorded in .ds-base.json. Re-run the installer to update or add products; your password or token is never stored.`));
rl?.close();
