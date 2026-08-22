---
name: Public contact spam controls
description: Concurrency and proxy-trust constraints for anonymous contact-form abuse protection.
---

Anonymous contact submissions must reserve their per-IP rate-limit slot synchronously before any awaited persistence, and honeypot values must pass parsing so the route can silently discard trapped submissions. Replit production currently has two trusted infrastructure hops (Google load balancer plus Replit reverse proxy); trust exactly those two when deriving the client IP.

**Why:** An earlier implementation allowed concurrent bursts to pass before timestamps were recorded, rejected bot-filled honeypots before the trap could run, and trusted arbitrary forwarded-IP values.

**How to apply:** Preserve these constraints when changing public contact forms, request validation, limiter storage, proxy topology, or submission persistence. Keep the hop count centralized and covered by a spoofed-leftmost-header test. If the deployment topology changes, reassess the exact trust setting rather than broadening it unconditionally.