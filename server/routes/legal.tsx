import React from "react";
import type { Express, Request, Response } from "express";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEGAL_LAST_UPDATED,
  PRIVACY_POLICY_PATH,
  TERMS_OF_SERVICE_PATH,
} from "../../shared/legal/primitives";
import { PRIVACY_POLICY_META, PrivacyPolicyBody } from "../../shared/legal/privacy-policy";
import { TERMS_OF_SERVICE_META, TermsOfServiceBody } from "../../shared/legal/terms-of-service";

// Server-rendered Privacy Policy and Terms of Service.
//
// The React app is a client-rendered SPA, so a plain HTTP fetch of
// /privacy-policy used to return an empty <div id="root">. Google's OAuth
// brand verification (and any crawler that doesn't execute JavaScript) read
// that as "the privacy policy page does not have sufficient content" and
// rejected the app. These routes return the complete policy text as static
// HTML on a full-page load; in-app navigation still renders the React version
// of the very same shared body, so the two can't drift apart.

const BASE_URL = "https://itmap.ai";

const STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1e2130; color: #e2e8f0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.65; -webkit-font-smoothing: antialiased; }
  a { color: #22d3ee; text-decoration: none; }
  a:hover { color: #67e8f9; text-decoration: underline; }
  header { border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); }
  header .inner { max-width: 48rem; margin: 0 auto; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between; }
  .brand { font-family: Montserrat, Inter, sans-serif; font-weight: 700; letter-spacing: 0.35em; color: #fff; font-size: 1.1rem; }
  .brand:hover { text-decoration: none; color: #fff; }
  nav a { font-size: 0.875rem; margin-left: 1.25rem; color: #94a3b8; }
  main { max-width: 48rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  article { background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 1rem; padding: 2.5rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
  h1 { margin: 0; font-size: 2rem; font-weight: 700; color: #fff; }
  .updated { margin: 0.5rem 0 2rem; font-size: 0.875rem; color: #94a3b8; }
  h2 { margin: 2.5rem 0 0; font-size: 1.25rem; font-weight: 600; color: #fff; }
  h3 { margin: 1.5rem 0 0; font-size: 1rem; font-weight: 600; color: #f1f5f9; }
  p { margin: 0.75rem 0 0; color: #cbd5e1; }
  ul { margin: 0.75rem 0 0; padding-left: 1.25rem; color: #cbd5e1; }
  li + li { margin-top: 0.5rem; }
  strong { color: #f1f5f9; }
  code { background: #1e293b; color: #a5f3fc; border-radius: 0.25rem; padding: 0.1rem 0.4rem; font-size: 0.8em; }
  .cta { margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.95rem; color: #94a3b8; }
  @media (max-width: 640px) { article { padding: 1.5rem; } h1 { font-size: 1.6rem; } }
`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderDocument(opts: {
  path: string;
  title: string;
  description: string;
  heading: string;
  body: string;
  footer?: string;
}): string {
  const canonical = `${BASE_URL}${opts.path}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-17890206301"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'AW-17890206301');
</script>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:title" content="${escapeHtml(opts.title)}" />
<meta property="og:description" content="${escapeHtml(opts.description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:type" content="website" />
<meta name="robots" content="index,follow" />
<link rel="icon" href="/favicon.ico" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@700&display=swap" rel="stylesheet" />
<style>${STYLES}</style>
</head>
<body>
<header><div class="inner">
  <a class="brand" href="/">ITMAP</a>
  <nav>
    <a href="${PRIVACY_POLICY_PATH}">Privacy Policy</a>
    <a href="${TERMS_OF_SERVICE_PATH}">Terms of Service</a>
    <a href="/contact">Contact</a>
  </nav>
</div></header>
<main>
  <article>
    <h1>${escapeHtml(opts.heading)}</h1>
    <p class="updated">Last updated: ${escapeHtml(LEGAL_LAST_UPDATED)}</p>
    ${opts.body}
    ${opts.footer ?? ""}
  </article>
</main>
</body>
</html>`;
}

// Rendered once at startup: the content is static.
const PRIVACY_HTML = renderDocument({
  path: PRIVACY_POLICY_PATH,
  title: PRIVACY_POLICY_META.title,
  description: PRIVACY_POLICY_META.description,
  heading: PRIVACY_POLICY_META.heading,
  body: renderToStaticMarkup(<PrivacyPolicyBody />),
});

const TERMS_HTML = renderDocument({
  path: TERMS_OF_SERVICE_PATH,
  title: TERMS_OF_SERVICE_META.title,
  description: TERMS_OF_SERVICE_META.description,
  heading: TERMS_OF_SERVICE_META.heading,
  body: renderToStaticMarkup(<TermsOfServiceBody />),
  footer: `<p class="cta">Ready to get started? <a href="/register">Create your free account</a> — you'll be asked to accept these Terms as part of sign-up.</p>`,
});

function sendHtml(res: Response, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(html);
}

export function registerLegalRoutes(app: Express): void {
  app.get(PRIVACY_POLICY_PATH, (_req: Request, res: Response) => sendHtml(res, PRIVACY_HTML));

  // The Terms page inside the app has "I Agree / Disagree" buttons wired to
  // ?returnTo= for the registration flow. A full-page load with returnTo
  // therefore keeps going to the SPA; only plain loads (crawlers, verifiers,
  // people typing the URL) get the static document.
  app.get(TERMS_OF_SERVICE_PATH, (req: Request, res: Response, next) => {
    if (typeof req.query.returnTo === "string") return next();
    sendHtml(res, TERMS_HTML);
  });

  // Legacy URLs. The client router also handles these for in-app navigation;
  // a server 301 covers crawlers and old external links.
  app.get("/privacy", (req: Request, res: Response) => {
    const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    res.redirect(301, `${PRIVACY_POLICY_PATH}${qs}`);
  });
  app.get("/terms", (req: Request, res: Response) => {
    const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    res.redirect(301, `${TERMS_OF_SERVICE_PATH}${qs}`);
  });
}
