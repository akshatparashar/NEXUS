# Postmortem: checkout outage, 7 November (sample document)

This is a sample document for trying NEXUS. The incident is fictional.

## Summary

Checkout failed for 47 minutes, from 02:13 to 03:00 UTC, because the TLS certificate for the payments gateway expired. About 1,900 orders failed during the window; 1,240 were retried successfully by customers within 24 hours.

## Timeline

At 02:13 UTC the certificate expired and every call to the payments gateway was rejected. At 02:21 the on-call engineer was paged by the error-rate alert. At 02:38 the cause was identified. At 02:55 a new certificate was issued and deployed, and checkout recovered at 03:00.

## Root cause

The certificate was renewed by hand once a year. The engineer who owned the renewal left the company in June, and the renewal reminder went to a deactivated mailbox.

## Follow-ups

1. Automate certificate renewal for the payments gateway. Owner: none yet.
2. Alert 21 days before any certificate expires. Owner: Platform team.
3. Move renewal reminders to a shared team mailbox. Owner: none yet.
4. Add the payments gateway to the synthetic checkout test. Owner: Checkout team.
5. Document certificate ownership in the service catalogue. Owner: none yet.

Automated renewal is the only follow-up that prevents a repeat. Expiry alerts shorten the next outage but do not prevent it.
