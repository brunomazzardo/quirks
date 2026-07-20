# Quirks — Portable Agent Campaigns Plugin Design

Date: 2026-07-20

Status: APPROVED CONVERSATIONAL DESIGN — awaiting written-spec review

Repository: `brunomazzardo/quirks`

## 1. Decision

Quirks is a standalone, project-agnostic agent plugin for safely running one or
many repository tasks through external agent CLIs. It
supports interactive work, unattended overnight campaigns, task dependency
scheduling, model/effort routing, delegated design, independent review, durable
recovery, integration, merge, and an optionally approved push.

The plugin is the only maintained copy of its orchestration skills. Target
projects provide a small versioned adapter and their own execution instructions;
they do not copy Quirks skills into each repository.

Quirks uses the open Agent Skills directory format and includes a Codex plugin
manifest. The same canonical skill directories are exposed to Claude Code and
Cursor through installer-managed integration rather than copied implementations.
Claude Code, Codex, and Cursor are host control surfaces; they all invoke the
same local `quirks-campaign` control plane. Claude, Codex, Cursor, and future
agent CLIs are runners behind one dispatch contract. External CLI dispatch is
the normative version-one portability boundary. Native harness subagents may be
added later as an optimization, but are neither required nor accepted as proof
of portable behavior.

## 2. Goals

Version one must:

- run an exact approved set of tasks from different project task systems;
- preserve each project's task source of truth and lifecycle rules;
- compute dependency-safe execution waves and serialize overlapping work;
- support both human-guided and explicitly delegated brainstorming;
- integrate with Superpowers-style brainstorm → specification → plan → execute
  → review workflows without weakening their human mode;
- assign the right model and reasoning effort to supervision, architecture,
  implementation, and review;
- dispatch external CLI agents without contaminating the campaign supervisor's
  context;
- launch the same campaign control plane from Claude Code, Codex, or Cursor and
  dispatch Claude, Codex, and Cursor CLI workers from every host;
- spread independent work across healthy provider accounts and model pools to
  use separate quotas without weakening task tier, authority, or review gates;
- verify work on disk and reproduce acceptance evidence rather than trusting
  agent summaries;
- merge accepted work into an approved target and optionally push the exact
  approved remote/branch;
- recover honestly after process, harness, machine, quota, or agent failure;
- carry verified learnings across tasks without silently changing requirements;
  and
- remain free of project names, project paths, personal account names,
  credentials, and repository-specific commands.

## 3. Non-goals

Version one is not:

- a hosted orchestration service;
- a replacement for GitHub Issues, project JSON ledgers, Jira, or other task
  authorities;
- a universal task database;
- an authorization bypass for production or external-system mutation;
- an autonomous requirements generator that can expand its own campaign scope;
- a generic remote shell or arbitrary command broker;
- a credential store;
- a mechanism for workers to approve or merge their own work;
- a promise that every agent CLI has identical capabilities; or
- transparent migration or live resumption of a campaign on another device;
- dependence on a host's native subagent facility for campaign correctness; or
- a self-modifying skill system during a live campaign.

## 4. Terminology

- **Campaign**: one approved multi-task run against one repository and target.
- **Campaign envelope**: the immutable task, authority, budget, model, Git, and
  verification contract approved before execution.
- **Campaign Supervisor**: the principal judgment agent that owns scheduling,
  gates, recovery, integration, and reporting, but not implementation.
- **Host harness**: Claude Code, Codex, Cursor, or another interactive control
  surface from which an operator starts, inspects, resumes, or cancels Quirks.
- **Control plane**: the host-independent local `quirks-campaign` process and
  watchdog that own runner lifecycle, durable state, and verification.
- **Project adapter**: a project-owned executable implementing Quirks' versioned
  task protocol.
- **Normalized task**: the read model returned by an adapter for scheduling and
  routing. It never replaces the native task record.
- **Runner**: an external agent CLI plus one configured account/model profile.
- **Lane**: a sequence of tasks that must not run concurrently because they
  share files, resources, state, or a warm implementation session.
- **Judgment model**: a model approved for supervision, architecture, or
  adversarial review rather than mechanical execution.
- **Delegated design**: an explicitly approved replacement for human design
  checkpoints using a principal architect, independent review, and a bounded
  decision envelope.

## 5. Plugin architecture

The repository will use this conceptual structure:

```text
quirks/
  .codex-plugin/
    plugin.json

  skills/
    running-agent-campaigns/
      SKILL.md
      references/
    dispatching-external-agents/
      SKILL.md
      references/
    delegated-brainstorming/
      SKILL.md
      references/

  scripts/
    quirks-campaign
    quirks-adapter
    quirks-runner-preflight
    quirks-watchdog

  schemas/
    project-adapter-v1.schema.json
    normalized-task-v1.schema.json
    campaign-v1.schema.json
    campaign-event-v1.schema.json
    campaign-state-v1.schema.json
    host-profile-v1.schema.json
    runner-profile-v1.schema.json

  references/
    parent-protocol.md
    model-routing.md
    security-boundaries.md
    installing.md
    authoring-project-adapters.md
    hosts/
      claude-code.md
      codex.md
      cursor.md
    runners/
      claude.md
      codex.md
      cursor.md

  tests/
    fixtures/
    fake-runners/
    skills/
    integration/
```

### 5.1 `running-agent-campaigns`

This is the parent skill invoked for “run these tasks,” “continue the queue,” or
“work overnight.” It owns:

- campaign preflight and approval presentation;
- task selection and dependency closure;
- supervisor qualification;
- adapter and task claims;
- wave/lane planning;
- delegated-design routing;
- integration, final review, merge, and approved push;
- durable state and crash recovery;
- budgets, circuit breakers, and stop decisions; and
- final reporting and learning promotion.

