import pino from "pino";
import { config } from "./config.js";

const transport =
  process.env.NODE_ENV === "production"
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname"
        }
      };

export const logger = pino({
  level: config.logLevel,
  transport
});
