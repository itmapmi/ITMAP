---
name: Public contact spam controls
description: Concurrency and proxy-trust constraints for anonymous contact-form abuse protection.
---

Anonymous contact submissions must reserve their per-IP rate-limit slot synchronously before any awaited persistence, and honeypot values must pass parsing so the route can silently discard trapped submissions. Replit sanitizes and forwards the client address through `X-Forwarded-For`; configure Express to trust the Replit proxy boundary rather than relying on a fixed hop count, because its internal route can add a variable number of hops.

**Why:** An earlier implementation allowed concurrent bursts to pass before timestamps were recorded, rejected bot-filled honeypots before the trap could run, and a fixed two-hop trust setting retained a Google ingress IP instead of the visitor IP when Replit added an internal hop.

**How to apply:** Preserve these constraints when changing public contact forms, request validation, limiter storage, proxy topology, or submission persistence. Keep proxy configuration centralized and cover an additional-ingress-hop scenario in regression tests. Do not parse client-supplied forwarding headers manually.