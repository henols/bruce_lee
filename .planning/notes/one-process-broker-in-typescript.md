---
title: The broker, supervisor and pool become one TypeScript process
date: 2026-08-02
decided_by: developer (ext.henrikolsson@goodhabitz.com), in session
status: locked — amends Phase 01.6 criterion 2
context: >
  Phase 01.6 was scoped from the todo "shrink vice-broker.sh by moving logic into Node", whose
  criterion 2 kept process launch, signalling, the daemon loop and traps in bash. The developer
  clarified that this was narrower than intended: the supervisor and the pool were always meant to
  land in the same application as the broker, and TypeScript is the chosen language. This note is
  the decision record; the ROADMAP criteria are amended to match.
supersedes_in_part: .planning/todos/pending/2026-08-02-shrink-vice-broker-sh-by-moving-logic-into-node.md
---

# One process, one language

## What was decided

**D-1. Broker + supervisor + pool are one application, and one *process*.**
Not one codebase with subcommands spawning children — genuinely one process. Developer's rationale,
verbatim: *"the broker has direct access to everything and can act fast on requests."* The three
host-side shell scripts retire together:

| Retires | lines (2026-08-02) | What it did |
|---|---|---|
| `resources/vice-broker.sh` | 2,103 | singleton daemon — coordination, spares, grants, leases, ports |
| `resources/vice-pool.sh` | 611 | pool commands (paired with `vice-pool.mjs`, 753) |
| `resources/vice-supervisor.sh` | 443 | **per-instance** respawn loop, restart-epoch file, identity-verified kill |

3,157 lines of bash. Note the shape change this forces: `vice-supervisor.sh` is currently one
process *per emulator*, and it **outlives broker restarts**. That is what makes the restart-epoch
file trustworthy as an independent channel today. Collapsing it into the broker removes that
independence, which is why D-3 exists.

**D-2. TypeScript, compiled, with the build output deployed.**
Chosen over plain `.mjs` after the trade was put explicitly (see § The trade, below). The
developer reaffirmed TypeScript after the cost was named, so it is locked, not a default.

**D-3. No orphaned `x64sc`. Ever. This is a hard constraint, not a goal.**
The developer's phrasing was *"when a SIGKILL shows up the broker must tell the supervisors to take
down the x64sc processes."* The intent is adopted in full; the mechanism cannot be that, and the
reason is a kernel fact rather than a design preference.

## The SIGKILL correction

**SIGKILL (9) and SIGSTOP (19) cannot be caught, blocked or handled.** A process receiving SIGKILL
executes no further instructions — no signal handler, no `process.on("exit")`, no `atexit`, no
`finally`. In a one-process design there is additionally no supervisor left to be told anything.
Any orphan-prevention scheme that requires the dying process to run code is unavailable by
construction.

Recording this explicitly because it is exactly the class of assumption this project has been burned
by before: a mechanism that reads as obviously correct, is never tested against the failure it
exists for, and turns out to be structurally incapable of firing.

The constraint is therefore delivered in three layers:

**L1 — every catchable signal.** `SIGTERM`, `SIGINT`, `SIGHUP`, `uncaughtException`,
`unhandledRejection` and normal exit: the broker kills every tracked child itself, identity-verified
against the pid recorded at spawn — reusing Phase 01.3 criterion 6's verified-kill discipline rather
than re-deriving it. This is the "take them down" behaviour and it covers every ordinary shutdown.
It is *not* a guarantee, because it does not cover the case the constraint is written for.

**L2 — SIGKILL, OOM-kill, power loss: the guarantee moves to startup.** Since nothing runs at death,
the load-bearing mechanism is:

- a **durable pid registry written at spawn time**, before the instance is ever grantable (Phase
  01.5 criterion 3 already requires the epoch record to carry the pid, and already requires a
  `kill -0`/port probe before a grant is honoured); and
- **unconditional identity-verified reap on startup** — which Phase 01.6 criterion 7 *already
  mandates*, for precisely this reason: *"The reap must be unconditional on startup, not only on
  clean shutdown, since a SIGKILLed broker never runs its shutdown path."*

The window in which a stray `x64sc` can exist is bounded by "the broker is down", and during that
window nothing can be granted — there is no broker to grant it. So a stray can exist briefly; it
can never be handed to a session, and it can never be mistaken for continuity, because the reap
bumps its epoch and `assertSameMachine()` already turns that into `MachineRestartedError`.

**L2 is non-negotiable. It is the layer that makes D-3 true.**

**L3 — prevention, investigated with a recorded verdict.** The only route that kills strays at the
instant the parent dies *without* reintroducing a per-instance process is a **cgroup per broker
run** — put every launched `x64sc` in it, and write `cgroup.kill` on startup. `PR_SET_PDEATHSIG` is
the textbook answer and is **rejected here**: Node core has no `prctl` binding, so it needs either a
native addon (a compile-on-host dependency, on the machine nobody is watching) or a per-instance
wrapper process — which is the supervisor process D-1 just deleted. cgroup access is host-dependent,
so this is answered with evidence, and **a negative answer is a real result** — the same standard
Phase 01.3 criterion 8 and Phase 01.6 criterion 12 already apply to host-side unknowns. If cgroups
are unavailable, L1+L2 ship and the verdict is recorded.

