import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

import { env } from "../config/index.js";

// Keying purely by IP means every student behind the same campus WiFi/hostel
// NAT (very common — many students genuinely share one public IP) collapses
// into a SINGLE shared budget. During a live session with hundreds of
// students polling check-in status every few seconds, that shared bucket
// exhausts almost immediately and starts 429-ing everyone on that network,
// not just an abusive individual. Key by the authenticated user's id instead
// whenever a bearer token is present, so each student gets their own budget;
// only truly unauthenticated requests (which can't be attributed to a user)
// fall back to IP. This only reads the token's payload to build a rate-limit
// bucket key — it does NOT trust or verify the token for authorization,
// that's still `authenticate`'s job downstream.
const rateLimitKey = (req) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;
  if (token) {
    try {
      const payload = jwt.decode(token);
      if (payload?.sub) return `user:${payload.sub}`;
    } catch {
      // fall through to IP-based keying below
    }
  }
  return req.ip;
};

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: {
    success: false,
    message: "Too many requests, please try again later"
  }
});

export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later"
  }
});



