# 0063 A screenshot is evidence, not a test

Accepted 2026-11-11. Amends 0015.

Adds: none

**Decision.**

- **Pictures are evidence for a person.** `pnpm shots` takes them, for a change's before/after and for looking at. They never pass or fail a change. A copy or layout change has before/after shots as its proof and no test.
- **Behaviour has behaviour tests.** A scene in `scripts/shots.ts` that checks behaviour says so in a `test:` line. Its checks (`check`, `expectCount`, `atOnce`) only read. `pnpm ui-test` runs those scenes' steps and checks, light, at 1280, and also at 390 where the behaviour differs by width (`testAt`), plus the first run's timed onboarding on each path. It takes no pictures and runs in parallel workers, each with its own servers. `pnpm shots` runs the same steps, skips the checks, and fails a scene that checks without a `test:` line. Both runners use one scene list and one setup, so a scene's world is built in one place.
- **Retrying waits only** in a behaviour test: a locator's `waitFor`, `waitForURL`, `until`. No timers and no counted frames.
- **CI's ui job runs `pnpm ui-check` and `pnpm ui-test`,** never `pnpm shots`. It is still path-filtered and not required.
- **The whole set is shot once a night on main** and by hand: a builder shoots their change's own scenes, and the whole set when the brief asks for it.
- **The budget.** `pnpm ui-test` finishes in under 3 minutes on CI. A whole set takes under half of the 2026-11-11 time on the maintainer's Mac. To get there, a scene's steps run once per width, and it is shot light and then dark from the same page. A scene's own server closes after its shots.

**Why.**

- A whole set was about 1,200 shots and took 14 minutes on the Mac. Every builder changing the window ran it twice, and CI ran it on each window PR, though fewer than 40 scenes checked anything.
- A picture can't fail for the right reason. A raster speck or a self-scrolling page fails it, and a broken behaviour it doesn't show passes it. A person reading before/after pictures catches what they show. A test catches what they don't: a count, a position, a time, what the server holds.
- With one scene list, a check can't drift from the state its picture shows.

**Rejected.**

- A component test runner, as a separate suite against a fake backend: it isn't on the allowlist, and it would copy each scene's setup.
- Comparing screenshots in CI against stored ones: Chrome's noise alone differs on about 12 of 452 scenes at tolerance 15.

**Consequences.**

- A console error in a scene with no test now surfaces only when someone shoots it: by hand or at night.
- 0015 said CI never runs `pnpm shots`. #199 started running it without a decision. CI no longer does.
- The unit-tests skill's Flow layer is a behaviour test, not a shots scene that asserts.
