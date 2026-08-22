import type { Express, Request } from "express";
import { submitContactMessageSchema } from "@shared/schema";
import { storage } from "../storage";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 10_000;
const submissionsByIp = new Map<string, number[]>();

function requesterIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// Check and reserve a slot synchronously, before any awaited work. This makes
// concurrent bursts subject to the same limit as sequential submissions.
function admitSubmission(ip: string, now = Date.now()): boolean {
  if (submissionsByIp.size >= MAX_TRACKED_IPS && !submissionsByIp.has(ip)) {
    // Bound memory under rotating-IP abuse. Map iteration preserves insertion order.
    const oldestKey = submissionsByIp.keys().next().value;
    if (oldestKey) submissionsByIp.delete(oldestKey);
  }

  const recent = (submissionsByIp.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  );
  if (recent.length >= MAX_SUBMISSIONS_PER_WINDOW) {
    submissionsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  submissionsByIp.set(ip, recent);
  return true;
}

export function registerContactRoutes(app: Express): void {
  app.post("/api/contact-messages", async (req, res) => {
    const parsed = submitContactMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid message details",
      });
    }

    const ip = requesterIp(req);
    if (!admitSubmission(ip)) {
      return res.status(429).json({
        error: "Too many messages submitted. Please wait a few minutes and try again.",
      });
    }

    // Silently accept bot submissions caught by the honeypot, without saving.
    if (parsed.data.website) return res.status(201).json({ success: true });

    try {
      const { website: _honeypot, ...data } = parsed.data;
      const created = await storage.createContactMessage({
        ...data,
        vendorId: data.vendorId ?? null,
        vendorName: data.vendorName ?? null,
      });
      return res.status(201).json({ success: true, id: created.id });
    } catch (error) {
      console.error("Error saving contact message:", error);
      return res.status(500).json({ error: "Failed to send your message. Please try again." });
    }
  });
}