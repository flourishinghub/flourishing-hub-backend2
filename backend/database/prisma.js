import { PrismaClient } from "@prisma/client";

import { env } from "../config/index.js";

// PRISMA_QUERY_LOGGING=true (Render env var) adds per-query text + timing
// to the logs — off by default since it's too verbose to run permanently.
// Without it, an incident's logs only show endpoint-level response time,
// not which specific query inside that request was slow.
export const prisma = new PrismaClient({
  log: env.PRISMA_QUERY_LOGGING === "true" ? ["query", "warn", "error"] : ["warn", "error"]
});



