// Webmention receiver + sender + JSON API
// POST /webmention  — receive a webmention, store in D1
// GET  /webmention  — describe the endpoint
// GET  /mentions    — return JSON list for a given ?target= path (CORS-enabled)
// POST /send        — discover endpoint on target URL and send a webmention
// GET  /send        — describe the send endpoint

export interface Env {
  DB: D1Database;
  // Optional: set SITE_URL to redirect browsers back to your blog after a POST
  // e.g. https://webmentions-demo.pages.dev
  SITE_URL?: string;
}

// CORS headers for public read endpoints (allow any origin)
const READ_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// CORS headers for write/mutation endpoints (tighten in production via SITE_URL)
const WRITE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Derive a stable number from a string (simple hash)
function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const WM_PROPERTIES = [
  "mention-of",
  "in-reply-to",
  "like-of",
  "repost-of",
  "bookmark-of",
] as const;

const FAKE_CONTENT: Partial<Record<string, string>> = {
  "in-reply-to":
    "Really enjoyed this post! The approach you described here is exactly what I was looking for.",
  "mention-of": "I referenced this article in my latest post — great resource.",
};

/**
 * Demo stub: generates plausible but fake author/type data from the source URL.
 * A real webmention receiver would fetch the source page and parse microformats2
 * (h-entry) to extract the actual author name, photo, and interaction type.
 */
