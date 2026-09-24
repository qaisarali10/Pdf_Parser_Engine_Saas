import { randomUUID } from "node:crypto";
import { createLogger } from "../services/logger.js";

export function requestId(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  
  req.log = createLogger({
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  next();
}