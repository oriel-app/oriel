# 0001 Web, not desktop

Accepted 2026-10-28. Amended by 0029: the desktop app is phase 2 and the next milestone, wrapping this same server; pilots get it rather than a hosted instance, and it may use the OS, as a keychain does. A review link must still open in a browser for someone who has installed nothing.

**Decision.** Oriel is a web app served by one Node process. No desktop shell.

**Why.** A review link has to open from Slack, Teams or email for someone who has installed nothing, and the five-minute onboarding budget can't include an install. Pilots get a hosted instance.

**Consequences.** No OS integration. The sandbox runs on the server. A desktop shell can wrap the same server later.