function fakeData(sourceUrl: URL) {
  const seed = hashStr(sourceUrl.hostname + sourceUrl.pathname);
  const wm_property = WM_PROPERTIES[seed % WM_PROPERTIES.length]!;
  const name = sourceUrl.hostname.replace(/^www\./, "").split(".")[0]!;
  const authorName = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    wm_property,
    author_name: authorName,
    author_url: sourceUrl.origin,
    author_photo: null as string | null,
    content_text: FAKE_CONTENT[wm_property] ?? "",
    published: new Date().toISOString(),
  };
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response("Content-Type must be application/x-www-form-urlencoded", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  const body = await request.formData();
  const source = body.get("source");
  const target = body.get("target");

  if (
    typeof source !== "string" || typeof target !== "string" ||
    !source || !target
  ) {
    return new Response("source and target are required", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  let sourceUrl: URL;
  let targetUrl: URL;
  try {
    sourceUrl = new URL(source);
    targetUrl = new URL(target);
  } catch {
    return new Response("source and target must be valid URLs", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    return new Response("source must be an http or https URL", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return new Response("target must be an http or https URL", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  // Validate target belongs to this site
  if (env.SITE_URL) {
    const allowedHost = new URL(env.SITE_URL).hostname;
    if (targetUrl.hostname !== allowedHost) {
      return new Response("target must point to this site", {
        status: 400,
        headers: WRITE_CORS_HEADERS,
      });
    }
  }

  const targetPath = targetUrl.pathname;
  const fake = fakeData(sourceUrl);

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO webmentions
        (source, target_path, wm_property, author_name, author_url, author_photo, content_text, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        source,
        targetPath,
        fake.wm_property,
        fake.author_name,
        fake.author_url,
        fake.author_photo,
        fake.content_text,
        fake.published
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e);
    return new Response("Internal Server Error", {
      status: 500,
      headers: WRITE_CORS_HEADERS,
    });
  }

  // Redirect browsers back to the site's mentions page
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    const siteUrl = env.SITE_URL ?? targetUrl.origin;
    return Response.redirect(
      `${siteUrl}/mentions/?target=${encodeURIComponent(targetPath)}`,
      303
    );
  }

  return new Response("Accepted", { status: 202, headers: WRITE_CORS_HEADERS });
}

async function handleGetMentions(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get("target") ?? "";
  if (!target) {
    return new Response(JSON.stringify({ error: "target query param required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...READ_CORS_HEADERS },
    });
  }

  let result: D1Result;
  try {
    result = await env.DB.prepare(
      "SELECT source, target_path, wm_property, author_name, author_url, author_photo, content_text, published, received_at FROM webmentions WHERE target_path = ? ORDER BY received_at DESC LIMIT 100"
    )
      .bind(target)
      .all();
  } catch (e) {
    console.error("D1 query failed:", e);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...READ_CORS_HEADERS },
    });
  }

  return new Response(JSON.stringify(result.results), {
    status: 200,
    headers: { "Content-Type": "application/json", ...READ_CORS_HEADERS },
  });
}

/**
 * Discover the webmention endpoint for a given URL.
 * Checks the Link response header first, then falls back to parsing the HTML body.
 * Returns the absolute endpoint URL, or null if none is found.
 */
async function discoverEndpoint(targetUrl: string): Promise<string | null> {
  const res = await fetch(targetUrl, {
    headers: { Accept: "text/html" },
    redirect: "follow",
  });

  // 1. Check Link header: Link: <https://example.com/webmention>; rel="webmention"
  const linkHeader = res.headers.get("Link") ?? "";
  for (const part of linkHeader.split(",")) {
    if (/rel=["']?webmention["']?/i.test(part)) {
      const match = part.match(/<([^>]+)>/);
      if (match) return new URL(match[1], targetUrl).toString();
    }
  }

  // 2. Check HTML body for <link rel="webmention" href="...">
  const html = await res.text();
  const patterns = [
    /<link[^>]+rel=["']webmention["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']webmention["']/i,
    /<a[^>]+rel=["']webmention["'][^>]+href=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+)["'][^>]+rel=["']webmention["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return new URL(match[1], targetUrl).toString();
  }

  return null;
}

async function handleSend(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response("Content-Type must be application/x-www-form-urlencoded", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  const body = await request.formData();
  const source = body.get("source");
  const target = body.get("target");

  if (typeof source !== "string" || typeof target !== "string" || !source || !target) {
    return new Response("source and target are required", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  try {
    new URL(source);
    new URL(target);
  } catch {
    return new Response("source and target must be valid URLs", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  // Discover webmention endpoint on the target page
  let endpoint: string | null;
  try {
    endpoint = await discoverEndpoint(target);
  } catch (e) {
    console.error("Endpoint discovery failed:", e);
    return new Response(`Could not fetch target URL: ${String(e)}`, {
      status: 422,
      headers: WRITE_CORS_HEADERS,
    });
  }

  if (!endpoint) {
    return new Response("No webmention endpoint found at target URL", {
      status: 400,
      headers: WRITE_CORS_HEADERS,
    });
  }

  // Send the webmention
  let sendRes: Response;
  try {
    sendRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ source, target }).toString(),
    });
  } catch (e) {
    console.error("Webmention send failed:", e);
    return new Response(`Failed to reach webmention endpoint: ${String(e)}`, {
      status: 502,
      headers: WRITE_CORS_HEADERS,
    });
  }

  return new Response(
    JSON.stringify({ endpoint, status: sendRes.status, ok: sendRes.ok }),
    {
      status: sendRes.ok ? 202 : 502,
      headers: { "Content-Type": "application/json", ...WRITE_CORS_HEADERS },
    }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: READ_CORS_HEADERS });
    }

    // POST /webmention — receive a webmention
    if (request.method === "POST" && url.pathname === "/webmention") {
      return handlePost(request, env);
    }

    // GET /webmention — describe the endpoint
    if (request.method === "GET" && url.pathname === "/webmention") {
      return new Response(
        "Webmention endpoint. Send a POST request with source and target fields.",
        { status: 200, headers: { Allow: "POST, GET", ...READ_CORS_HEADERS } }
      );
    }

    // GET /mentions?target=/posts/slug/ — return JSON for client-side rendering
    if (request.method === "GET" && url.pathname === "/mentions") {
      return handleGetMentions(url, env);
    }

    // POST /send — discover endpoint on target and send a webmention
    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request);
    }

    // GET /send — describe the send endpoint
    if (request.method === "GET" && url.pathname === "/send") {
      return new Response(
        "Webmention sender. POST with source and target to discover the endpoint and send a webmention.",
        { status: 200, headers: { Allow: "POST, GET", ...READ_CORS_HEADERS } }
      );
    }

    return new Response("Not Found", { status: 404, headers: READ_CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