It does not implement task scope.

### 5.2 `dispatching-external-agents`

This is a lower-level skill used by the supervisor or a bounded dispatch parent.
It owns:

- the host-independent control-plane contract;
- runner discovery and smoke tests;
- exact CLI invocation and output handling;
- sandbox/capability selection;
- session identifiers, resume, and scoped cancellation;
- liveness and wall-clock watchdogs;
- usage-limit classification and quota routing;
- result normalization;
- on-disk verification expectations; and
- cross-vendor reviewer selection.

Runner-specific flags and known quirks live in reference files, not in the
campaign skill. Updating one runner does not change task semantics.

The old dispatcher rule that requires a Claude-native Sonnet parent does not
carry forward. `quirks-campaign` and its watchdog are the durable parent. A host
harness may exit or lose its conversational turn without becoming the campaign
state authority; a later invocation reattaches by campaign ID and reconstructs
state from the journal.

### 5.3 `delegated-brainstorming`

Human-guided design invokes the installed Superpowers brainstorming workflow
unchanged. Delegated mode uses this companion skill because it would be dishonest
to claim that a human reviewed a specification when they delegated that review.

The companion preserves the same artifact sequence and design discipline:

```text
context discovery → questions/assumptions → alternatives → proposed design
→ written specification → self-review → independent design review → plan gate
```

It replaces human checkpoints only with the exact campaign approval envelope and
an independent qualified reviewer. The resulting specification and plan remain
compatible with Superpowers file and workflow conventions.

### 5.4 Scripts and schemas

Skills contain judgment and workflow policy. Dependency-free scripts enforce
mechanical invariants: schemas, state transitions, event journaling, hashes,
locks, budgets, adapter framing, bounded output, and deterministic reports.

No safety property that can be enforced by a validator should exist only as
prose in a skill.

### 5.5 Reconciliation with the working prototypes

Quirks is a generalization of the existing user-level dispatcher and repository
overnight skills, not a clean-room replacement that discards their operational
evidence:

| Prototype | Preserve in Quirks | Replace or move behind an adapter |
|---|---|---|
| User-level `dispatching-external-agents` | Per-CLI flags and result locations; permission-denial detection; session resume; quota/reset classification; foreground/wedge lessons; disk and test verification; cross-vendor review | Personal accounts and paths; the mandatory Claude-native Sonnet parent; prose-only ledgers; hard-coded model defaults |
| Repository `overnight-orchestration` | Dependency-safe lanes; isolated worktrees; bounded concurrency; continuation in the same lane; independent diff review; integration verification; merge-hotspot awareness | Application-specific commands; queue-specific JSON; one hard-coded reviewer; project-specific commit and landing rules |
| Repository `overnight-issue-worker` | Explicit lifecycle phases; frozen briefs plus freshness checks; claim-before-dispatch discipline; phase-aware hold/release; authoritative external task evidence | GitHub-specific selection, claim comments, labels, and landing markers, which belong to the target project's adapter |

Run-history observations become dated regression scenarios. They do not become
unbounded global policy unless a deterministic test or supported runner profile
can express them.

## 6. Installation and ownership boundaries

There is one canonical Quirks repository.

| Location | Authority |
|---|---|
| Quirks repository | Skills, scripts, schemas, model-routing policy, runner protocol |
| User configuration | Installed runner profiles, account aliases, executable paths, quota preferences, credentials |
| Target repository | Native tasks, project adapter, project instructions, project tests, accepted changes |
| OS application-state directory | Campaign envelopes, events, session handles, bounded artifacts, operational lessons |
| Git remote | Accepted commits only when push was explicitly approved |

Codex installs Quirks through its plugin/marketplace mechanism. A Quirks
installer exposes the canonical `skills/` directories to Claude Code and Cursor
through their documented plugin or managed-link mechanisms rather than copies.
It validates an existing destination before creating or replacing any link.

Each device owns its runner configuration, credentials, processes, worktrees,
and campaign journal. Installing Quirks on another device permits new local
campaigns but does not transfer a live campaign or runner session. Any future
export/import format must be explicit and sanitized; it cannot export
credentials or claim that provider session handles are portable.

Runner credentials never enter the plugin repository, a target repository,
prompts, campaign JSON, task evidence, or reports.

## 7. Project adapter contract

### 7.1 Discovery

A campaign receives an adapter by either:

1. explicit `--adapter <path>`; or
2. a committed `.agents/quirks.json` file in the target repository.

There is no broad executable auto-discovery. An unattended campaign requires a
committed, schema-valid adapter configuration. Inspection-only sessions may help
author an adapter, but cannot mutate tasks or run unattended until it is reviewed
and committed.

The configuration names one executable as an argv array, never a shell string:

```json
{
  "schemaVersion": 1,
  "protocol": "quirks-task-adapter-v1",
  "command": ["node", "scripts/project-tasks.mjs"],
  "skills": {
    "write": "writing-tasks",
    "update": "updating-tasks",
    "execute": "executing-tasks"
  }
}
```

The values above illustrate the protocol shape; Quirks ships no assumption that
Node, those script paths, or those skill names exist in a target project.

### 7.2 Adapter operations

The executable receives one fixed operation and versioned JSON input. Version
one operations are:

- `capabilities`: supported operations, lifecycle, authority classes, protocol
  limits, and native completion boundaries;
