import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Deps } from "./deps.ts";
import { alertRoutes } from "./routes/alerts.ts";
import { reportRoutes } from "./routes/reports.ts";
import { reviewRoutes } from "./routes/review.ts";
import { scanRoutes } from "./routes/scans.ts";

export function createApp(deps: Deps, options: { log?: boolean } = {}) {
  const app = new Hono();
  if (options.log) app.use("*", logger());
  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
  app.use("/api/*", cors({ origin: deps.config.corsOrigins, allowHeaders: ["Content-Type", "Authorization"] }));
  // 4 photos x 10 MB plus form overhead.
  app.use("/api/*", bodyLimit({ maxSize: 45 * 1024 * 1024, onError: (c) => c.json({ error: "Upload too large." }, 413) }));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      ai: deps.ai ? deps.ai.model : null,
      alerts: deps.datasets.alerts.length,
      registeredProducts: deps.datasets.registryCount,
      ...deps.db.counts(),
    }),
  );
  app.route("/api/alerts", alertRoutes(deps));
  app.route("/api", scanRoutes(deps));
  app.route("/api", reportRoutes(deps));
  app.route("/api/review", reviewRoutes(deps));

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    // Middleware such as bearerAuth signals 401/403 by throwing HTTPException.
    if (error instanceof HTTPException) return error.getResponse();
    console.error("[api] unhandled", error);
    return c.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
