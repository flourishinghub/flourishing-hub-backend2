import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/index.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { router } from "./routes/index.js";

export const app = express();

app.set("trust proxy", env.TRUST_PROXY);
// Disable ETag so authenticated API responses are never served stale by shared proxies
app.set("etag", false);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.CLIENT_URLS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(apiLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Flourish Hub backend is healthy",
    environment: env.NODE_ENV
  });
});

// Stop shared proxies (e.g. campus Squid) from caching per-user API responses,
// which caused stale usernames (/auth/me) and missing newly-created events (/events)
app.use(env.API_PREFIX, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(env.API_PREFIX, router);
app.use(notFoundHandler);
app.use(errorHandler);