- `validate`: repository-wide native task validation;
- `list`: filtered task summaries;
- `show`: one complete normalized task;
- `claim`: native task claim with stable campaign/task owner;
- `submit-review`: attach criterion-specific evidence and request review;
- `complete`: accept reviewed work with exact commit/artifact evidence;
- `block`: record reason and observable unblock condition;
- `release`: relinquish an unlanded claim safely;
- `propose`: create a non-running proposed task for a discovered outcome; and
- `verify`: project-defined campaign/task verification commands and results.

Mutating operations require an expected native revision or equivalent
compare-and-swap token. A stale update fails rather than overwriting another
agent's change.

Every request and response is size-bounded JSON. Unknown fields and unsupported
versions fail closed. Stdout is protocol-only; diagnostics use stderr. Secret
values are invalid in adapter responses.

The adapter declares one finite native completion boundary per task or project:
`accepted-commit`, `campaign-merge`, `target-merge`, or `remote-push`. Quirks may
submit evidence and request review earlier, but it cannot mark the native task
complete until that boundary has succeeded. A project therefore keeps its own
definition of “done” rather than inheriting Quirks' Git assumptions.

### 7.3 Adapter authority

The native project task system remains authoritative. Quirks' normalized task
and campaign files are snapshots and execution journals, not a second editable
task database.

At preflight Quirks records:

- adapter configuration hash;
- adapter executable Git blob/commit identity where available;
- adapter capability response hash;
- native task revision tokens; and
- project instruction hashes relevant to execution.

Any change before claim, delegated approval, landing, or push pauses the campaign
and requires re-preflight or new approval.

## 8. Normalized task model

Adapters translate their native representation into `normalized-task-v1`:

```json
{
  "schemaVersion": 1,
  "id": "PROJECT-123",
  "title": "Design the control protocol",
  "kind": "design",
  "priority": "P0",
  "status": "ready",
  "nativeRevision": "opaque-revision",
  "dependsOn": [],
  "workflow": {
    "family": "superpowers",
    "phase": "brainstorm",
    "designGate": {
      "required": true,
      "defaultApproval": "human",
      "delegable": true,
      "judgmentTier": "principal",
      "decisionEnvelope": [
        "Select a local IPC protocol without changing the remote trust boundary"
      ]
    }
  },
  "execution": {
    "effort": "principal",
    "risk": ["architecture", "security"],
    "capabilities": ["repository-write"],
    "parallelismKeys": ["control-protocol"],
    "humanGates": [],
    "completionBoundary": "target-merge"
  },
  "sourceRefs": [],
  "deliverables": [],
  "acceptanceCriteria": [],
  "verification": []
}
```

Allowed workflow phases are `brainstorm`, `plan`, `execute`, `review`, and
`verification`. Design, plan, implementation, and acceptance remain separate
native task outcomes even when one campaign is approved to run through all of
them.

Allowed effort tiers are `mechanical`, `standard`, `high`, and `principal`.
Priority and effort are independent: a P0 transcription task may remain
mechanical; a lower-priority trust-boundary review may require principal effort.

Risk and capability values are finite schema enums. They never contain commands,
paths, URLs, or model-provided free-form authority.

If an implementation task lacks its required approved design or plan dependency,
preflight marks the campaign invalid. Quirks may propose the missing task through
the adapter but cannot schedule it without a new exact campaign approval.

## 9. Superpowers workflow compatibility

| Task phase | Human mode | Delegated mode |
|---|---|---|
| Brainstorm | Installed Superpowers brainstorming with human checkpoints | Quirks delegated brainstorming with explicit envelope and independent review |
| Plan | Superpowers writing-plans after human-approved spec | Principal planning agent after delegated spec acceptance |
| Execute | Project execution skill and applicable Superpowers plan executor | Runner selected by effort/risk; project skill remains binding |
| Review | Human or requested independent review | Fresh cross-vendor review plus supervisor verification |
| Complete | Project lifecycle update | Adapter update after reproduced evidence |

Task metadata defines the safe default. Crucial design tasks normally use
`defaultApproval: human` while remaining `delegable: true` for an explicitly
approved campaign. A task with `delegable: false` cannot be changed by campaign
configuration; its native task or governing design must be updated first.

### 9.1 Delegated design authority

Preflight lists every design task and whether it will be human-guided,
human-after-draft, or delegated. Delegation is per task, never a blanket flag for
all future design work.

For each delegated task the approved envelope fixes:

- the problem and intended outcome;
- binding source documents and decisions;
- permitted decision dimensions;
- explicit non-decisions and prohibited boundary changes;
- required architect/reviewer tiers;
- deliverable path and acceptance criteria; and
- conditions that return control to the user.

The architect must be a fresh Fable or GPT-5.6 session. The author cannot review
its own specification. A separate reviewer attempts to refute the design,
checks the envelope and project authority order, and records findings and a
verdict. The Campaign Supervisor accepts the gate only when evidence is complete
and every material decision remains inside the envelope.

New trust boundaries, production mutation, destructive migration, public API,
source-of-truth, credential, or security-residual decisions always escape the
envelope unless named explicitly. They pause the lane.

Human-guided tasks may be drafted overnight, but dependent planning or
implementation remains blocked until the human approval is recorded by the
native adapter.

## 10. Roles and authority

```text
User approves immutable campaign envelope
              |
              v
Quirks control plane (deterministic state and enforcement)
              |
              v
Campaign Supervisor CLI session (Fable or GPT-5.6)
      | scheduling, claims, gates, integration, recovery
      +--> Architect / Planner (fresh judgment session)
      +--> Implementer (bounded task/worktree)
      +--> Independent Reviewer (fresh, preferably cross-vendor)
      +--> Final Reviewer (fresh principal session)
```

### 10.1 Campaign Supervisor

