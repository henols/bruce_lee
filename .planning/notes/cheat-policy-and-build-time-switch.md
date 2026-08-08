---
title: Cheats are documented and off by default — an ACME build-time switch in the rebuild, attempt-7 disclosure on the originals
date: 2026-08-08
context: /gsd-explore session on "if there is a cheat in the game it must be documented and a possibility to disable it so the game is working as intended"
---

# Cheats: documented, and off unless you ask for them

## The rule

**Any behaviour that is not the original game's must be documented, and must be excludable.**
One rule, deliberately — an inherited cracker trainer and a harness memory-poke are the same
failure when they go unrecorded: behaviour in the evidence that the game does not have.

The rule has two mechanisms, because the two live in different places.

| Where the cheat lives | How it is disabled | Default |
|---|---|---|
| The **rebuild's ACME source** | Conditional assembly — the bytes are not emitted at all | Off. The default build is the game as Datasoft shipped it. |
| The **cracked originals**, poked live during recovery | Nothing to switch — there is no source to wrap. Disclosure only. | N/A — it is opt-in already; every application must be recorded. |

The developer's framing (2026-08-08): *"rebuild, so you can decide if you want the cheats or
not."* The switch is a property of the build, not of the running game.

## Why assembly-time and not a runtime toggle

A runtime toggle — a flag in RAM, a key combo — keeps the cheat's bytes in the shipped
artifact. The default `.prg` would then still contain code the original never had, merely
inert. Conditional assembly removes it outright, so "the default build has no cheat in it" is
a statement about the binary rather than about its control flow.

**This costs nothing here**, and that is not obvious until you check the gate. Commit
`178c48a` stripped byte-identity from `ROADMAP.md` and `REQUIREMENTS.md`, and
`REQUIREMENTS.md` § Out of Scope now names *"Byte-identical rebuild, at any stage and in any
role"* as excluded, with behaviour the only gate. So a build that omits bytes, shifts layout,
and moves every downstream address is still judged the same way: checkpoint replay against the
baselines. In a project that *did* hold byte-identity, this decision would have been expensive.

## What is already established, and must not be re-derived

From plan 01-04 attempt 7 (2026-08-06), all live-verified:

- **The lives counter is `$0028`** (zero page). Found by two independent
  `vice_memory_compare(mode: snapshot)` differentials across confirmed deaths, corroborated at
  its write site — `$1826: DEC $28 / BMI $188E` — and at a read site, `$1774: LDA $28`, which
  feeds the `FALLS` HUD digit.
- **The community-published `$1560` (`POKE 5472,99`) is wrong** on both cracked releases.
  Tested live and disproved. The published finding's own caveat — *"on a cracked release with a
  relocating loader it may not hold"* — turned out to be true.
- `vice_memory_write($0028, 99)` works identically on danish and saeger, persists through a
  real death, and **resets to `04` on every F7 game-start**, so it is re-applied per game, not
  once per session.
- It **does not** unblock the `x~290-304` hazard. Unlimited lives removed the game-over
  consequence and changed nothing about the survival problem.

Attempt 7 disclosed its use through an `attempt7-cheat-` filename prefix on all 22 screenshots
and an `attempt_7_note` field in both `*-loading-hits.json` files, and kept every cheat-round
capture out of the canonical image and out of every byte-provenance claim. **That is the
recovery-side mechanism, and it stays** — it is convention rather than enforcement, which is a
known and accepted limit, not an oversight.

## The detection problem

A policy that says "document the cheat" presupposes finding it, and **nothing in the pipeline
currently hunts for one.**

The provenance diff flags bytes where danish and saeger disagree, but classifies them as
"cracker patch" without sorting *loader/cracktro glue* from *gameplay-altering trainer*. Worse,
it has a structural blind spot:

> **A two-release diff cannot see a trainer that both releases contain.**

Two independent cracks would be unlikely to add the same trainer — but "independent" is
precisely what **`RECOVER-07`** exists to determine, and it is still open. Shared ancestry
means a shared trainer is invisible to the diff, and the active signature hunt stops being a
backstop and becomes the only detector. **Trainer detection is therefore gated on
`RECOVER-07`'s ancestry verdict**, and reading it the other way round — treating a clean diff
as proof of no trainer — is the specific mistake to avoid.

This is why the exploration commissioned an active hunt rather than diff classification alone.

## Where this landed

- **`MAP-06`** (Phase 2) — gameplay-altering cracker patches identified and catalogued,
  separated from loader glue, by diff *and* by signature hunt.
- **`BUILD-08`** (Phase 7) — default build contains no cheat or debug code; every cheat behind
  a conditional-assembly switch, named in one registry.
- **Todo** `2026-08-08-hunt-for-inherited-trainers-in-both-cracked-releases.md` — the concrete
  signature recipe, so Phase 2 does not re-derive it.
- **`RE-FINDINGS.md`** — the diff blind spot, logged as a hazard.

## Deliberately not decided

- **Where the registry lives, and its format.** `BUILD-08` requires one place naming each
  cheat; it does not say whether that is a `docs/` page, an ACME include, or a JSON file the
  build reads. Settle it when the source tree exists — Phase 7, or Phase 5 if a cheat is wanted
  earlier for reaching late chambers.
- **Phase 5 versus Phase 7 for the requirement.** Filed at Phase 7 because that is where the
  complete source tree and its build are the deliverable. It first *bites* in Phase 5, when
  combat and the lives counter are reconstructed and a cheat becomes useful as an RE aid. If
  Phase 5 wants one, `BUILD-08`'s convention has to be settled at that point rather than at
  Phase 7.
- **Whether the rebuild should carry cheats at all.** The policy says *if* it does, they are
  documented and off by default. It does not commission writing any.
- **Whether recovery-side disclosure should become mechanical.** Options were put and the
  developer chose the rebuild switch instead; convention-plus-filename stands. Revisit only if
  a cheat-tainted capture is ever found in an evidence set — that would be the evidence that
  convention was not enough.
