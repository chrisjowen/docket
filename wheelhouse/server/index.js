// Built by wheelhouse/build.mjs; do not edit. Run `pnpm build` in wheelhouse/.

// src/server.ts
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var DOCKET_FILE = ".docket.yaml";
var DEFAULT_ORIGINS = ["http://127.0.0.1:4310", "http://localhost:4310"];
var MCP_SERVER = { id: "docket", title: "Docket", service: "viewer", path: "/mcp" };
var CASEBOOK_SCHEMA = "wheelhouse-docket-casebook.v1";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var LOOPBACK = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
function pageOrigin(raw) {
  if (typeof raw !== "string") return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK.has(url.hostname)) return null;
  if (url.pathname !== "/" && url.pathname !== "" || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}
function readSettings(raw) {
  const abs = (value) => typeof value === "string" && path.isAbsolute(value);
  const command = (value) => abs(value) || typeof value === "string" && /^[\w-][\w.-]*$/.test(value);
  const roots = {};
  if (isRecord(raw.roots)) {
    for (const [id, dir] of Object.entries(raw.roots)) if (abs(dir)) roots[id] = dir;
  }
  const ports = {};
  if (isRecord(raw.ports)) {
    for (const [id, port] of Object.entries(raw.ports)) {
      if (typeof port === "number" && Number.isInteger(port) && port > 1023 && port < 65536) ports[id] = port;
    }
  }
  const given = Array.isArray(raw.origins) ? raw.origins.map(pageOrigin).filter((origin) => origin !== null) : [];
  return {
    bin: command(raw.bin) ? raw.bin : null,
    roots,
    ports,
    origins: given.length > 0 ? [...new Set(given)] : DEFAULT_ORIGINS
  };
}
function preferredPort(projectId) {
  let h = 2166136261;
  for (const c of projectId) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return 4381 + h % 400;
}
var shellWord = (s) => /^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
var viewerArgs = (port, origins) => [
  "open",
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--no-open",
  ...origins.flatMap((origin) => ["--allow-origin", origin])
];
var openCommand = (docket, root, port, origins) => `cd ${shellWord(root)} && ${[...docket, ...viewerArgs(port, origins).filter((arg) => arg !== "--no-open")].map(shellWord).join(" ")}`;
var allowsOrigins = (help) => /(^|\s)--allow-origin\b/m.test(help);
var versionOf = (stdout) => {
  const version = stdout.trim();
  return /^\d+\.\d+\.\d+[\w.+-]*$/.test(version) ? version : null;
};
var SHIPPED_DOCKET = fileURLToPath(new URL("../docket/", import.meta.url));
var shippedVersion = (dir) => {
  try {
    const { version } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
};
function shippedCli(dir = SHIPPED_DOCKET, node = process.execPath) {
  const cli = path.join(dir, "dist", "cli.js");
  const argv = [node, cli];
  const version = shippedVersion(dir);
  const info = { source: "plugin", version, command: argv.map(shellWord).join(" ") };
  if (version === null || !existsSync(cli)) {
    return {
      argv,
      info,
      problem: `The docket this plugin ships is missing from ${dir}. Update or reinstall the docket plugin, or set "bin" in its settings to a docket CLI.`
    };
  }
  return { argv, info, problem: null };
}
var asked = /* @__PURE__ */ new Map();
var ASK_TTL_MS = 6e4;
function clearCliCache() {
  asked.clear();
}
function configuredCli(ctx, bin, project) {
  const hit = asked.get(bin);
  if (hit && Date.now() - hit.at < ASK_TTL_MS) return hit.value;
  const run = (args) => ctx.exec({ argv: [bin, ...args], cwd: "project", project, timeoutMs: 5e3, maxBytes: 64 * 1024 });
  const value = Promise.all([run(["open", "--help"]), run(["--version"])]).then(([help, said]) => {
    const version = said.ok ? versionOf(said.stdout) : null;
    const cli = (problem) => ({ argv: [bin], info: { source: "settings", version, command: shellWord(bin) }, problem });
    const named = `The docket CLI the docket plugin\u2019s settings name (${bin}${version ? `, docket ${version}` : ""})`;
    const shipped = shippedVersion(SHIPPED_DOCKET);
    const instead = `remove "bin" to run the docket this plugin ships${shipped ? ` (${shipped})` : ""}`;
    if (help.ok) {
      return cli(
        allowsOrigins(help.stdout) ? null : `${named} is too old to be shown in Wheelhouse: its docket open cannot allow Wheelhouse\u2019s page (--allow-origin). Update it, or ${instead}.`
      );
    }
    if (/ENOENT/.test(help.reason)) return cli(`Wheelhouse could not find the docket CLI (${bin}) the docket plugin\u2019s settings name. Fix "bin", or ${instead}.`);
    if (/EACCES/.test(help.reason)) return cli(`${named} is not executable. Fix "bin", or ${instead}.`);
    const first = help.stderr.trim().split("\n")[0];
    return cli(`${named} could not be asked what it offers (${help.reason}${first ? `: ${first.slice(0, 200)}` : ""}).`);
  });
  asked.set(bin, { at: Date.now(), value });
  void value.then((cli) => {
    if (cli.problem && asked.get(bin)?.value === value) asked.delete(bin);
  });
  return value;
}
var docketCli = (ctx, settings, project) => settings.bin === null ? Promise.resolve(shippedCli()) : configuredCli(ctx, settings.bin, project);
var realRoot = (root) => {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
};
var rootOf = (project, settings) => {
  const configured = settings.roots[project.id];
  if (configured) return { root: configured, configured: true };
  return project.path && path.isAbsolute(project.path) ? { root: project.path, configured: false } : null;
};
async function casebook(ctx) {
  const project = ctx.project;
  if (!project) return { available: false, reason: "The casebook is about one project." };
  const settings = readSettings(ctx.settings);
  const where = rootOf(project, settings);
  if (!where) return { available: false, reason: "Firstmate has not recorded a clone for this project." };
  const base = { schema: CASEBOOK_SCHEMA, root: where.root, configuredRoot: where.configured, origins: settings.origins };
  const observedAt = (/* @__PURE__ */ new Date()).toISOString();
  const source = where.configured ? `the docket at ${where.root}, set in Wheelhouse\u2019s plugins file` : "the project\u2019s docket";
  if (!where.configured) {
    const marker = await ctx.readFile(DOCKET_FILE, { root: "project", maxBytes: 1, project: project.id });
    if (marker === null) return { available: true, value: { ...base, state: "none", problem: null, docket: null }, source: "the project clone", observedAt };
  }
  const cli = await docketCli(ctx, settings, project.id);
  return {
    available: true,
    value: { ...base, state: "docket", problem: cli.problem, docket: cli.info },
    source,
    observedAt
  };
}
async function viewer(ctx) {
  const project = ctx.project;
  if (!project) return { available: false, reason: "docket\u2019s viewer is about one project." };
  const settings = readSettings(ctx.settings);
  const where = rootOf(project, settings);
  if (!where) return { available: false, reason: "Firstmate has not recorded a clone for this project." };
  const port = settings.ports[project.id] ?? await ctx.servicePort(preferredPort(project.id), Object.values(settings.ports));
  const url = `http://127.0.0.1:${port}`;
  const cli = await docketCli(ctx, settings, project.id);
  const hint = openCommand(cli.argv, where.root, port, settings.origins);
  if (cli.problem) return { available: false, reason: cli.problem, hint };
  return {
    available: true,
    hint,
    spec: {
      url,
      health: `${url}/api/health`,
      identity: { url: `${url}/api/health`, path: ["root"], value: realRoot(where.root) },
      argv: [...cli.argv, ...viewerArgs(port, settings.origins)],
      cwd: where.root,
      binds: "loopback"
    }
  };
}
var plugin = {
  services: [{ id: "viewer", title: "docket\u2019s viewer", scope: "project", resolve: viewer }],
  providers: [{ id: "casebook", scope: "project", ttlMs: 3e4, timeoutMs: 8e3, fetch: casebook }],
  contributions: [
    {
      slot: "project.tab",
      id: "casebook",
      title: "Docket",
      provider: "casebook",
      render: { element: "docket-casebook" }
    }
  ],
  mcpServers: [{ ...MCP_SERVER }]
};
var server_default = plugin;
export {
  CASEBOOK_SCHEMA,
  DEFAULT_ORIGINS,
  MCP_SERVER,
  SHIPPED_DOCKET,
  allowsOrigins,
  clearCliCache,
  server_default as default,
  openCommand,
  pageOrigin,
  preferredPort,
  readSettings,
  shippedCli,
  versionOf,
  viewerArgs
};
