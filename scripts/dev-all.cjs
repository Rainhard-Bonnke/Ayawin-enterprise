const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

function start(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
}

const frontend = start("npm", ["run", "dev"], root, "frontend");
const backend = start("npm", ["run", "dev"], path.join(root, "backend"), "backend");

function shutdown() {
  frontend.kill();
  backend.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