The invoking host session may inspect the repository, assemble preflight, and
present approval, but it is not the executable Campaign Supervisor. When an
approved campaign starts, the control plane dispatches a qualifying Fable or
GPT-5.6 supervisor through the same external CLI runner contract and records its
session handle. The host and supervisor may use the same provider, but they are
separate sessions with separate authority and lifecycle. This keeps supervision
portable and recoverable even when the invoking harness changes or exits.

The supervisor returns schema-valid decisions and reports; deterministic control
plane code validates and applies state transitions, budgets, locks, adapter
mutations, and Git target restrictions. Model judgment cannot bypass mechanical
invariants.

The supervisor:

- owns the campaign state machine and adapter mutations;
- never implements task scope;
- never authors and approves the same design;
- verifies actual Git/files and reproduces assigned evidence;
- resolves scheduling and model routing within the envelope;
- serializes integration and target landing;
- owns cross-task lesson classification; and
- pauses rather than guessing about authority or recovery ambiguity.

### 10.2 Workers

Implementers and dispatched parents cannot:

- mark tasks reviewed or done;
- broaden task scope or capabilities;
- merge or push;
- change campaign state or budgets;
- approve their own design, plan, tests, or diff; or
- treat their report as completion evidence.

They return bounded reports, session handles, costs, files, test output, risks,
and criterion mappings. The supervisor independently inspects the result.

### 10.3 Reviewers

Reviewers use fresh sessions. They receive the task, binding sources, approved
envelope, base and candidate revisions, and exact review scope. Findings remain
facts/inferences/questions with severity and file/line evidence. A reviewer does
not patch its own findings; fixes return to the implementer lane or a new worker.

## 11. Model and effort routing

Runner profiles map stable role/tier aliases to currently available CLI,
account, and model pools. Quirks records the exact provider, sanitized profile
ID, model, version/alias, reasoning effort, and fallback for every dispatch.
Model and account-pool availability are probed before approval.

Default tiers are:

| Tier | Models |
|---|---|
| Principal judgment | Fable; GPT-5.6 Sol high/xhigh |
| High judgment/execution | Grok 4.5 high; Opus 4.8; GPT-5.5 high; GPT-5.6 Terra high |
| Standard execution | Composer 2.5; Sonnet; GPT-5.6 Terra medium |
| Mechanical | Verified Codex Spark/Mini or another configured low-cost model |

Model aliases are configuration, not permanent truth. Changing an alias cannot
lower its declared capability tier without failing validation and requiring new
campaign approval.

Multiple profiles may use the same CLI executable with different local account
configuration. Each profile declares an opaque quota-pool ID; Quirks assumes two
profiles have independent limits only when configuration or a supported probe
says so. Provider name alone is not evidence of shared or separate quota.

Routing rules:

- Campaign supervision and final campaign judgment require Fable or GPT-5.6.
- Delegated architecture requires Fable or GPT-5.6 as author.
- Grok 4.5 high, Opus 4.8, GPT-5.5 high, and GPT-5.6 Terra high are equivalent
  high-tier candidates for complex implementation and adversarial task/design
  review; they are not Campaign Supervisors.
- Review is preferably cross-vendor and at least one tier above the implementer
  for judgment-heavy work.
- Security, identity, concurrency, protocol, production, destructive migration,
  and foundational architecture tasks receive high/principal independent review.
- Mechanical work uses the least expensive healthy compatible runner.
- Among compatible routes, dispatch prefers the healthy pool with the most
  remaining approved allocation, then the least campaign spend. This spreads
  work across independent Claude, Codex, and Cursor limits instead of draining
  one provider serially.
- Quota pressure may change provider or configured account but never silently
  lower the required tier, independence, sandbox, or task capability.
- Usage-limit failures are recorded with reset information and not blindly
  retried.

Preflight prefers cached, recently verified runner capability metadata. Any
probe that consumes paid tokens or changes remote state is shown separately and
requires consent before it runs; campaign preflight is not implicit authority to
spend quota.

If only one principal provider is available, two fresh sessions of that provider
may author/review an ordinary delegated design only when the campaign approval
allows the degraded independence. Security, production, destructive migration,
and foundational trust-boundary designs pause until cross-vendor review is
available or the user grants a new exact exception.

## 12. Campaign preflight and approval

Preflight is read-only except for creating plugin-owned local campaign state. It
must display and persist an immutable candidate envelope containing:

- repository identity, clean/dirty state, base commit, and relevant instruction
  hashes;
- adapter path, protocol, configuration/executable/capability hashes;
- exact task IDs, native revisions, dependency closure, and selection reason;
- human versus delegated design mode and decision envelope for every design task;
- worktree/integration branch, target branch, landing strategy, and base SHA;
- whether push is enabled, with exact remote and branch;
- authority class: repository-only, remote Git, external systems, or production;
- runner/model/effort/reviewer route and permitted fallbacks per task;
- token/cost/wall-clock budgets, concurrency, retries, and circuit breakers;
- project and campaign verification commands;
- parallelism keys and known merge/resource conflicts; and
- every human gate, unsupported capability, residual risk, and stop condition.

The envelope is canonicalized and hashed. Approval must reference the displayed
campaign identity/digest in the interactive session. This is durable approval
evidence, not a cryptographic signature.

After approval the supervisor cannot expand tasks, delegated decisions,
capabilities, external targets, models below tier, budgets, merge target, or push
target. Any expansion creates a new envelope and approval request.

## 13. Campaign lifecycle

The state machine is:

