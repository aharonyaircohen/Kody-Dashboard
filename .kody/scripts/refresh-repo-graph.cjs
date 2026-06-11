#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const dryRun = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");
const root = process.cwd();
const reportPath = ".kody/reports/repo-graph.md";

function exists(p) {
  return fs.existsSync(path.join(root, p));
}

function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}

function list(dir, pred = () => true) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter(pred)
    .map((e) => e.name)
    .sort();
}

function slugOf(name) {
  return name.replace(/\.(md|json)$/i, "");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const out = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function listValue(value) {
  if (!value) return [];
  const trimmed = String(value).trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function headings(text) {
  return text
    .split(/\r?\n/)
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line))
    .filter(Boolean)
    .map((m) => m[2].trim());
}

function hash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function q(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function scalarYaml(value) {
  if (Array.isArray(value)) return `[${value.map((v) => `"${q(v)}"`).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `"${q(value ?? "")}"`;
}

function objectYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  return Object.entries(value)
    .flatMap(([key, val]) => {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        return [`${pad}${key}:`, objectYaml(val, indent + 2)];
      }
      return [`${pad}${key}: ${scalarYaml(val)}`];
    })
    .join("\n");
}

function gh(args, opts = {}) {
  const res = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const err = new Error((res.stderr || res.stdout || "gh failed").trim());
    err.status = res.status;
    err.stderr = res.stderr || "";
    err.stdout = res.stdout || "";
    throw err;
  }
  return res.stdout.trim();
}

function isRateLimit(err) {
  const text = `${err.message || ""}\n${err.stderr || ""}\n${err.stdout || ""}`;
  return /rate limit|secondary rate limit|API rate limit exceeded/i.test(text);
}

function currentReportHash() {
  if (!exists(reportPath)) return null;
  const m = /graphHash:\s*"?([a-f0-9]{64})"?/i.exec(read(reportPath));
  return m?.[1] ?? null;
}

const contexts = list(".kody/context", (e) => e.isFile() && e.name.endsWith(".md"))
  .map((name) => {
    const body = read(`.kody/context/${name}`);
    return {
      slug: slugOf(name),
      frontmatter: parseFrontmatter(body),
      headings: headings(body),
    };
  });

const duties = list(".kody/duties", (e) => e.isFile() && e.name.endsWith(".md"))
  .map((name) => {
    const body = read(`.kody/duties/${name}`);
    const frontmatter = parseFrontmatter(body);
    return {
      slug: slugOf(name),
      frontmatter,
      headings: headings(body),
      staff: frontmatter.staff || null,
      executables: listValue(frontmatter.executables),
      readsFrom: listValue(frontmatter.reads_from),
      writesTo: listValue(frontmatter.writes_to),
      disabled: frontmatter.disabled === "true",
    };
  });

const staff = list(".kody/staff", (e) => e.isFile() && e.name.endsWith(".md"))
  .map((name) => {
    const body = read(`.kody/staff/${name}`);
    return {
      slug: slugOf(name),
      frontmatter: parseFrontmatter(body),
      headings: headings(body),
    };
  });

const executables = list(".kody/executables", (e) => e.isDirectory())
  .filter((slug) => exists(`.kody/executables/${slug}/profile.json`))
  .map((slug) => {
    let profile = {};
    try {
      profile = JSON.parse(read(`.kody/executables/${slug}/profile.json`));
    } catch {}
    const scripts = (profile.scripts && typeof profile.scripts === "object")
      ? profile.scripts
      : {};
    const preflight = Array.isArray(scripts.preflight) ? scripts.preflight : [];
    const cc = (profile.claudeCode && typeof profile.claudeCode === "object")
      ? profile.claudeCode
      : {};
    return {
      slug,
      describe: profile.describe || "",
      role: profile.role || "",
      kind: profile.kind || "",
      staff: profile.staff || null,
      skills: Array.isArray(cc.skills) ? cc.skills.filter(Boolean) : [],
      shellScripts: preflight
        .map((step) => step && step.shell)
        .filter((name) => typeof name === "string" && name.length > 0),
    };
  });

const scripts = [
  ...list(".kody/scripts", (e) => e.isFile()).map((name) => ({
    slug: slugOf(name),
    path: `.kody/scripts/${name}`,
    scope: "repo",
  })),
  ...executables.flatMap((executable) =>
    executable.shellScripts.map((name) => ({
      slug: `${executable.slug}/${name}`,
      path: `.kody/executables/${executable.slug}/${name}`,
      scope: "executable",
    }))
  ),
];

const skills = executables.flatMap((executable) =>
  executable.skills.map((name) => ({
    slug: `${executable.slug}/${name}`,
    name,
    path: `.kody/executables/${executable.slug}/skills/${name}/SKILL.md`,
    scope: "executable",
  }))
);

const reports = list(".kody/reports", (e) => e.isFile() && e.name.endsWith(".md"))
  .map((name) => ({ slug: slugOf(name) }));

let goalIssues = [];
let rateLimited = false;
try {
  const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,title,labels,state"]);
  goalIssues = JSON.parse(raw)
    .filter((issue) => (issue.labels || []).some((l) => String(l.name || "").startsWith("goal:")))
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      goals: (issue.labels || []).map((l) => l.name).filter((n) => String(n).startsWith("goal:")),
    }));
} catch (err) {
  if (isRateLimit(err)) rateLimited = true;
}

const referencedStaff = new Set();
duties.forEach((d) => d.staff && referencedStaff.add(d.staff));
executables.forEach((e) => e.staff && referencedStaff.add(e.staff));
contexts.forEach((c) => {
  const refs = listValue(c.frontmatter.staff);
  if (refs.includes("*")) staff.forEach((s) => referencedStaff.add(s.slug));
  refs.forEach((s) => referencedStaff.add(s));
});

const readRefs = new Map();
duties.forEach((d) => d.readsFrom.forEach((r) => {
  if (!readRefs.has(r)) readRefs.set(r, []);
  readRefs.get(r).push(d.slug);
}));

const slugSets = {
  context: new Set(contexts.map((c) => c.slug)),
  duty: new Set(duties.map((d) => d.slug)),
  staff: new Set(staff.map((s) => s.slug)),
  executable: new Set(executables.map((e) => e.slug)),
  script: new Set(scripts.map((s) => s.slug)),
  skill: new Set(skills.map((s) => s.slug)),
  report: new Set(reports.map((r) => r.slug)),
};

function refSlug(ref) {
  return String(ref || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\.kody\//, "")
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function refId(ref, preferredType = "") {
  const value = String(ref || "").trim().replace(/^["']|["']$/g, "");
  const slug = refSlug(value);
  if (!slug) return "";
  if (value.startsWith("goal:")) return `goal:${value.slice("goal:".length)}`;
  if (/^(?:\.kody\/)?context\//.test(value)) return `context:${slug}`;
  if (/^(?:\.kody\/)?duties\//.test(value)) return `duty:${slug}`;
  if (/^(?:\.kody\/)?staff\//.test(value)) return `staff:${slug}`;
  if (/^(?:\.kody\/)?executables\//.test(value)) return `executable:${slug}`;
  if (/^(?:\.kody\/)?scripts\//.test(value)) return `script:${slug}`;
  if (/^(?:\.kody\/)?reports\//.test(value)) return `report:${slug}`;
  if (preferredType) {
    return `${preferredType}:${slug}`;
  }
  for (const type of ["context", "duty", "staff", "executable", "script", "skill", "report"]) {
    if (slugSets[type].has(slug)) return `${type}:${slug}`;
  }
  return `external:${value}`;
}

function addUnique(items, item) {
  if (!item.id || items.some((existing) => existing.id === item.id)) return;
  items.push(item);
}

const nodes = [];
contexts.forEach((c) => addUnique(nodes, {
  id: `context:${c.slug}`,
  type: "context",
  slug: c.slug,
  staff: listValue(c.frontmatter.staff),
  headingCount: c.headings.length,
}));
duties.forEach((d) => addUnique(nodes, {
  id: `duty:${d.slug}`,
  type: "duty",
  slug: d.slug,
  staff: d.staff,
  executables: d.executables,
  readsFrom: d.readsFrom,
  writesTo: d.writesTo,
  disabled: d.disabled,
}));
staff.forEach((s) => addUnique(nodes, {
  id: `staff:${s.slug}`,
  type: "staff",
  slug: s.slug,
  headingCount: s.headings.length,
}));
executables.forEach((e) => addUnique(nodes, {
  id: `executable:${e.slug}`,
  type: "executable",
  slug: e.slug,
  role: e.role,
  kind: e.kind,
  staff: e.staff,
  skills: e.skills,
  shellScripts: e.shellScripts,
  describe: e.describe,
}));
scripts.forEach((s) => addUnique(nodes, {
  id: `script:${s.slug}`,
  type: "script",
  slug: s.slug,
  path: s.path,
  scope: s.scope,
}));
skills.forEach((s) => addUnique(nodes, {
  id: `skill:${s.slug}`,
  type: "skill",
  slug: s.slug,
  name: s.name,
  path: s.path,
  scope: s.scope,
}));
reports.forEach((r) => addUnique(nodes, {
  id: `report:${r.slug}`,
  type: "report",
  slug: r.slug,
}));
const goalLabels = [...new Set(goalIssues.flatMap((issue) => issue.goals))].sort();
goalLabels.forEach((label) => addUnique(nodes, {
  id: `goal:${label.replace(/^goal:/, "")}`,
  type: "goal",
  slug: label.replace(/^goal:/, ""),
  label,
}));
goalIssues.forEach((issue) => addUnique(nodes, {
  id: `issue:${issue.number}`,
  type: "issue",
  number: issue.number,
  title: issue.title,
  state: issue.state,
}));

const edges = [];
function addEdge(from, to, relation, data = {}) {
  if (!from || !to) return;
  const id = `${from}->${relation}->${to}`;
  if (edges.some((edge) => edge.id === id)) return;
  edges.push({ id, from, to, relation, ...data });
}

contexts.forEach((c) => {
  const audience = listValue(c.frontmatter.staff);
  const targets = audience.includes("*") ? staff.map((s) => s.slug) : audience;
  targets.forEach((target) => addEdge(`context:${c.slug}`, refId(target, "staff"), "audience"));
});
duties.forEach((d) => {
  addEdge(`duty:${d.slug}`, refId(d.staff, "staff"), "assigned_to");
  d.executables.forEach((executable) =>
    addEdge(`duty:${d.slug}`, refId(executable, "executable"), "runs")
  );
  d.readsFrom.forEach((source) =>
    addEdge(`duty:${d.slug}`, refId(source, "context"), "reads_from")
  );
  d.writesTo.forEach((target) =>
    addEdge(`duty:${d.slug}`, refId(target, "report"), "writes_to")
  );
});
executables.forEach((e) =>
  addEdge(`executable:${e.slug}`, refId(e.staff, "staff"), "runs_as")
);
executables.forEach((e) => {
  e.skills.forEach((skill) =>
    addEdge(`executable:${e.slug}`, `skill:${e.slug}/${skill}`, "uses_skill")
  );
  e.shellScripts.forEach((script) =>
    addEdge(`executable:${e.slug}`, `script:${e.slug}/${script}`, "runs_preflight")
  );
});
goalIssues.forEach((issue) => {
  issue.goals.forEach((goal) =>
    addEdge(`issue:${issue.number}`, `goal:${goal.replace(/^goal:/, "")}`, "labeled")
  );
});

edges.forEach((edge) => {
  if (nodes.some((node) => node.id === edge.to)) return;
  const [type, slug] = edge.to.split(/:(.*)/s);
  addUnique(nodes, { id: edge.to, type: type || "external", slug: slug || edge.to, missing: true });
});

const modeledDirs = new Set(["context", "duties", "staff", "executables", "reports", "scripts"]);
const coverageGaps = list(".kody", (e) => e.isDirectory())
  .filter((name) => !modeledDirs.has(name));

const graph = {
  schemaVersion: 1,
  nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
  coverageGaps,
};
const graphHash = hash(graph);
const previousHash = currentReportHash();

if (previousHash === graphHash) {
  console.log(`DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- No report write needed; repo graph was unchanged.`);
  process.exit(0);
}

const findings = [
  {
    id: "repo-graph.snapshot",
    severity: "info",
    title: "Graph snapshot emitted",
    data: {
      nodeCounts: {
        context: contexts.length,
        duties: duties.length,
        staff: staff.length,
        executables: executables.length,
        reports: reports.length,
        scripts: scripts.length,
        skills: skills.length,
        goals: new Set(goalIssues.flatMap((i) => i.goals)).size,
        issues: goalIssues.length,
      },
      graphHash,
    },
  },
];

for (const s of staff) {
  if (!referencedStaff.has(s.slug)) {
    findings.push({
      id: "repo-graph.orphan-staff",
      severity: "medium",
      title: `${s.slug} - no duty, context, or executable references it`,
      data: { staff: s.slug },
    });
  }
}

for (const c of contexts) {
  if (!readRefs.has(c.slug)) {
    findings.push({
      id: "repo-graph.stale-context",
      severity: "low",
      title: `${c.slug} - not declared as reads_from by any duty`,
      data: { context: c.slug },
    });
  }
}

for (const d of duties) {
  const referencedBy = readRefs.get(d.slug) || [];
  if (d.disabled && referencedBy.length > 0) {
    findings.push({
      id: "repo-graph.disabled-but-referenced",
      severity: "high",
      title: `${d.slug} - disabled but named in another duty's reads_from`,
      data: { slug: d.slug, referencedBy },
    });
  }
}