## The trade on TypeScript, recorded so it is not re-argued from zero

Named before the decision, and the decision went to TypeScript anyway. Both sides are here so a
later reader sees a choice, not an accident.

**Cost, and it is real.** There is currently **no TypeScript anywhere in this repo** — no
`tsconfig.json`, no root `package.json`, no `node_modules`, zero JS dependencies. The 268-test suite
runs on bare `node --test .claude/mcp/vice/*.test.mjs` with no build step of any kind. Today what is
committed is byte-identical to what `install-resources.mjs` copies to the host. A compile step ends
that property.

**Benefit, and it is also real.** The grant/lease/spare/port state machine is exactly where a
stringly-typed state bug already cost an outage (2026-08-01, three simultaneous `x64sc` launches).
And `tsconfig`'s `target`/`lib` converts the unrecorded host Node version from a landmine into a
pinned setting that cannot be accidentally violated — which is a strictly better answer to Phase
01.6 criterion 1 than "record `node --version` and hope."

**Build topology this implies** (to be confirmed in 01.6's first plan, not assumed here):
authored TS in a source directory → `tsc` → JS committed under `resources/` → `install-resources.mjs`
copies `resources/` to the host's gitignored `tools/` exactly as it does today. The host then needs
only `node`, never `tsc` or `npm`. `install-resources.mjs` is container-side and already
directory-listing driven, so it deploys new files with no code change.

**The trap this creates, and it must be handled explicitly.** `./.claude/CLAUDE.md` currently says
to *"edit the host shell scripts in its `resources/` directory; the deployed copies are generated and
gitignored."* Under the build topology above, `resources/` stops being authored source and becomes
generated-but-tracked output. Someone following the current instruction edits a build artifact and
watches it vanish on the next build — silently. Phase 01.6 must update that CLAUDE.md rule in the
same change that inverts the directory's meaning, and should carry a generated-file banner plus a
test asserting `resources/` is in sync with the TS source.

## Consequences for Phase 01.6's existing criteria

| Criterion | Effect |
|---|---|
| 1 (host `node` gate) | Strengthened. The version bound becomes a `tsconfig` `target`, not a hope. Still record the host's actual `node --version` at first invocation. |
| **2 (what moves vs stays)** | **Amended — this is the criterion the decision rewrites.** Its "Staying" list (`launch_instance`, `signal_recorded_pid`, `reap_all_instances`, the daemon loop and traps, `port_in_use`, the host `curl` probe) no longer stays. It moves, because there is no second process to hold it. |
| 4 (the lease is the connection) | Unchanged and now cheaper — one process owning both the control listener and the child processes needs no cross-process handshake to tie them together. |
| 7 (reap on startup bumps every epoch) | **Promoted from a correctness rule to the load-bearing half of D-3.** Already worded as unconditional-on-startup; that wording is now doing more work than when written. |
| 8 (broker death takes the session) | Unchanged in verdict, larger in blast radius: with supervision in-process, broker death ends supervision too. Already an accepted trade; the acceptance now covers more. |
| 9 (existing suite passes across the move) | Harder. The suite is `.mjs` and invoked by glob; a TS build changes how tests are authored and run. Sequence so the suite stays green continuously rather than being ported in one jump. |
| 10 (`install-resources.mjs` deploys new files) | Unchanged mechanism, higher stakes — it now deploys build output, so a stale build deploys stale code silently. |
| 11 (two brokers cannot run at once — CR-01) | Unchanged and still required. A single TCP listener is still the kernel-enforced singleton. |

## Open questions — for 01.6 planning, not decided here

1. **Does TypeScript stop at the broker application, or eventually cover `vice-proxy.mjs` and the
   rest of `.claude/mcp/vice/`?** The decision as given was scoped to *the broker application*
   (broker + supervisor + pool). The container-side proxy is a different component and is **not**
   in scope by this note. Phase 01.4 is editing `.mjs` proxy files right now on that assumption.
2. **Is the `vice-pool.mjs` / `vice-pool.sh` split absorbed entirely, or does the container-side half
   of the pool survive as a separate concern?** D-1 says the pool joins the application; the
   existing split is host/container, not shell/node, so which side "the pool" means needs settling.
3. **Sequencing inside 01.6.** The phase now carries three changes — consolidate three programs into
   one, change language, change transport. Its own recorded risk is that relocating code and
   changing its protocol together leaves a regression with no single candidate cause. Three changes
   is worse than two. Consider whether this warrants a split before planning.
4. **Does the one-process design change how a wedged emulator is detected?** Phase 01.3's recovery
   path was designed against a separate supervisor holding the respawn loop. Worth a read-through
   when 01.3 resumes, since 01.3 is sequenced *after* 01.6.

## Related

- Amends: `.planning/todos/pending/2026-08-02-shrink-vice-broker-sh-by-moving-logic-into-node.md`
- Design source it joins: `.planning/notes/broker-control-plane-over-tcp.md`,
  `.planning/seeds/broker-restart-reaps-and-voids.md`
- Phase 01.5 must land first regardless — its criterion 3 (a grant proven live before it is honoured)
  and criterion 4 (lazy replenishment) are prerequisites for L2's pid registry being meaningful.
