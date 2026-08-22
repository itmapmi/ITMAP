---
name: App Storage bucket replacement
description: What to do when production upload signing still targets an inaccessible legacy bucket.
---

Creating a new App Storage bucket does not automatically retarget an application's legacy upload bindings. Select the replacement bucket explicitly in app configuration while retaining a fallback for environments that still use the legacy binding.

**Why:** Production can have all expected storage settings present while the managed signing sidecar returns 401 because those settings still identify an old bucket. The bucket creation screen only provisions storage; it does not prove the upload service switched to it.

**How to apply:** After provisioning a replacement bucket, configure the app to use its bucket identifier, restart the runtime, request a signed PUT URL, perform a small upload, and remove the smoke-test object before publishing.