```text
draft -> preflight -> awaiting_approval -> running -> final_review
                                              |             |
                                              v             v
                                           paused        landing -> complete
                                              ^             |
                                              |             v
                                           blocked         hold

draft|preflight|awaiting_approval|running|paused|blocked -> cancelled
```

- `draft`: task selection intent exists but has not been validated.
- `preflight`: adapter, repository, runners, tasks, risks, and baseline are being
  inspected without project mutation.
- `awaiting_approval`: the immutable envelope and digest are ready.
- `running`: exact approved tasks may be claimed, dispatched, reviewed, and
  integrated.
- `paused`: a resumable budget, quota, liveness, target-freshness, or requested
  stop occurred.
- `blocked`: an observable external decision or prerequisite is required.
- `final_review`: all accepted task work is on the campaign branch; whole-branch
  verification and principal review are running.
- `landing`: target freshness, merge, post-merge verification, and optional push
  are serialized.
- `hold`: accepted or pushed work exists but safe automated continuation is
  ambiguous; operator ownership is required.
- `complete`: final report and all native task updates are reconciled.

Every state transition is append-only with timestamp, actor/session, from/to,
reason, and sanitized evidence.

## 14. Execution and integration flow

1. Acquire the repository campaign lock and revalidate the approved envelope.
2. Claim eligible tasks through adapter compare-and-swap.
3. Build dependency waves and conflict lanes from `dependsOn`,
   `parallelismKeys`, deliverables, and project capabilities.
4. Create one isolated task branch/worktree per concurrent task from the current
   campaign integration revision.
5. Assemble a bounded brief: ground rules, normalized task, binding source
   excerpts/paths, approved decisions, applicable verified lessons, exact output
   contract, and project skill requirements.
6. Dispatch the model selected by risk/effort and runner health.
7. Capture the session handle and artifacts before accepting any result.
8. Inspect the actual working tree/commit and run assigned verification.
9. Dispatch a fresh independent review when required.
10. Return findings to the existing implementer session for bounded fixes, or a
    new session when independence/context hygiene requires it.
11. Submit criterion-specific evidence through the adapter.
12. The supervisor accepts reviewed work and creates the exact task commit when
    sandbox restrictions prevent the worker from committing.
13. Merge accepted task work into the campaign branch serially and run affected
    integration verification.
14. Advance the native task only as far as its declared completion boundary
    permits, with exact commit/artifact evidence.
15. Recompute eligibility after every accepted task; never infer new tasks into
    the approved set.
16. Run final whole-campaign verification and a fresh principal review.
17. Revalidate target freshness, merge the exact reviewed set, and verify before
    any push.
18. Push only when the envelope names the exact remote and branch.
19. Complete tasks whose declared boundary has now succeeded, reconcile every
    native task state, and write the final campaign report.

Same-surface sequential tasks may resume a warm implementer session. Reviewers
and final reviewers remain fresh.

## 15. Git, merge, and push policy

Version one allows an approved campaign to merge and push.

- Work is assembled on a dedicated campaign integration branch.
- The exact base and target branch are recorded at approval.
- Workers never merge or push.
- Task landing onto the campaign branch is serialized.
- The target branch is re-read immediately before final landing.
- If the target advanced, a clean reconciliation may proceed only within the
  approved target. The updated target must be merged into the campaign branch,
  followed by full final verification and a fresh principal review again;
  conflicts pause the campaign.
- The final reviewed commit set is merged once into the target.
- No force-push, hard reset, broad checkout/revert, history rewrite, or inferred
  remote is allowed.
- Full post-merge verification completes before push.
- A pre-push failure records the exact landing commit and pauses for a safe exact
  revert or operator repair; it does not push.
- After a successful push, an unexpected failure becomes `hold`; Quirks does not
  surprise-revert shared remote history.
- Push requires a run-start prompt and explicit envelope fields for enabled,
  remote, source revision, and destination branch.

The adapter or project instructions may impose a stricter branch/PR policy. The
plugin cannot relax it.

## 16. Host-independent external runner dispatch

External dispatch lives inside Quirks, not in target repositories or a host
harness's native subagent implementation. Runner profiles are local user
configuration with fields such as:

- runner type and executable;
- account alias with no credential value;
- opaque quota-pool ID and approved campaign allocation;
- model/effort mappings;
- read-only/repository-write/network capability modes;
- invocation/output/session/resume/cancel contracts;
- expected wall-clock range;
- quota/status probe; and
- redaction rules.

The dispatcher supports external CLI runners through one job result shape:

```json
{
  "jobId": "opaque-id",
  "runner": "sanitized-profile-id",
  "runnerType": "claude",
  "resolvedModel": "provider-model",
  "effort": "high",
  "status": "success",
  "sessionHandle": "opaque-handle",
  "artifactPaths": [],
  "usage": {},
  "failure": null
}
```

The dispatcher never parses a prose “done” as success. Runner-specific success
signals and on-disk verification are both required.

### 16.1 Host harness and control-plane boundary

Claude Code, Codex, and Cursor all invoke the same Quirks control plane. The
required version-one matrix is:

| Host harness | Claude CLI worker | Codex CLI worker | Cursor CLI worker |
|---|---:|---:|---:|
| Claude Code | required | required | required |
| Codex | required | required | required |
| Cursor | required | required | required |

The host integration may translate a natural-language request into
`quirks-campaign` arguments and render status, but it does not own worker
processes or campaign truth. The control plane exposes equivalent foreground and
durable operations for `run`, `start`, `status`, `attach`, `resume`, and scoped
`cancel`. An unattended `start` returns a campaign ID only after the watchdog,
journal, and cancel metadata are durable. Re-entry from any supported harness on
the same device uses that ID rather than conversational memory.

