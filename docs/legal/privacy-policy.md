# Flip Turn — Privacy Policy

Last updated: 2026-05-05
Contact: privacy@flipturn.ca

This is the privacy policy for the Flip Turn closed beta. We wrote it in plain language because the audience is a small group of swim parents in Ontario, and we'd rather be straight with you than hide behind boilerplate.

## What we collect

- **Your email address.** Used to sign you in via magic link and to contact you about the service.
- **Athlete identifiers.** Specifically, the Swimming Canada (SNC) athlete ID(s) for the swimmer(s) you manage. You provide these during onboarding.
- **Swim history.** Race results, splits, meet names, and dates that we pull from public sources tied to those SNC IDs (see "Data sources" below).
- **App usage and device info via crash reports.** When the app crashes or hits an unhandled error, Sentry collects a stack trace, device model, OS version, and a pseudonymous session ID so we can debug it.

## What we don't collect

- No payment information. The beta is free; we don't take cards.
- No precise location.
- No contacts, photos, or videos from your device.
- No microphone or camera access.
- No advertising identifiers, and no third-party analytics SDKs beyond Sentry.

## How we store it

Your data lives in a Postgres database running on a single Mac Mini in Waterloo Region, Ontario. The disk is encrypted at rest using macOS FileVault. Database backups are encrypted before being copied to off-site storage by a human operator (the founder). There is no cloud database provider in the loop.

## How we transmit it

All traffic between your phone and our server goes over TLS via a Cloudflare Tunnel. Cloudflare sees encrypted traffic only — they cannot read request or response bodies. Magic-link sign-in emails are sent through Resend, our email delivery provider.

## Who we share it with

We do not sell, rent, or share your data with anyone for marketing or analytics purposes. The only third parties that touch your data are processors operating on our behalf under PIPEDA terms:

- **Resend** — receives your email address and the body of the magic-link or transactional email so it can deliver it. They do not receive your swim data.
- **Sentry** — receives crash reports (stack traces, device info, session IDs). They do not receive your email, athlete IDs, or race results.
- **Cloudflare** — routes encrypted TLS traffic. They see source IP and TLS metadata, but not request or response contents.

That's it. No analytics, no ad networks, no data brokers.

## Data sources

We pull swim results from publicly available sources:

- **results.swimming.ca** — the official Swimming Canada results archive.
- **Host club and meet websites** — public meet result pages.
- **(Future, v2+) Live-results URLs you paste yourself** — for example, a Meet Mobile or live-timing URL during a meet you're attending.

All sources we scrape are public. We do not bypass authentication, paywalls, or robots.txt. We identify our scraper with a polite User-Agent and rate-limit our requests.

## Your rights under PIPEDA

Canadian privacy law (PIPEDA) gives you these rights, and we honour them:

- **Access** — Request a copy of the personal data we hold about you. Email privacy@flipturn.ca.
- **Correct** — If something is wrong, email us with the correction.
- **Delete** — Use **Settings → Delete Account** in the app, or email privacy@flipturn.ca. This triggers our `DELETE /v1/me` endpoint and removes your account-linked records (see "Data retention" below).
- **Withdraw consent** — You can stop using the app and delete your account at any time.

We respond to all requests within 30 days, usually much sooner.

## Children's data

Flip Turn is designed for parents and guardians of competitive swimmers, including swimmers under 18. The app account is operated by the parent or guardian, not by the swimmer. We do not collect anything directly from the swimmer — no profile, no email, no device data.

If your swimmer is under 13, please install and configure the app yourself and do not share your login credentials with them. If you are a swimmer under 18 reading this, ask a parent or guardian to set up the account.

## Data retention

- **While your account is active** — we retain your account data (email, athlete links, scraped swim history) as long as you keep using the service.
- **When you delete your account** — within 7 days, we delete the records tied to you personally: your `User` record, all `Session` records, and the `UserAthlete` join records that link you to specific swimmers.
- **Athlete records (the swim results themselves)** are retained because the source data (results.swimming.ca) is public and the same Athlete record may be linked to other parents on the platform.
- **Raw scrape archive** — we keep raw scraped HTML/JSON for up to 90 days for debugging and reprocessing, then delete it.
- **Crash reports** in Sentry are retained per Sentry's default policy (90 days).

If you want every trace gone, including the public swim record we ingested, see `takedown.md`.

## Updates to this policy

This document lives in our public repository at:
https://github.com/darrellbechtel/flipturn/blob/main/docs/legal/privacy-policy.md

If we make material changes, we will notify active beta users by email at the address you signed up with, before the changes take effect.

## Contact

Privacy questions, access requests, deletion requests, complaints:
**privacy@flipturn.ca**

If you are unsatisfied with our response, you may also contact the Office of the Privacy Commissioner of Canada (https://www.priv.gc.ca/).

## Legal disclaimer

This document is a plain-language draft intended to communicate honestly with our beta testers. It is not a substitute for legal advice. A Toronto SaaS/data lawyer will review and update this policy before Flip Turn begins charging or expands beyond the closed beta.
