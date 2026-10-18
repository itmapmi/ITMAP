import { JWT } from "google-auth-library";
import { PUBLIC_SITE } from "../publicContent";

export function searchConsoleConfig() {
  const property = process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY || `sc-domain:${new URL(PUBLIC_SITE).hostname}`;
  // Deliberately only the canonical public site, never arbitrary admin-supplied URLs.
  const allowed = [`sc-domain:${new URL(PUBLIC_SITE).hostname}`, `${PUBLIC_SITE}/`];
  if (!allowed.includes(property)) {
    return { configured: false, property, message: "Property must be the canonical site's Domain or HTTPS URL-prefix property." };
  }
  const configured = Boolean(process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS);
  return {
    configured, property,
    message: configured
      ? "Credentials configured; property access is verified only by a successful inspection."
      : "Not connected. Configure a read-only Search Console service account using the setup guide. Google sign-in credentials are not Search Console authorization.",
  };
}

export function inspectionClient(): JWT {
  const credentials = JSON.parse(process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS || "{}");
  if (credentials.type !== "service_account" ||
      typeof credentials.client_email !== "string" ||
      typeof credentials.private_key !== "string") {
    throw new Error("invalid-credentials");
  }
  // Do not trust endpoints or extra fields from the JSON. No login OAuth changes.
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    transporterOptions: { timeout: 15000, retry: false },
    forceRefreshOnFailure: false,
  });
}
