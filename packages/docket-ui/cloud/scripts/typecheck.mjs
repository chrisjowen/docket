// SPDX-License-Identifier: AGPL-3.0-only
// svelte-check for the web UI's own source. The server's components and modules it draws on ($platform) are
// checked by the server's typecheck, against the server's routes and `$lib`; seen from here, their `$lib`
// and their typed `resolve` calls name the wrong app, so their diagnostics are left to that check.
import { spawnSync } from 'node:child_process'

const run = spawnSync('svelte-check', ['--tsconfig', './tsconfig.json', '--fail-on-warnings', '--output', 'machine'], { encoding: 'utf8', shell: false })
if (run.error) throw run.error
const lines = `${run.stdout}${run.stderr}`.split('\n')
const problems = lines.filter((line) => / (ERROR|WARNING) "/.test(line) && !/ (ERROR|WARNING) "\.\.\/\.\.\/\.\.\/platform\//.test(line))
for (const line of problems) console.log(line)
const done = lines.find((line) => / COMPLETED /.test(line))
console.log(`typecheck: ${problems.length} problems in the web UI's own source${done ? ` (svelte-check: ${done.split(' COMPLETED ')[1]}, the server's files checked by the server)` : ''}`)
if (!done) {
  console.error(run.stdout, run.stderr)
  process.exit(1)
}
process.exit(problems.length > 0 ? 1 : 0)
