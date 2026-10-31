import { Hono } from "hono";
import { resolve, sep } from "node:path";
import type { Deps } from "../deps.ts";
import { searchAlerts } from "../match.ts";

export function alertRoutes(deps: Deps) {
  const app = new Hono();
  const alertsDir = resolve(deps.config.dataDir, "raw/alerts");

  app.get("/", (c) => {
    const q = c.req.query("q") ?? "";
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
    const type = c.req.query("type");
    const results = searchAlerts(deps.datasets, q, 1000)
      .filter((a) => !type || a.alert.productTypes.includes(type) || a.alert.issueTypes.includes(type))
      .slice(0, limit)
      .map(({ alert }) => ({
        id: alert.id,
        alertNumber: alert.alertNumber,
        title: alert.title,
        url: alert.url,
        publishedAt: alert.publishedAt,
        issueTypes: alert.issueTypes,
        productTypes: alert.productTypes,
        productNames: alert.productNames,
        batchNumbers: alert.batchNumbers,
        imageCount: alert.images.filter((i) => i.file).length,
      }));
    return c.json({ total: results.length, results });
  });

  app.get("/:id{[0-9]+}", (c) => {
    const indexed = deps.datasets.alertsById.get(Number(c.req.param("id")));
    if (!indexed) return c.json({ error: "Alert not found" }, 404);
    const { alert } = indexed;
    return c.json({
      ...alert,
      images: alert.images.filter((i) => i.file).map((i) => ({ source: i.url, url: `/api/alerts/files/${i.file}` })),
      attachments: alert.attachments.map((a) => ({ source: a.url, url: a.file ? `/api/alerts/files/${a.file}` : null })),
    });
  });

  // Downloaded alert photos/documents (data/raw/alerts/{images,files}/<id>/<name>).
  app.get("/files/*", async (c) => {
    const relative = c.req.path.replace(/^.*\/alerts\/files\//, "");
    const path = resolve(alertsDir, decodeURIComponent(relative));
    if (!path.startsWith(alertsDir + sep) || !/^(images|files)[\\/]/.test(relative)) {
      return c.json({ error: "Not found" }, 404);
    }
    const file = Bun.file(path);
    if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
    return new Response(file, { headers: { "Cache-Control": "public, max-age=86400" } });
  });

  return app;
}
