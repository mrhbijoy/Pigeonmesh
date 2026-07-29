// /pwa/ — serves the PigeonMesh PWA with a <base href="/pwa/"> tag
// so that relative paths (app.css, app.js, icons/) resolve correctly
// on the cloud bridge. On a real router the PWA is served at / by
// pigeonmeshd, so no base tag is needed there.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

let cachedHtml: string | null = null;

export async function GET() {
  try {
    if (!cachedHtml) {
      const htmlPath = path.join(process.cwd(), "public", "pwa", "index.html");
      let html = await fs.readFile(htmlPath, "utf-8");
      // Inject <base href="/pwa/"> right after <head>
      html = html.replace("<head>", '<head>\n<base href="/pwa/">');
      cachedHtml = html;
    }
    return new NextResponse(cachedHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: "PWA not found" }, { status: 404 });
  }
}