for (const subfolder of coverageGaps) {
  findings.push({
    id: "repo-graph.coverage-gap",
    severity: "info",
    title: `${subfolder} - present in .kody/ but has no nodes`,
    data: { subfolder: `.kody/${subfolder}` },
  });
}

if (rateLimited) {
  findings.push({
    id: "repo-graph.rate-limited",
    severity: "low",
    title: "Skipped issue scan - gh rate limit hit during refresh",
    data: { graphHash },
  });
}

const generatedAt = new Date().toISOString();
const frontmatter = [
  "---",
  "slug: repo-graph",
  `generatedAt: "${generatedAt}"`,
  "findings:",
  ...findings.flatMap((finding) => [
    `  - id: ${finding.id}`,
    `    severity: ${finding.severity}`,
    `    title: "${q(finding.title)}"`,
    `    data:`,
    objectYaml(finding.data, 6),
  ]),
  "---",
].join("\n");

const body = `${frontmatter}

# Repo Graph

| Node type | Count |
|---|---:|
| Context | ${contexts.length} |
| Duties | ${duties.length} |
| Staff | ${staff.length} |
| Executables | ${executables.length} |
| Scripts | ${scripts.length} |
| Skills | ${skills.length} |
| Reports | ${reports.length} |
| Goal issues | ${goalIssues.length} |

Graph hash: \`${graphHash}\`

## Graph

\`\`\`json
${JSON.stringify(graph, null, 2)}
\`\`\`
`;

