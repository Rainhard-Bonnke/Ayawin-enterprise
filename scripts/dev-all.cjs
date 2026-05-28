const { spawn, execSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const API_PORT = Number(process.env.API_PORT || 4000);

/** Avoid stale node processes blocking nodemon after EADDRINUSE crashes. */
function freePort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!line.includes("LISTENING")) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          console.log(`[dev:all] Freed port ${port} (PID ${pid})`);
        } catch {
          /* already gone */
        }
      }
      return;
    }
    execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
  } catch {
    /* port already free */
  }
}

freePort(API_PORT);

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
