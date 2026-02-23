/**
 * Apify Ad-hoc webhooks must be passed as a base64-encoded JSON array via the
 * `webhooks` URL parameter (NOT in the JSON body).
 *
 * Docs: https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks
 */

// Base64 encode in a UTF-8 safe way for Deno.
function base64EncodeUtf8(input: string): string {
  // encodeURIComponent produces UTF-8 percent-encoded bytes; unescape converts
  // those bytes to a binary string consumable by btoa.
  // (unescape is deprecated on the web, but available in Deno and fine here.)
  // deno-lint-ignore no-deprecated
  return btoa(unescape(encodeURIComponent(input)));
}

export function withApifyAdHocWebhooks(
  url: string,
  webhookDefs: unknown,
): string {
  const json = JSON.stringify(webhookDefs);
  const encoded = base64EncodeUtf8(json);
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}webhooks=${encodeURIComponent(encoded)}`;
}
