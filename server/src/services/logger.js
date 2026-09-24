import pino from "pino";
import { env } from "../config/env.js";

const logger = pino({
  level: env.isProduction ? "info" : "debug",
  transport: env.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
});

export function createLogger(context = {}) {
  return logger.child(context);
}

export default logger;