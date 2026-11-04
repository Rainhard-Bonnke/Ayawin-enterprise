const Layer = require("express/lib/router/layer");

const originalHandleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handleRequestWithPromiseErrors(req, res, next) {
  const handler = this.handle;
  if (handler.length > 3) return originalHandleRequest.call(this, req, res, next);
  try {
    const result = handler.call(this, req, res, next);
    if (result && typeof result.catch === "function") result.catch(next);
    return result;
  } catch (error) {
    return next(error);
  }
};

function validateUuidParam(req, res, next, value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return res.status(400).json({ error: "Invalid UUID parameter", request_id: req.id });
  }
  return next();
}

function installRouterParamValidation(express) {
  const createRouter = express.Router;
  express.Router = function routerWithUuidParams(...args) {
    const router = createRouter(...args);
    for (const name of ["id", "lineId", "uuid"]) router.param(name, validateUuidParam);
    return router;
  };
  Object.assign(express.Router, createRouter);
}

module.exports = { installRouterParamValidation };
