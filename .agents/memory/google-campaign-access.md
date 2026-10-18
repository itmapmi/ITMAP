---
name: Google campaign buyer access
description: Access policy for visitors signing in through Google advertising campaigns.
---

Google campaign visitors should have normal signed-in buyer access, but must complete their profile to access Reports and Intelligence "as usual."

**Why:** The user explicitly clarified this after discussing Google One Tap and being asked whether Google campaign visitors should receive the LinkedIn full-access bypass.

**How to apply:** Preserve the existing profile/company-email verification gate and its existing applicability rules. Do not grant the LinkedIn campaign profile bypass merely because someone arrived through a Google ad or used Google sign-in. Keep the advertised market as the destination; profile completion is for gated features, not a prerequisite for initial market arrival.

**Campaign-only One Tap scope:** Add One Tap to advertised-market arrivals with an explicit Google sign-in fallback, without replacing ordinary signup or LinkedIn campaign authentication.

**Why:** The user approved this market-first design after being told that automatic sign-in is conditional and that first-time/browser-limited visitors may need additional interaction.

**How to apply:** Keep anonymous browsing under the existing teaser rules when Google is unavailable or dismissed. Do not promise every ad click is authenticated, and do not broaden One Tap to all ordinary visitors without a separate request.

**Confirmed behavior:** The user confirmed that the Google authentication-based campaigns are working.

**Why:** This was an explicit live-use confirmation, beyond simulated development verification.

**How to apply:** Preserve the working campaign entry URLs and authentication flow when changing public rendering or search metadata.
