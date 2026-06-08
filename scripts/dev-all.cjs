const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const backendEnvPath = path.join(root, "backend", ".env");
if (fs.existsSync(backendEnvPath)) {
  for (const line of fs.readFileSync(backendEnvPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
const API_PORT = Number(process.env.API_PORT || 4000);
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/health`;
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 500;

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

function waitForBackend() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          console.log(`[dev:all] Backend ready at ${HEALTH_URL}`);
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > HEALTH_TIMEOUT_MS) {
        reject(new Error(`Backend did not respond on port ${API_PORT} within ${HEALTH_TIMEOUT_MS / 1000}s`));
        return;
      }
      setTimeout(tick, HEALTH_INTERVAL_MS);
    };

    console.log(`[dev:all] Waiting for backend at ${HEALTH_URL} ...`);
    tick();
  });
}

function start(command, args, cwd, label, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...extraEnv },
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
}

freePort(API_PORT);

let frontend;
let backend;

async function main() {
  // Respect backend/.env; only force safe local-dev networking defaults.
  const devBackendEnv = {
    NODE_ENV: "development",
    ENABLE_DEMO_MODE: process.env.ENABLE_DEMO_MODE ?? "false",
    DISABLE_LEGACY_API: process.env.DISABLE_LEGACY_API ?? "true",
    DISABLE_HTTPS_REDIRECT: "true",
    JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || "8h",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000",
    STRICT_PRODUCTION_CONFIG: "false",
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || "5000",
  };
  console.log(`[dev:all] ENABLE_DEMO_MODE=${devBackendEnv.ENABLE_DEMO_MODE} (from backend/.env)`);
  backend = start("npm", ["run", "dev"], path.join(root, "backend"), "backend", devBackendEnv);
  backend.on("exit", (code) => {
    if (code && code !== 0) {
      console.warn(`[dev:all] Backend exited (${code}). Login will show ERR_CONNECTION_REFUSED until API is back.`);
      console.warn("[dev:all] Fix: stop all terminals, free port 4000, run npm run dev:all again.");
    }
  });
  try {
    await waitForBackend();
  } catch (err) {
    console.error(`[dev:all] ${err.message}`);
    console.error("[dev:all] Check backend/.env (Postgres) and run: cd backend && npm run db:migrate");
    backend.kill();
    process.exit(1);
  }

  frontend = start("npm", ["run", "dev"], root, "frontend");
  console.log("[dev:all] Frontend starting at http://localhost:3000 (typical) — API at http://localhost:4000");

  let apiDownLogged = false;
  setInterval(() => {
    const req = http.get(HEALTH_URL, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        apiDownLogged = false;
        return;
      }
      if (!apiDownLogged) {
        apiDownLogged = true;
        console.warn(
          `[dev:all] API not healthy on port ${API_PORT} — login will fail until you see server_listening in the log above.`,
        );
        console.warn("[dev:all] Fix: Ctrl+C, then run npm run dev:all again (or in backend folder: npm run dev).");
      }
    });
    req.on("error", () => {
      if (!apiDownLogged) {
        apiDownLogged = true;
        console.warn(`[dev:all] API offline (port ${API_PORT}) — ERR_CONNECTION_REFUSED on login is expected.`);
        console.warn("[dev:all] Fix: Ctrl+C, then npm run dev:all");
      }
    });
    req.setTimeout(3000, () => {
      req.destroy();
    });
  }, 20_000);
}

function shutdown() {
  if (frontend) frontend.kill();
  if (backend) backend.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
