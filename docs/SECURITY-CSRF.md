# CSRF and authentication model

## Current SPA (Bearer JWT)

The Ayawin frontend sends `Authorization: Bearer <access_token>` on API calls. Browsers do **not** attach this header on cross-origin requests unless JavaScript on your origin adds it.

That means classic CSRF (evil site triggers a logged-in browser request with cookies) **does not apply** to API v1 data routes.

## Defense in depth

1. **CORS** — only listed origins may read API responses from the browser.
2. **sameOriginMutations** — for mutating requests (`POST`, `PATCH`, `DELETE`) that use cookie/session auth without `Authorization: Bearer`, the `Origin` header must match `CORS_ORIGINS`.
3. **Rate limiting** — 100 requests/minute per IP on `/api/v1`.

## If you move to cookie-based sessions

You must add one of:

- `SameSite=Strict` (or `Lax`) session cookies **plus** double-submit CSRF token (`X-CSRF-Token` header), or
- OAuth-style flows with short-lived tokens in memory only (keep Bearer in JS).

Document the chosen pattern in your deployment runbook before switching auth mode.
