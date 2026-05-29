# Webmentions Demo

A working demonstration of [Webmention](https://www.w3.org/TR/webmention/) — a small open web standard that lets websites talk to each other when one links to another.

---

## What is a Webmention?

Imagine you write a blog post and someone else writes about it on their own site. Normally you'd never know unless they emailed you or posted on social media. **Webmention fixes that.**

When someone links to your post, their website can automatically ping yours and say:
> "Hey, this URL just mentioned you."

Your site can then store that notification and show it to readers — like a comments section that works across the whole web, without anyone owning the platform.

There are five types of webmention:

| Type | Meaning |
|------|---------|
| **mention-of** | Someone linked to your post in passing |
| **in-reply-to** | Someone wrote a direct reply |
| **like-of** | Someone liked your post |
| **repost-of** | Someone reposted (reshared) it |
| **bookmark-of** | Someone bookmarked it |

---

## How This Demo Works

This project is a self-hosted webmention system built entirely on free Cloudflare infrastructure. It has two parts:

### 1. The Blog (Static Site)
A simple Astro-powered blog deployed to **Cloudflare Pages**. Every blog post includes a hidden HTML tag that advertises a webmention endpoint:

```html
<link rel="webmention" href="https://webmentions.rexx.workers.dev/webmention" />
```

This tag is invisible to readers but tells other sites and tools: _"send webmentions here."_

### 2. The Webmention Worker
A small **Cloudflare Worker** (in the `worker/` folder) that:
- **Receives** webmentions via HTTP POST
- **Stores** them in a Cloudflare D1 database (serverless SQLite)
- **Serves** them back as JSON so the blog can display them
- **Sends** webmentions to other sites — give it a source and target URL, it discovers the target's endpoint and pings it automatically

When someone sends a webmention to your post, it looks like this:

```
POST /webmention
source=https://theirblog.com/my-reply
target=https://yourblog.com/posts/hello-world/
```

The worker validates it, stores it, and redirects the browser to show the updated list of mentions.

> **Note:** This is a demo — instead of fetching the actual source URL and parsing real author data, the worker generates plausible fake data from the source URL. A production system would fetch the source page and parse [microformats2](https://microformats.org/wiki/microformats2).

---

## Try It

1. Open any blog post
2. Scroll to "Send a test webmention"
3. Paste any URL as the **Source** (it can be made up — this is a demo)
4. Click **Send**
5. You'll be redirected to the mentions page showing your new entry

---

## Project Structure

```
webmentions-demo/
├── src/              # Astro static site (blog)
│   ├── content/posts/    # Markdown blog posts
│   ├── layouts/          # Shared HTML layout
│   └── pages/            # Blog pages + mentions viewer
├── worker/           # Standalone Cloudflare Worker
│   ├── src/index.ts      # Webmention receiver + JSON API
│   ├── migrations/       # Database schema
│   └── README.md         # Worker deploy instructions
└── README.md         # This file
```

---

## Deploying

### Deploy the Worker first
See [`worker/README.md`](./worker/README.md) for step-by-step instructions.
The worker for this demo is live at `https://webmentions.rexx.workers.dev`.

### Deploy the Blog

```bash
pnpm deploy
```

---

## Useful Links

- [indiewebify.me](https://indiewebify.me) — step-by-step guide to making your own site part of the IndieWeb, including setting up webmentions
- [webmention.rocks](https://webmention.rocks) — interactive test suite to verify your webmention endpoint works correctly
- [W3C Webmention Spec](https://www.w3.org/TR/webmention/) — the official standard
- [IndieWeb.org](https://indieweb.org/Webmention) — community wiki with real-world examples
- [webmention.io](https://webmention.io) — a hosted service if you don't want to self-host