The required runner entry points are:

| Runner | Non-interactive entry point | Result/session contract |
|---|---|---|
| Claude | `claude -p` | structured result events; explicit session UUID; `--resume` |
| Codex | `codex exec` | transcript plus final-message artifact; exec session ID; `exec resume` |
| Cursor | `agent -p` | structured result events; chat/thread ID; `--resume` |

Quirks constructs argument arrays directly and never interpolates a task brief
into a shell command. Exact flags are resolved from the installed CLI version
and the approved runner profile, then captured in redacted evidence. A host's
native Agent/subagent API may be supported later, but cannot replace any cell in
the required matrix.

### 16.2 Claude CLI contract

The portable Claude runner replaces the personal secondary-account alias
convention from the prototype dispatcher:

- Quirks generates a valid UUID before launch and passes `--session-id`, so a
  resumable handle exists even if final output never flushes.
- Non-interactive output is structured. Success requires process success, a
  terminal non-error result, no permission denials, schema-valid final output,
  and independent on-disk verification.
- Model, effort, allowed/disallowed tools, setting sources, permission mode,
  MCP policy, workspace directories, and dollar cap are explicit profile or
  campaign-envelope values. Undeclared model fallback is disabled.
- `CLAUDE_CONFIG_DIR`, when needed for a separate account, is an optional local
  runner-profile value. Quirks never hard-codes a personal directory or copies
  its authentication material.
- `--dangerously-skip-permissions` and equivalent bypass modes are forbidden by
  default. They require an explicit capability class in the approved envelope
  and a separately isolated execution boundary; runner availability is never a
  reason to broaden permissions.
- Resume uses the same profile, model/tier, workspace, settings, and permissions
  unless a newly approved envelope authorizes a change.
- Claude's native `--bg` and `claude agents --json` interfaces are optional
  accelerators only after versioned smoke tests prove start-handle, status,
  output, resume, and scoped-cancel behavior. The Quirks watchdog remains the
  portable fallback and source of lifecycle truth.

Equivalent versioned reference files define Codex and Cursor arguments, result
locations, session recovery, permission behavior, known sandbox/worktree
constraints, and usage-limit signatures. The prototype facts that Codex stdout
is a transcript rather than its final result, and that Cursor completion/test
claims require reproduction, remain binding test scenarios rather than informal
tribal knowledge.

### 16.3 Parent/child liveness

Every dispatch is a job with a recorded session handle. A foreground control-
plane operation remains attached until the job reaches a terminal state or is
scoped-cancelled/resumed according to the runner contract. A host integration
must not launch an unjournaled child itself and then yield while relying on a
completion signal its harness may not deliver.

Long-lived detached execution is permitted only through the Quirks watchdog,
which records PID/session, heartbeat, log/artifact paths, timeout, and scoped
cancel operation before detaching. The control plane reconstructs the supervisor
and worker sessions from the journal rather than process memory.

On silence or timeout the control plane checks, in order:

1. bounded output growth and timestamps;
2. process/session liveness;
3. worktree commits and modifications;
4. runner-native transcript/session recovery; and
5. one permitted resume/retry based on failure classification.

No blind PID polling, broad kill, or invented session identifier is allowed.

## 17. Durable state and recovery

Campaign state is stored in the platform-appropriate user application-state
directory, keyed by canonical repository identity and campaign ID:

```text
campaigns/<campaign-id>/
  campaign.json
  events.jsonl
  state.json
  sessions.json
  tasks/<task-id>.json
  artifacts/<job-id>/
  lessons.jsonl
  final-report.md
```

- `campaign.json` is the immutable approved envelope.
- `events.jsonl` is the append-only recovery/audit sequence.
- `state.json` is a derived atomic snapshot and can be rebuilt from events.
- `sessions.json` stores opaque handles and liveness metadata, not credentials.
- task files store normalized snapshots and native revision tokens.
- artifacts are bounded, redacted, and excluded from secret/raw-log capture.
- the final report is sanitized and may optionally be copied to a project path
  only when its adapter declares that deliverable.

Version one permits one active write campaign per repository. An atomic lock and
heartbeat identify its owner. Stale-lock recovery checks live processes,
sessions, Git state, and event history before taking ownership.

On resume a qualifying supervisor revalidates:

- campaign/envelope hashes;
- adapter and project instruction hashes;
- native task revisions and ownership;
- campaign/target branches and commits;
- worktrees and running processes;
- runner sessions and output artifacts;
- budgets and outage entries; and
- last verified integration state.

Any irreconcilable disagreement pauses or holds the campaign. Recovery never
rewrites event history to make the current state look clean.

## 18. Learning across tasks

The supervisor records typed, sanitized observations:

| Learning type | Campaign behavior | Durable promotion |
|---|---|---|
| Runner/runtime quirk | Adjust compatible later dispatches | Proposed Quirks task/reference update |
| Project convention | Add verified rule to relevant later briefs | Proposed project instruction/skill task |
| Repeated implementation failure | Change lane/model or trip breaker | Final report and possible task |
| Architecture discovery | Stop affected dependents | Proposed design/ADR task |
| Acceptance/test weakness | Reject or constrain result | Proposed verification task |
| Minor cleanup | Add to final minors ledger | Optional project task |

Only evidence-backed and task-relevant lessons enter later briefs. Full
transcripts, untrusted agent speculation, and hostile logs do not become
instructions.

Quirks does not edit its own skills during a campaign. A plugin learning becomes
a separate task and must follow skill TDD. A project learning is promoted through
the adapter and cannot enter the active campaign without new approval.

## 19. Budgets and circuit breakers

