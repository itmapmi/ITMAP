import type { Express } from "express";

/**
 * Replit deployments reach the app through two infrastructure hops:
 * the public Google load balancer and Replit's internal reverse proxy.
 *
 * Trusting exactly two hops lets Express select the real client address while
 * still ignoring any additional X-Forwarded-For values supplied by a visitor.
 */
export const TRUSTED_PROXY_HOPS = 2;

export function configureProxyTrust(app: Express): void {
  app.set("trust proxy", TRUSTED_PROXY_HOPS);
}