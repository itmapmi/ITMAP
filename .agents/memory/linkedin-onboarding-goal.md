---
name: LinkedIn campaign onboarding goal
description: The user's business goal for converting LinkedIn Lead Gen Form submissions into ITMAP users.
---

LinkedIn campaign visitors should submit a prefilled Lead Gen Form, have their information passed into ITMAP's database, and go directly to the report page already registered, without completing another registration or password form.

**Why:** The user wants to run a LinkedIn campaign with minimal registration friction.

**How to apply:** Evaluate onboarding designs against this goal. Do not confuse automatic account registration with establishing an authenticated browser session.

**Latest destination and timer requirement:** The user subsequently described arrival on the markets page, automatic registration using the form email, background profile completion, no registration-timer popup, and direct logged-in arrival. Verification email may be sent in the background.

**Why:** The user explicitly described this desired workflow after rejecting inbox and LinkedIn sign-in steps.

**How to apply:** Use the markets page for the latest proposed arrival flow rather than assuming the earlier report destination still applies. Do not mistake suppressing the anonymous timer for authenticating a visitor; full logged-in arrival still requires a supported identity handoff.

**No second email entry:** The user does not want someone to complete the LinkedIn form, visit ITMAP, and provide another email ID to register.

**Why:** The user explicitly said this would cause a mismatch/mapping issue.

**How to apply:** Do not propose a second email-entry registration as the solution. A single ITMAP-hosted form instead of the native LinkedIn form is only an alternative to discuss, not an approved change to the campaign.

**Native prefilled form is essential:** The user rejected moving the form to ITMAP: "the whole idea of the linkedin form is its prefilled and ready to submit. so conversion is higher. I dont want them to do that on my site."

**Why:** The user prioritizes the conversion benefit of LinkedIn's native prefilled submission.

**How to apply:** Keep the native LinkedIn Lead Gen Form as the campaign entry. Do not continue proposing an ITMAP-hosted replacement or repeat email entry. Explain any remaining authentication limitation without implying that anonymous campaign access satisfies logged-in arrival.

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

**LinkedIn sign-in boundary:** Normal signup must not have a LinkedIn button. The user subsequently approved campaign-only LinkedIn authorization and accepted a first-time LinkedIn permission screen. They still reject an email-link/code claim step and repeat email entry.

**Why:** After initially rejecting LinkedIn sign-in, the user explicitly selected "Yes—use campaign-only LinkedIn authorization" when the first-time consent screen and unchanged normal signup were explained.

**How to apply:** Preserve ordinary signup and keep LinkedIn authorization confined to the campaign completion handoff. Do not substitute a mandatory email link/code or ask for another email. Explain that authorization may show consent/login rather than being universally invisible, and still prove lead-to-member correlation before populating a profile or granting campaign buyer access.

**Provider identity constraint:** LinkedIn lead responses expose a submitter person URN for non-guest leads, but person IDs are application-scoped and OIDC subjects are pairwise. A bridge's member identifier must not be assumed to match ITMAP's sign-in identifier. Work email may also differ from the sign-in primary email.

**Why:** Official LinkedIn Lead Sync schema, Profile API, and OIDC documentation establish these constraints; unsafe correlation could populate the wrong user's profile or grant access without a matched submission.

**How to apply:** Prove lead-to-sign-in correlation using actual provider evidence before activating campaign onboarding. Make documents custom client credentials for its LinkedIn Lead Forms connection, which is a potential same-app route, not proof that the identifiers match. Own-app Lead Sync access requires separate LinkedIn approval. Do not substitute names, shared CTA URLs, or inferred email ownership.
