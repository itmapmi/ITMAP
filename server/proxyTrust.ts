import type { Express } from "express";

/**
 * Replit deployments sanitize and forward the originating client address in
 * X-Forwarded-For. The exact number of internal hops can vary by deployment
 * path, so a fixed numeric proxy count can stop at a Google ingress address
 * instead of the visitor's address.
 *
 * Trust the forwarding headers at the application boundary as Replit
 * documents for Express. Replit owns the public ingress and protects the
 * header before it reaches this service.
 */
export const TRUST_REPLIT_PROXY = true;

export function configureProxyTrust(app: Express): void {
  app.set("trust proxy", TRUST_REPLIT_PROXY);
}