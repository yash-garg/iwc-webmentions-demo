// Webmention receiver + JSON API
// POST /webmention  — receive a webmention, store in D1
// GET  /webmention  — describe the endpoint
// GET  /mentions    — return JSON list for a given ?target= path (CORS-enabled)

export interface Env {
  DB: D1Database;
  // Optional: set SITE_URL to redirect browsers back to your blog after a POST
  // e.g. https://webmentions-demo.pages.dev
  SITE_URL?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      headers: CORS_HEADERS,
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
      headers: CORS_HEADERS,
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
      headers: CORS_HEADERS,
    });
  }

  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    return new Response("source must be an http or https URL", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return new Response("target must be an http or https URL", {
      status: 400,
      headers: CORS_HEADERS,
    });
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
      headers: CORS_HEADERS,
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

  return new Response("Accepted", { status: 202, headers: CORS_HEADERS });
}

async function handleGetMentions(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get("target") ?? "";
  if (!target) {
    return new Response(JSON.stringify({ error: "target query param required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const result = await env.DB.prepare(
    "SELECT * FROM webmentions WHERE target_path = ? ORDER BY received_at DESC"
  )
    .bind(target)
    .all();

  return new Response(JSON.stringify(result.results), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /webmention — receive a webmention
    if (request.method === "POST" && url.pathname === "/webmention") {
      return handlePost(request, env);
    }

    // GET /webmention — describe the endpoint
    if (request.method === "GET" && url.pathname === "/webmention") {
      return new Response(
        "Webmention endpoint. Send a POST request with source and target fields.",
        { status: 200, headers: { Allow: "POST, GET", ...CORS_HEADERS } }
      );
    }

    // GET /mentions?target=/posts/slug/ — return JSON for client-side rendering
    if (request.method === "GET" && url.pathname === "/mentions") {
      return handleGetMentions(url, env);
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