if (dryRun) {
  console.log(`DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- Dry run only; no report write attempted.
- Findings: ${findings.length}.`);
  process.exit(0);
}

function repoInfo() {
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const branch = gh(["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]);
  return { repo, branch };
}

function existingReport(repo) {
  try {
    const raw = gh(["api", `/repos/${repo}/contents/${reportPath}`]);
    const info = JSON.parse(raw);
    const content = Buffer.from(String(info.content || ""), "base64").toString("utf8");
    const currentHash = /graphHash:\s*"?([a-f0-9]{64})"?/i.exec(content)?.[1] ?? null;
    return { sha: info.sha || "", graphHash: currentHash };
  } catch {
    return { sha: "", graphHash: null };
  }
}

function putReport(repo, branch, sha = "") {
  const args = [
    "api",
    "-X",
    "PUT",
    `/repos/${repo}/contents/${reportPath}`,
    "-f",
    "message=chore(reports): refresh repo-graph",
    "-f",
    `content=${Buffer.from(body, "utf8").toString("base64")}`,
    "-f",
    `branch=${branch}`,
  ];
  if (sha) args.push("-f", `sha=${sha}`);
  return gh(args);
}

try {
  const { repo, branch } = repoInfo();
  let existing = existingReport(repo);
  if (existing.graphHash === graphHash) {
    console.log(`DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- No report write needed; repo graph was unchanged.`);
    process.exit(0);
  }
  try {
    putReport(repo, branch, existing.sha);
  } catch (err) {
    if (/409|sha/i.test(`${err.message}\n${err.stderr || ""}`)) {
      existing = existingReport(repo);
      if (existing.graphHash === graphHash) {
        console.log(`DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- No report write needed; repo graph was unchanged.`);
        process.exit(0);
      }
      putReport(repo, branch, existing.sha);
    } else {
      throw err;
    }
  }
  console.log(`DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- Refreshed .kody/reports/repo-graph.md.
- Findings: ${findings.length}.`);
} catch (err) {
  console.log(`FAILED: ${err.message || String(err)}`);
  process.exit(1);
}
