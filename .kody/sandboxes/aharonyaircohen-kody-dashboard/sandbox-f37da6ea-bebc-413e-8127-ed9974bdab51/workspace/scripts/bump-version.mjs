import { readFileSync, writeFileSync } from 'node:fs'

const path = 'package.json'
const pkg = JSON.parse(readFileSync(path, 'utf8'))
const parts = pkg.version.split('.').map(Number)
if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
  console.error(`Unexpected version format: ${pkg.version}`)
  process.exit(1)
}
const [maj, min, pat] = parts
pkg.version = `${maj}.${min}.${pat + 1}`
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`Bumped version to ${pkg.version}`)
