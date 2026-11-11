const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
require("./middleware/asyncErrors");
const { installRouterParamValidation } = require("./middleware/asyncErrors");
installRouterParamValidation(express);
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const pool = require("./db");
const { validateSecrets } = require("./config/secrets");
const { getMigrationStatus } = require("./migrate");
const { applySecurity, apiLimiter } = require("./middleware/security");
const { requestId, errorHandler } = require("./middleware/errorHandler");
const v1Routes = require("./routes/v1");
const mpesa = require("./services/mpesaService");
const mpesaB2c = require("./services/mpesaB2cService");
const openapi = require("./openapi");

validateSecrets();

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 0);
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      const developmentOrigin = process.env.NODE_ENV !== "production" && (
        /^https?:\/\/localhost:\d+$/.test(origin || "") ||
        /^https?:\/\/127\.0\.0\.1:\d+$/.test(origin || "") ||
        /^https?:\/\/(?:10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3})\.\d{1,3}:\d+$/.test(origin || "") ||
        /^https:\/\/[^/]+\.trycloudflare\.com$/.test(origin || "")
      );
      if (!origin || allowedOrigins.includes(origin) || developmentOrigin) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(requestId);
applySecurity(app);
app.use("/api", apiLimiter);
app.use("/api/v1", v1Routes);

app.post("/api/v1/callbacks/mpesa/:companyId/:token/*", async (req, res) => {
  const { companyId, token } = req.params;
  const callbackKind = String(req.params[0] || "stk").replace(/^\/+|\/+$/g, "");
  try {
    if (!(await mpesa.validateCompanyCallbackSourceIp({ companyId, sourceIp: req.ip }))) {
      return res.status(403).json({ ResultCode: 1, ResultDesc: "M-Pesa callback source IP is not allowed" });
    }
    if (!(await mpesa.validateCompanyCallbackToken({ companyId, token }))) {
      return res.status(401).json({ ResultCode: 1, ResultDesc: "Invalid callback token" });
    }
    if (callbackKind === "c2b/validation") {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
    if (callbackKind === "c2b/confirmation") {
      const result = await mpesa.receiveC2bConfirmation({ companyId, token, payload: req.body });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "C2B confirmation received", request_id: result.transaction_id });
    }
    if (callbackKind === "stk/status-result") {
      const result = await mpesa.receiveMpesaStatusResult({ companyId, token, payload: req.body });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Transaction status received", request_id: result.request_id });
    }
    if (callbackKind === "b2c/result" || callbackKind === "b2c/timeout") {
      const result = await mpesaB2c.receiveB2cResult({ companyId, token, payload: req.body });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "B2C result received", status: result.status });
    }
    const result = await mpesa.receiveMpesaCallback({ companyId, token, payload: req.body });
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Callback received", request_id: result.request_id });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ ResultCode: 1, ResultDesc: error.message });
  }
});

app.post("/api/v1/callbacks/notifications/:companyId/:provider/:token", async (req, res) => {
  try {
    const result = await require("./services/notificationOutboxService").recordNotificationDelivery({
      companyId: req.params.companyId,
      provider: req.params.provider,
      token: req.params.token,
      payload: req.body,
    });
    return res.status(200).json({ received: true, delivery_status: result.delivery_status });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || "Unable to record delivery callback" });
  }
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.get("/api/docs.json", (_req, res) => res.json(openapi));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.get("/ready", async (_req, res) => {
  try {
    const dbCheck = await pool.query("SELECT 1 AS ready");
    const migrations = await getMigrationStatus();
    if (!dbCheck.rows[0] || !migrations.ready) {
      return res.status(503).json({ status: "not_ready", db: "ok", migrations: migrations.pending });
    }
    return res.json({ status: "ok", db: "ok", migrations: { ready: true, pending: [] } });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ status: "error", error: "Database unavailable" });
  }
});

app.get("/health/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok", db: "ready" });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ status: "error", error: "Database unavailable" });
  }
});

app.use("/api", (req, res, next) => {
  if (req.path === "/v1" || req.path.startsWith("/v1/")) return next();
  return res.status(410).json({ error: "Legacy API is retired. Use the authenticated /api/v1 API." });
});

app.use((req, res) => res.status(404).json({ error: "Not found", request_id: req.id }));
app.use(errorHandler);

const port = process.env.PORT || 4000;
let server;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    await pool.end();
  } catch (error) {
    console.error(JSON.stringify({ event: "pool_shutdown_error", error: error.message }));
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ event: "unhandled_rejection", error: reason?.message || String(reason) }));
  void shutdown(1);
});
process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ event: "uncaught_exception", error: error.message, stack: error.stack }));
  void shutdown(1);
});

async function start() {
  try {
    await pool.query("SELECT 1");
    const migrationStatus = await getMigrationStatus();
    if (!migrationStatus.ready) {
      throw new Error(`Database migrations pending: ${migrationStatus.pending.length}. Run the locked db:migrate job before starting the API.`);
    }
    server = app.listen(port, "0.0.0.0", () => console.log(`Server listening on ${port}`));
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = { app, start, shutdown };
