const crypto = require("crypto");

function requestId(req, res, next) {
  const supplied = req.get("x-request-id");
  req.id = supplied && /^[a-zA-Z0-9._-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

function statusForError(error) {
  if (error.status || error.statusCode) return error.status || error.statusCode;
  if (error.code === "22P02") return 400;
  if (typeof error.code === "string" && error.code.startsWith("23")) return 409;
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01"].includes(error.code) || error.code?.startsWith("08")) {
    return 503;
  }
  return 500;
}

function errorHandler(error, req, res, _next) {
  const status = statusForError(error);
  console.error(JSON.stringify({ request_id: req.id, error: error.message, code: error.code }));
  const production = process.env.NODE_ENV === "production";
  const internalCode = typeof error.code === "string" && (/^\d{5}$/.test(error.code) || error.code.startsWith("ECONN"));
  const message = production && (status >= 500 || internalCode)
    ? status === 503 ? "Service temporarily unavailable" : status === 409 ? "Request conflicts with current data" : "Invalid request"
    : status >= 500 ? "Internal server error" : error.message;
  res.status(status).json({ error: message, request_id: req.id });
}

module.exports = { requestId, errorHandler, statusForError };
