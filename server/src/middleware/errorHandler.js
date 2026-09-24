import { env } from "../config/env.js";
import { createLogger } from "../services/logger.js";

const logger = createLogger({ module: "errorHandler" });

export function errorHandler(error, req, res, next) {
  const requestId = req.id || "unknown";
  
  logger.error({
    requestId,
    method: req.method,
    path: req.path,
    error: {
      message: error.message,
      stack: env.isProduction ? undefined : error.stack,
      code: error.code
    }
  });

  // The response is already streaming (exports, file downloads); let Express
  // close the socket instead of throwing ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === "INVALID_WORKBOOK") {
    return res.status(400).json({ message: error.message });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({ message: error.message });
  }

  if (error.name === "CastError") {
    return res.status(400).json({ message: "Invalid ID format." });
  }

  if (error.name === "MongoServerError" && error.code === 11000) {
    return res.status(409).json({ message: "Duplicate entry." });
  }

  return res.status(500).json({ 
    message: env.isProduction ? "Server error" : error.message 
  });
}