/**
 * Repeatable GitHub-vs-Namespace preview-build benchmark.
 *
 * For a given repo + open PR, runs N rounds. Each round dispatches the
 * `preview-build` workflow twice — once with the vault's NSC_TENANT_ID
 * removed (build on the GitHub runner's local docker) and once with it
 * present (build on a Namespace remote builder) — times the docker-build
 * step of each, and prints a comparison table. Across rounds you can see
 * Namespace's cache warming (round 1 cold → round 2+ warm).
 *
 * The "build step" = wall-clock from the BuildKit `building with …` line
 * to `exporting to image`, parsed from the run log timestamps. This
 * excludes engine npm install / vault read / Fly machine spawn, which are
 * identical on both paths — so it isolates the builder itself.
 *
 * Usage:
 *   KODY_MASTER_KEY=... node scripts/namespace-build-benchmark.mjs <owner/repo> <pr> [rounds] [finalNsc=on|off]
 *
 * Requires: gh CLI authed; KODY_MASTER_KEY in env (vault crypto key).
 */
import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const { encrypt, decrypt } = await import(
  path.join(here, "../src/dashboard/lib/vault/crypto.ts")
)

const [repo, prStr, roundsStr = "2", finalNsc = "on"] = process.argv.slice(2)
if (!repo || !prStr) {
  console.error(
    "usage: node scripts/namespace-build-benchmark.mjs <owner/repo> <pr> [rounds] [on|off]",
  )
  process.exit(1)
}
const pr = Number(prStr)
const rounds = Number(roundsStr)
const TENANT = "tenant_fql41urtcu7sq"
const VAULT = ".kody/secrets.enc"

const sh = (cmd) => execSync(cmd, { maxBuffer: 64 * 1024 * 1024 }).toString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function setNsc(on) {
  const meta = JSON.parse(sh(`gh api repos/${repo}/contents/${VAULT}`))
  const doc = JSON.parse(
    decrypt(Buffer.from(meta.content, "base64").toString("utf8")),
  )
  if (on)
    doc.secrets.NSC_TENANT_ID = {
      value: TENANT,
      updatedAt: new Date().toISOString(),
      updatedBy: "benchmark",
    }
  else delete doc.secrets.NSC_TENANT_ID
  const content = Buffer.from(encrypt(JSON.stringify(doc)), "utf8").toString(
    "base64",
  )
  writeFileSync("/tmp/bench-vault.b64", content)
  sh(
    `gh api -X PUT repos/${repo}/contents/${VAULT} ` +
      `-f message="chore(vault): NSC ${on ? "on" : "off"} (benchmark)" ` +
      `-f content="$(cat /tmp/bench-vault.b64)" -f sha="${meta.sha}"`,
  )
}

const defaultBranch = () => JSON.parse(sh(`gh api repos/${repo}`)).default_branch

async function dispatchAndTime(branch, label) {
  const latest = () =>
    JSON.parse(
      sh(`gh run list --repo ${repo} --workflow kody.yml --limit 1 --json databaseId`),
    )[0]?.databaseId
  const before = latest()
  sh(
    `gh api -X POST repos/${repo}/actions/workflows/kody.yml/dispatches ` +
      `-f ref=${branch} -f "inputs[agentAction]=preview-build" -f "inputs[issue_number]=${pr}"`,
  )
  let rid
  for (let i = 0; i < 25; i++) {
    await sleep(4000)
    const r = latest()
    if (r && r !== before) {
      rid = r
      break
    }
  }
  if (!rid) throw new Error(`${label}: new run never appeared`)
  let concl = ""
  for (let i = 0; i < 60; i++) {
    await sleep(20000)
    const s = JSON.parse(
      sh(`gh run view ${rid} --repo ${repo} --json status,conclusion`),
    )
    if (s.status === "completed") {
      concl = s.conclusion
      break
    }
  }
  const log = sh(`gh run view ${rid} --repo ${repo} --log`)
  const ts = (re) => {
    const m = log.match(re)
    return m ? Date.parse(m[1]) : null
  }
  const start = ts(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)[^\n]*building with /)
  const end = ts(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)[^\n]*exporting to image/)
  const onNs = /Namespace remote builder ready/.test(log)
  const buildSec =
    start && end ? Math.round((end - start) / 1000) : null
  return { rid, label, concl, onNamespace: onNs, buildSec }
}

const results = []
for (let r = 1; r <= rounds; r++) {
  const branch = defaultBranch()
  console.log(`\n=== Round ${r} ===`)
  setNsc(false)
  const gh = await dispatchAndTime(branch, `R${r} GitHub`)
  console.log(
    `  ${gh.label}: ${gh.concl} | onNamespace=${gh.onNamespace} | build=${gh.buildSec}s (run ${gh.rid})`,
  )
  setNsc(true)
  const ns = await dispatchAndTime(branch, `R${r} Namespace`)
  console.log(
    `  ${ns.label}: ${ns.concl} | onNamespace=${ns.onNamespace} | build=${ns.buildSec}s (run ${ns.rid})`,
  )
  results.push({ round: r, github: gh, namespace: ns })
}

setNsc(finalNsc === "on")

console.log("\n================ SUMMARY ================")
console.log("round | github(s) | namespace(s) | speedup")
for (const { round, github, namespace } of results) {
  const sp =
    github.buildSec && namespace.buildSec
      ? (github.buildSec / namespace.buildSec).toFixed(2) + "x"
      : "n/a"
  console.log(
    `  ${round}   |   ${github.buildSec ?? "?"}     |    ${namespace.buildSec ?? "?"}      | ${sp}`,
  )
}
const ns1 = results[0]?.namespace.buildSec
const nsLast = results[results.length - 1]?.namespace.buildSec
if (ns1 && nsLast)
  console.log(
    `\nNamespace cache warming: round1 ${ns1}s -> round${results.length} ${nsLast}s (${(((ns1 - nsLast) / ns1) * 100).toFixed(0)}% faster)`,
  )
console.log(`vault left with NSC ${finalNsc}.`)
