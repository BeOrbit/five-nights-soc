/**
 * Worker entry point.
 *
 * Right now the site is fully static, so the Worker has one job: serve files
 * from public/ and attach security headers to every response. When the
 * leaderboard arrives, /api/* routes (with input validation and rate limits)
 * will be added here.
 */

const SECURITY_HEADERS = {
  // Only load scripts, styles, data, and images from this site. No inline
  // scripts, no third-party code, no framing by other sites.
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

// HTTPS-only headers. These are skipped for local development
// (http://localhost), where forcing HTTPS would break loading the CSS and JS.
const HTTPS_ONLY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  const isHttps = request && new URL(request.url).protocol === "https:";
  if (isHttps) {
    for (const [name, value] of Object.entries(HTTPS_ONLY_HEADERS)) {
      headers.set(name, value);
    }
    headers.set(
      "Content-Security-Policy",
      `${SECURITY_HEADERS["Content-Security-Policy"]}; upgrade-insecure-requests`,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    // A static site only needs GET and HEAD. Reject everything else early.
    if (!ALLOWED_METHODS.has(request.method)) {
      return withSecurityHeaders(
        new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
        }),
        request,
      );
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, request);
  },
};