Every campaign has explicit maximum task count, concurrency, wall-clock, token,
cost where available, retries, and optional per-runner quota allocations.

Defaults:

- one resume/retry for a classified transient runner failure;
- no retry for a known usage-limit failure before its reset/probe condition;
- pause one lane after two consecutive task failures;
- pause the campaign after an integration or post-merge verification failure;
- stop before exceeding an approved token/cost/wall-clock ceiling;
- pause on adapter/instruction/task revision drift;
- pause on target conflicts or unexpected protected-branch policy;
- block on missing human approval or escaped delegated-design decision; and
- hold after ambiguous accepted/pushed state.

The supervisor may reduce concurrency or choose a same-tier healthy runner. It
cannot increase budget, retries, authority, or task scope without a new envelope.

## 20. Security boundaries

- Adapter commands are argv arrays; Quirks never executes adapter shell strings.
- A committed adapter is executable project code. Preflight displays its path,
  hash, capabilities, and requested permissions before approval.
- Project content, task prose, logs, tests, metadata, agent reports, and external
  output are potentially hostile data, not supervisor instructions.
- Briefs separate binding instructions from quoted observations.
- Output, frames, files, and durations are bounded.
- Secret-shaped values are redacted and rejected from protocol/evidence fields.
- No credentials or secret payloads are persisted in campaign state.
- Sandboxes grant only the approved capability class.
- Repository-write does not imply network, push, external-system, or production
  authority.
- Delegated design authority does not imply mutation authority.
- Production/destructive work requires an exact task, target, runbook, model
  tier, verification, and campaign-start approval.
- No worker receives broad cleanup, force-push, hard-reset, or arbitrary external
  provider authority.
- The supervisor verifies current project instructions and authority order before
  every mutation boundary.

## 21. Failure behavior

Failures are classified rather than retried generically:

- **Task rejection**: keep/reopen native task as project lifecycle requires;
  preserve worktree and findings for bounded continuation.
- **Honest partial**: resume the same implementation session with exact completed
  and remaining scope; never report success.
- **Transient runner failure**: resume/retry once within budget.
- **Usage limit**: record reset/probe evidence and route to same-tier healthy
  provider or pause.
- **Permission denial**: treat as failure even when a CLI exits zero; do not
  broaden sandbox automatically.
- **Malformed/fabricated evidence**: supervisor reproduces commands; reject the
  result and record a runner-quality strike.
- **Wedge after work**: verify worktree; scoped-cancel runner; recover report from
  transcript if possible; continue only from on-disk evidence.
- **Baseline/project failure**: no claims or task execution; report existing
  failure.
- **Integration failure**: stop new dispatches, preserve exact accepted commits,
  and pause for diagnosis.
- **Pre-push landing failure**: do not push; record landing revision and pause.
- **Post-push ambiguity**: hold for operator; never silently unassign or revert.
- **Crash/restart**: reconstruct from events, Git, adapter, sessions, and locks;
  never trust memory.

## 22. Run-start user experience

The campaign approval view is concise but complete:

1. **What will run**: exact tasks, dependencies, design/plan/execute phases.
2. **Delegated judgment**: human/delegated design tasks, envelopes, architect and
   reviewer models.
3. **Where work lands**: base, campaign branch, target branch, merge strategy.
4. **Push**: enabled/disabled; exact remote and branch when enabled.
5. **Authority**: repository, network, external-system, production capabilities.
6. **Models and spend**: resolved routing, fallbacks, budget, concurrency.
7. **Verification**: baseline, per-task, integration, and final gates.
8. **Stops and residuals**: human gates, circuit breakers, known unavailable
   runners, degraded independence.
9. **Approval digest**: stable campaign ID and envelope hash.

The user may change any choice before approval. After approval, any material
change returns to this view with a new digest.

## 23. Testing strategy

### 23.1 Skill TDD

Every Quirks skill follows test-driven skill authoring:

1. create pressure scenarios and run fresh agents without the skill;
2. record exact failures and rationalizations;
3. write the smallest skill that addresses observed failures;
4. re-run equivalent scenarios with the skill;
5. close discovered loopholes and re-test; and
6. retain sanitized baseline/forward-test evidence in the repository.

Pressure scenarios cover:

- skipping campaign approval under time pressure;
- treating backlog/ineligible work as ready;
- taking over another campaign/task owner;
- a weak model approving delegated architecture;
- an architect reviewing its own specification;
- implementing without approved design/plan dependencies;
- trusting an executor's “tests pass” claim;
- changing an adapter or task after approval;
- pushing when push was not enabled;
- broadening network/production authority;
- quota exhaustion and tempting lower-tier fallback;
- hostile task/log instructions;
- partial work and sunk-cost pressure;
- target movement, conflicts, and post-push failure; and
- recovery with contradictory Git, task, and campaign state.

### 23.2 Deterministic tests

Dependency-free tests cover:

- every JSON schema and unknown-field rejection;
- campaign state transitions and append-only events;
- canonical envelope hashes;
- adapter framing, revisions, stale updates, and output bounds;
- task dependency cycles, exact-set selection, and phase gates;
- lane scheduling, parallelism keys, and task-count/concurrency budgets;
- model tier resolution and forbidden downgrades;
- lock acquisition, heartbeat, stale recovery, and simultaneous campaigns;
- secret/redaction detectors;
- merge/target freshness/push authorization;
- circuit breakers and failure classification; and
- reconstruction of state snapshots from events.

### 23.3 Fake runner integration

Fake Claude, Codex, and Cursor runners simulate:

