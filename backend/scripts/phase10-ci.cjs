const { spawnSync } = require("node:child_process");

const commands = [
  ["npm", ["run", "lint"], { cwd: process.cwd() }],
  ["npm", ["run", "test"], { cwd: process.cwd() }],
  ["npm", ["run", "test:e2e"], { cwd: process.cwd() }],
  ["npm", ["audit", "--omit=dev"], { cwd: process.cwd() }],
];

let failed = 0;
for (const [command, args, options] of commands) {
  console.log(`\n==> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { 
    ...options,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`);
  }
}

if (failed > 0) {
  console.error(`\nPhase 10 CI gates failed: ${failed} command(s) failed.`);
  process.exit(1);
}

console.log("\nAll Phase 10 CI gates passed.");
