import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

export const prerender = false;

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
];

const FAKE_CONTENT: Record<string, string> = {
  "in-reply-to":
    "Really enjoyed this post! The approach you described here is exactly what I was looking for.",
  "mention-of": "I referenced this article in my latest post — great resource.",
  "repost-of": "",
  "like-of": "",
  "bookmark-of": "",
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
    author_photo: null,
    content_text: FAKE_CONTENT[wm_property] ?? "",
    published: new Date().toISOString(),
  };
}

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response(
      "Content-Type must be application/x-www-form-urlencoded",
      { status: 400 },
    );
  }

  const body = await request.formData();
  const source = body.get("source");
  const target = body.get("target");

  if (
    typeof source !== "string" ||
    typeof target !== "string" ||
    !source ||
    !target
  ) {
    return new Response("source and target are required", { status: 400 });
  }

  let sourceUrl: URL;
  let targetUrl: URL;
  try {
    sourceUrl = new URL(source);
    targetUrl = new URL(target);
  } catch {
    return new Response("source and target must be valid URLs", {
      status: 400,
    });
  }

  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    return new Response("source must be an http or https URL", { status: 400 });
  }
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return new Response("target must be an http or https URL", { status: 400 });
  }

  const requestUrl = new URL(request.url);
  if (targetUrl.hostname !== requestUrl.hostname) {
    return new Response("target must point to this site", { status: 400 });
  }

  const targetPath = targetUrl.pathname;
  const fake = fakeData(sourceUrl);

  try {
    await env.DB.prepare(
      `
      INSERT OR IGNORE INTO webmentions
        (source, target_path, wm_property, author_name, author_url, author_photo, content_text, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        source,
        targetPath,
        fake.wm_property,
        fake.author_name,
        fake.author_url,
        fake.author_photo,
        fake.content_text,
        fake.published,
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e);
    return new Response("Internal Server Error", { status: 500 });
  }

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return Response.redirect(
      `${requestUrl.origin}/mentions/?target=${encodeURIComponent(targetPath)}`,
      303,
    );
  }

  return new Response("Accepted", { status: 202 });
};

export const GET: APIRoute = () =>
  new Response(
    "This is the webmention endpoint. Send a POST request with source and target fields.",
    {
      status: 200,
      headers: { Allow: "POST" },
    },
  );
