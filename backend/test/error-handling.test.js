const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { installRouterParamValidation } = require("../src/middleware/asyncErrors");
const { requestId, errorHandler, statusForError } = require("../src/middleware/errorHandler");

installRouterParamValidation(express);

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("invalid UUID route parameters return 400 before route handlers", async () => {
  const app = express();
  app.use(requestId);
  const router = express.Router();
  router.get("/journals/:id", (_req, res) => res.json({ reached: true }));
  app.use("/api/v1/finance", router);
  app.use(errorHandler);

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/finance/journals/not-a-uuid`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid UUID parameter");
  });
});

test("rejected async handlers return JSON and leave the process serving requests", async () => {
  const app = express();
  app.use(requestId);
  app.get("/broken", async () => {
    const error = new Error("database connection refused");
    error.code = "ECONNREFUSED";
    throw error;
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(errorHandler);

  await withServer(app, async (base) => {
    const failed = await fetch(`${base}/broken`);
    assert.equal(failed.status, 503);
    assert.ok((await failed.json()).request_id);
    const healthy = await fetch(`${base}/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: "ok" });
  });
});

test("PostgreSQL invalid input and constraint errors map to client statuses", () => {
  assert.equal(statusForError({ code: "22P02" }), 400);
  assert.equal(statusForError({ code: "23505" }), 409);
  assert.equal(statusForError({ code: "08006" }), 503);
});
