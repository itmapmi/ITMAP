---
name: LinkedIn campaign onboarding goal
description: The user's business goal for converting LinkedIn Lead Gen Form submissions into ITMAP users.
---

LinkedIn campaign visitors should submit a prefilled Lead Gen Form, have their information passed into ITMAP's database, and go directly to the report page already registered, without completing another registration or password form.

**Why:** The user wants to run a LinkedIn campaign with minimal registration friction.

**How to apply:** Evaluate onboarding designs against this goal. Do not confuse automatic account registration with establishing an authenticated browser session.

**Report-first, email-secondary requirement:** The user said the visitor should not go to their mail to access the report. Email should be a secondary process, like the existing flow. This replaces the earlier email-first vendor-map destination.

**Why:** The user explicitly clarified that report access must follow LinkedIn submission directly, not an email-link visit.

**How to apply:** Do not make an email click a prerequisite for the primary report experience. Explain any browser-identity handoff limits before committing to an implementation.

**Authenticated arrival requirement:** The visitor must also be signed in when the report opens. Creating an account in the background while showing an anonymous report does not satisfy the goal.

**Why:** The user explicitly selected the option requiring sign-in on arrival.

**How to apply:** Evaluate the browser-session handoff as well as account registration. Do not present background registration alone as completion of this flow.

**Full buyer access requirement:** LinkedIn campaign users providing all required profile details should receive access to everything available to a normal completed-profile buyer, without further gates. The advertised report is the first destination, not the limit of their access.

**Why:** The user explicitly rejected a report-only campaign exception and said these users provide all the details normally needed for full access.

**How to apply:** Do not restrict the campaign policy to the selected report or require another profile/email step to unlock other normal buyer features. Keep email secondary and preserve role-specific/private-data authorization.

**Identical profile information requirement:** The LinkedIn form must map to the ITMAP profile form after signup; the user said they should be identical.

**Why:** The user explicitly requested this mapping.

**How to apply:** Keep the captured profile fields aligned and populate the ITMAP profile from the submitted answers without asking the visitor to enter them again.