- success with valid artifacts;
- success prose with no disk change;
- permission denial with exit zero;
- partial completion;
- malformed and oversized output;
- transient failures and usage limits;
- process silence and timeout;
- work completed before runner wedge;
- resumable and non-resumable failures;
- fabricated test evidence;
- session cancellation and orphan cleanup; and
- quota/model fallback decisions.

Fake host launchers additionally simulate foreground completion, host
conversation loss after durable start, later attach by campaign ID, and scoped
cancel. Host loss must not lose accepted work or turn conversational memory into
the recovery authority.

CI uses fake runners and never consumes paid model quota.

### 23.4 Portable repository fixtures

At least two unrelated fixture repositories use different native task formats
and adapters. End-to-end tests prove:

- Quirks contains no native-task assumptions;
- both adapters normalize into the same campaign flow;
- human and delegated designs gate dependents correctly;
- independent tasks parallelize and conflicts serialize;
- accepted commits integrate and rejected work does not;
- crash/restart loses no accepted work and double-dispatches nothing;
- local merge works; unapproved push fails; approved push targets only the exact
  fixture remote/branch; and
- final native task evidence remains authoritative.

### 23.5 Real runner smoke tests

Real smoke acceptance has two layers.

The runner contract suite runs once per installed Claude, Codex, and Cursor CLI
profile. It checks current flags, authentication readiness, model availability,
permission/sandbox behavior, result envelopes, session capture and resume,
timeout/cancel behavior, edit/revert behavior, fabricated-evidence rejection,
and quota-limit classification in a disposable scratch repository. Destructive
permission bypass, remote push, and production access are never part of a smoke
test.

The host/runner suite exercises all nine cells in the matrix from section 16.1.
Each cell starts through the actual Claude Code, Codex, or Cursor host
integration and dispatches a bounded deterministic task to one CLI runner in an
isolated fixture worktree. It proves plugin discovery, identical envelope
creation, durable process ownership, status/attach, structured completion,
on-disk verification, and cleanup. A cell driven from another host or directly
from a shell does not count as evidence for the missing host row.

Smoke records include date, OS, host version, runner CLI version, resolved model
and effort, redacted profile ID, outcome, session availability, deviations, and
artifact digest. Evidence is dated because host and external CLI behavior change
independently of Quirks.

### 23.6 Portability and package validation

Release gates include:

- Codex plugin manifest validation;
- Agent Skill frontmatter/structure validation;
- link/install/uninstall tests that never overwrite user files silently;
- scans for shipped project names, personal paths, account identifiers,
  credentials, and hard-coded task commands;
- clean installation in a fresh user-data sandbox; and
- documentation examples validated against current schemas.

## 24. Acceptance criteria for version one

Version one is acceptable when:

1. The same installed plugin completes deterministic fake-runner campaigns in
   two repositories with different task adapters.
2. Claude Code, Codex, and Cursor each invoke the same control plane and pass all
   three Claude/Codex/Cursor runner cells in the dated real smoke matrix.
3. Campaign preflight resolves an exact task set, flags every design gate,
   presents model/authority/merge/push choices, and prevents execution before
   digest-specific approval.
4. Human brainstorming preserves human approval; delegated brainstorming uses a
   Fable/GPT-5.6 architect, independent qualified review, and stops on envelope
   escape.
5. Model routing includes Fable/GPT-5.6 principal supervision and the approved
   high tier of Grok 4.5 high, Opus 4.8, GPT-5.5 high, and GPT-5.6 Terra high.
6. Compatible independent tasks demonstrably spread across approved healthy
   Claude, Codex, and Cursor account/model pools while tier, review independence,
   capability, and budget constraints remain satisfied.
7. The Claude runner has no shipped personal config path, captures a session UUID
   before work, rejects permission-denied zero exits, resumes under the same
   envelope, and does not enable implicit permission or model fallback.
8. Workers cannot complete, merge, push, or approve their own work.
9. Supervisor verification rejects fabricated completion/test evidence.
10. Dependency waves, conflict lanes, budgets, and circuit breakers behave
   deterministically.
11. Crash recovery reconstructs the campaign without lost accepted work,
   duplicated task dispatch, or rewritten history.
12. Merge reaches only the approved target and push reaches only the explicitly
   approved remote/branch after final verification.
13. Credentials, secrets, project-specific names, personal paths, and account
    identifiers are absent from shipped plugin artifacts and campaign evidence.
14. Skill baseline/forward tests, schema tests, fake-runner integration, package
    validation, and portability fixtures all pass.
15. The final report distinguishes completed, rejected, blocked, held, skipped,
    and newly proposed work, with exact commits and reproducible evidence.

## 25. Delivery sequence

Implementation begins only after this written specification is reviewed and
approved. The required delivery order is:

1. write and approve the implementation plan;
2. scaffold and validate the plugin package;
3. implement schemas, canonical campaign state, deterministic validator, and
   the host-independent control-plane lifecycle;
4. implement the project adapter protocol and two fixtures;
5. baseline-test and author `dispatching-external-agents`, including versioned
   Claude, Codex, and Cursor runner references;
6. baseline-test and author `delegated-brainstorming`;
7. baseline-test and author `running-agent-campaigns`;
8. implement fake runners/hosts, watchdog, resume, budgets, quota-pool routing,
   and circuit breakers;
9. implement Git integration, merge, and approved push;
10. implement and validate Claude Code, Codex, and Cursor installation/control
    integrations without copying the canonical skills;
11. run portable fixture end-to-end acceptance and the dated nine-cell real
    host/runner smoke matrix;
12. install through the personal plugin marketplace and expose canonical skills
    to supported harnesses; and
13. run one bounded real project campaign only after the disposable acceptance
    suite passes.
