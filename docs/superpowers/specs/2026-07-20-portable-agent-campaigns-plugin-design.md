# Quirks — Portable Agent Campaigns Plugin Design

Date: 2026-07-20

Last revised: 2026-07-21

Status: APPROVED WRITTEN SPEC — implementation planning in progress

Repository: `brunomazzardo/quirks`

## 1. Decision

Quirks is a standalone, project-agnostic agent plugin for safely running one or
many repository tasks through external agent CLIs. It
supports interactive work, unattended overnight campaigns, task dependency
scheduling, model/effort routing, delegated design, independent review, durable
recovery, integration, merge, and an optionally approved push.

The plugin is the only maintained copy of its orchestration skills. Target
projects select a versioned task-source adapter, define their workflow policy,
and provide their own execution instructions; they do not copy Quirks skills
into each repository. Version one ships a built-in JSON task source and a
versioned external-executable escape hatch. GitHub Issues, Linear, Jira,
ClickUp, and other provider adapters can be added later without changing the
campaign core or normalized task model.

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
- keep task storage behind one capability-aware `TaskSource` contract, starting
  with local JSON while preserving a path to provider and custom adapters;
- treat the selected task source as canonical while Quirks normally performs
  lifecycle writes and synchronizes them durably;
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
- expose a secure local approval, task, campaign, and history interface without
  turning rendered HTML into another state store;
- record compact, validated task provenance without copying specifications,
  plans, logs, diffs, or provider records; and
- remain free of project names, project paths, personal account names,
  credentials, and repository-specific commands.

## 3. Non-goals

Version one is not:

- a hosted orchestration service;
- a replacement for GitHub Issues, project JSON ledgers, Jira, or other task
  authorities;
- a universal task database;
- a promise to ship GitHub, Linear, Jira, or ClickUp adapters in version one;
- a continuously running issue-sync daemon;
- cross-machine task leasing or prevention of duplicate work in another clone;
- a persistent hosted dashboard or a store of rendered approval HTML;
- an authorization bypass for production or external-system mutation;
- an autonomous requirements generator that can expand its own campaign scope;
- a generic remote shell or arbitrary command broker;
- a credential store;
- a mechanism for workers to approve or merge their own work;
- a promise that every agent CLI has identical capabilities;
- transparent migration or live resumption of a campaign on another device;
- dependence on a host's native subagent facility for campaign correctness;
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
- **Task source**: the canonical task authority selected by a project, such as a
  JSON file, GitHub Issues, Linear, Jira, ClickUp, or a custom system.
- **Task-source adapter**: a built-in, provider, or external-executable
  implementation of Quirks' versioned semantic task protocol.
- **Project workflow policy**: repository-owned configuration that maps native
  task states and project completion rules into Quirks without implementing
  storage transport.
- **Normalized task**: the provider-neutral read model returned by a task-source
  adapter for scheduling and routing. It never replaces the native task record.
- **Sync outbox**: durable local intents awaiting acknowledgement from the
  canonical task source.
- **Provenance index**: compact references from a task to campaigns, files at
  commits, accepted commits, pull requests, verification, and attributed actors.
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
    quirks-tasks
    quirks-external-adapter
    quirks-runner-preflight
    quirks-watchdog

  task-sources/
    json/
    external/

  schemas/
    project-config-v1.schema.json
    task-source-capabilities-v1.schema.json
    task-source-request-v1.schema.json
    task-source-response-v1.schema.json
    json-task-file-v1.schema.json
    normalized-task-v1.schema.json
    task-provenance-v1.schema.json
    task-sync-intent-v1.schema.json
    campaign-v1.schema.json
    campaign-event-v1.schema.json
    campaign-state-v1.schema.json
    campaign-approval-v1.schema.json
    host-profile-v1.schema.json
    runner-profile-v1.schema.json

  references/
    parent-protocol.md
    model-routing.md
    security-boundaries.md
    installing.md
    authoring-task-source-adapters.md
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
- task-source synchronization and task claims;
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
locks, budgets, task-source framing, sync outboxes, provenance validation,
approval binding, bounded output, and deterministic reports.

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
| Repository `overnight-issue-worker` | Explicit lifecycle phases; frozen briefs plus freshness checks; claim-before-dispatch discipline; phase-aware hold/release; authoritative external task evidence | GitHub-specific selection, claim comments, labels, and landing markers, which belong to a GitHub task-source adapter and project workflow policy |

Run-history observations become dated regression scenarios. They do not become
unbounded global policy unless a deterministic test or supported runner profile
can express them.

## 6. Installation and ownership boundaries

There is one canonical Quirks repository.

| Location | Authority |
|---|---|
| Quirks repository | Skills, scripts, schemas, model-routing policy, runner protocol, built-in task-source adapters |
| User configuration | Installed runner profiles, account aliases, executable paths, quota preferences, credentials |
| Target repository | Task-source selection, JSON tasks when selected, project workflow policy, instructions, tests, accepted changes |
| External task provider | Canonical task status and provider-native task record when selected |
| OS application-state directory | Campaign envelopes, events, sync outbox, session handles, bounded artifacts, operational lessons |
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

## 7. Task-source and project-policy contract

### 7.1 Discovery and drivers

A campaign receives task-source configuration by either:

1. explicit `--config <path>`; or
2. a committed `.agents/quirks.json` file in the target repository.

There is no broad executable or provider auto-discovery. An unattended campaign
requires committed, schema-valid configuration. Inspection-only sessions may
help author it, but cannot mutate tasks or run unattended until it is reviewed
and committed.

The built-in JSON configuration is intentionally ordinary:

```json
{
  "schemaVersion": 1,
  "protocol": "quirks-project-v1",
  "taskSource": {
    "driver": "json",
    "path": ".quirks/tasks.json"
  },
  "workflowPolicy": {
    "skills": {
      "write": "writing-tasks",
      "update": "updating-tasks",
      "execute": "executing-tasks"
    }
  }
}
```

The JSON file is the canonical task authority when this driver is selected. Its
adapter uses the same protocol as every future provider and custom source; the
campaign core never opens or edits the file directly.

The canonical file is a small versioned envelope:

```json
{
  "schemaVersion": 1,
  "tasks": [
    {
      "id": "QK-101",
      "title": "Define the task-source contract",
      "kind": "design",
      "priority": "P0",
      "status": "ready",
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
            "Define the provider-neutral contract without selecting providers"
          ]
        }
      },
      "execution": {
        "effort": "principal",
        "risk": ["architecture"],
        "capabilities": ["repository-write"],
        "parallelismKeys": ["task-source-contract"],
        "humanGates": [],
        "completionBoundary": "target-merge"
      },
      "sourceRefs": [],
      "deliverables": [],
      "acceptanceCriteria": [],
      "verification": [],
      "provenance": { "schemaVersion": 1, "iterations": [] }
    }
  ]
}
```

Task IDs are unique and stable within the source. The JSON driver derives the
normalized `source` block and `nativeRevision` from canonical task content; those
derived fields are not stored or hand-edited in the file. Exact workflow and
execution subfields are validated by their referenced schemas.

Future built-in/provider drivers such as `github`, `linear`, `jira`, or
`clickup` carry only non-secret provider locators in project configuration.
Credential aliases and authenticated account selection remain in user
configuration. Each provider driver is a separately versioned package that must
pass the shared task-source contract suite before it can be selected.

Custom formats use the `external` driver with a committed argv array, never a
shell string. The external executable is the successor to the original project
adapter seam; it preserves arbitrary project integration without making every
repository reimplement a standard provider.

Project workflow policy is separate from transport. It defines native status
mapping, required skills, design gates, evidence mapping, and one finite
completion boundary: `accepted-commit`, `campaign-merge`, `target-merge`, or
`remote-push`. A source driver cannot silently weaken this policy.

### 7.2 Semantic `TaskSource` operations

All drivers implement the same provider-neutral operations:

- `capabilities`: supported operations, concurrency strength, lifecycle fields,
  comment/reference and provenance-write modes, authority classes, limits, and
  completion boundaries;
- `validate`: source-wide task and policy validation;
- `list`: filtered normalized task summaries;
- `show`: one complete normalized task;
- `claim`: claim with stable campaign/task owner when supported;
- `submit-review`: attach criterion-specific evidence and request review;
- `attach-provenance`: append a validated compact provenance update;
- `complete`: accept reviewed work with exact commit/artifact evidence;
- `block`: record reason and observable unblock condition;
- `release`: relinquish an unlanded claim safely;
- `propose`: create a non-running proposed task for a discovered outcome; and
- `verify`: project-defined campaign/task verification commands and results.

Core scheduling calls semantic operations rather than provider CRUD APIs. A
driver maps those operations to JSON fields, issue fields, labels, comments, or
provider-native transitions according to its declared capabilities and the
project workflow policy. Unsupported capabilities remain visible and fail
closed; the UI does not pretend every provider has identical features.

Every mutating request carries an expected native revision and an idempotency
key derived from campaign, task, operation, and event identity. A driver declares
its enforceable concurrency strength as `atomic`, `optimistic`, `local-only`, or
`none`. It cannot claim compare-and-swap protection that its storage or provider
cannot enforce. Stale or conflicting updates fail instead of overwriting newer
native state.

The JSON driver uses canonical content revisions, a repository-local lock, and
atomic file replacement. This protects concurrent writers in the same clone but
does not prevent a different machine or clone from attempting the same task.
That cross-machine limitation is explicit in version-one approval and history
views. A future provider may offer stronger coordination through its adapter.

Every request and response is size-bounded schema-valid JSON. Unknown fields and
unsupported versions fail closed. External-adapter stdout is protocol-only;
diagnostics use stderr. Secret values are invalid in task-source responses.

### 7.3 Authority and synchronization

The selected task source owns canonical task status. Quirks is normally the
writer during a campaign, but normalized task files and UI read models are only
local snapshots. The campaign journal remains authoritative for execution
events, approvals, runner activity, verification, and recovery—not for native
task status.

Quirks performs an inbound refresh before preflight, claim, resume, review,
completion, landing, and final reporting. Before each outbound task mutation it
durably appends a sync intent to the local outbox, invokes the adapter with the
expected native revision and idempotency key, and records acknowledgement plus
the new native revision. A task cannot be reported complete while its canonical
completion update remains unacknowledged.

`quirks tasks sync` exposes the same reconciliation explicitly. Version one has
no always-running daemon; automatic synchronization happens at command and
campaign lifecycle boundaries.

If another actor changes the canonical task, the source wins. Quirks records the
conflict and pauses the affected lane rather than overwriting, merging semantic
status automatically, or substituting its local snapshot. Append-only provider
metadata may be retried only when the adapter proves the operation idempotent and
non-conflicting. Provider unavailability leaves an honest `pending_sync` outbox
entry and blocks any transition whose correctness depends on acknowledgement.

At preflight Quirks records:

- task-source driver, protocol, configuration, implementation, and capability
  hashes;
- project workflow-policy and relevant instruction hashes;
- native task revision tokens and current sync state; and
- credential alias and authenticated provider identity in sanitized form, never
  the credential itself.

Any source, policy, capability, or task revision change before claim, delegated
approval, landing, or push pauses the campaign and requires re-preflight or new
approval.

## 8. Normalized task model

Task-source adapters translate their native representation into
`normalized-task-v1`:

```json
{
  "schemaVersion": 1,
  "id": "PROJECT-123",
  "title": "Design the control protocol",
  "kind": "design",
  "priority": "P0",
  "status": "ready",
  "source": {
    "driver": "json",
    "nativeId": "PROJECT-123",
    "webUrl": null
  },
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
  "verification": [],
  "provenance": {
    "schemaVersion": 1,
    "iterations": []
  }
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
the task-source adapter but cannot schedule it without a new exact campaign
approval.

### 8.1 Compact task provenance

The built-in JSON task source stores a compact provenance index, not duplicated
artifacts. Provider adapters declare `structured`, `append-only`, or `none`
provenance support and synchronize the same compact facts where supported. The
campaign journal always retains the validated iteration/reference events needed
for local history, but it never becomes canonical task status. Each append-only
task iteration may reference:

- campaign ID, task revision, approved envelope digest, outcome, completion
  boundary, base/accepted/landed commits, and superseding iteration;
- governing specification, plan, review, or other artifact by kind,
  repository-relative path, exact Git commit at which it was used, and optional
  canonical URL;
- accepted or partial commits by full SHA; commit count is derived rather than
  stored separately;
- pull request by provider, repository locator, number, URL, state, opener,
  merger, and merge commit;
- verification, CI, build, release, or deployment evidence by stable reference
  and concise outcome;
- participants by role, runner, model, effort, and session reference;
- human operator, Git author, Git committer, PR opener, and PR merger as distinct
  identities with the evidence that supports each attribution;
- start, finish, duration, reported usage/cost, deviations, retries, fallbacks,
  permission denials, timeouts, resumptions, and follow-up task references; and
- a short outcome reason suitable for a history list.

Full specifications, plans, reviews, patches, logs, prompts, model reasoning,
transcripts, test output, provider payloads, and secret-bearing output do not
enter the task record. They remain in Git, project files, provider systems, or
the bounded campaign journal. A campaign reference is a pointer to that journal,
not a copy of it.

Workers return candidate references only. The deterministic control plane
validates referenced Git objects, repository-relative paths at the stated
commit, accepted commit boundaries, provider URLs/identities when available,
and schema limits before asking the task-source adapter to append provenance.
Invalid or unverifiable candidates are rejected or labeled unavailable; a worker
cannot write authoritative provenance directly.

Git author and committer names/emails are self-asserted metadata. Quirks labels
an identity verified only when a valid signature or authenticated provider
identity proves it. The history UI keeps operator, producer agent/model, Git
author, Git committer, PR opener, and PR merger separate rather than implying
that any one field proves the others.

The operator identity comes from a configured Quirks user profile or an
authenticated host/provider identity with an explicit evidence kind. An OS
username or free-form display name alone is self-asserted and never marked
verified.

Historical file links offer `Open as executed`, `Open current`, and `Compare`
when the referenced Git object exists. If the historical object, provider, or
URL is unavailable, the UI says so and never silently substitutes the current
file or a newer provider record.

## 9. Superpowers workflow compatibility

| Task phase | Human mode | Delegated mode |
|---|---|---|
| Brainstorm | Installed Superpowers brainstorming with human checkpoints | Quirks delegated brainstorming with explicit envelope and independent review |
| Plan | Superpowers writing-plans after human-approved spec | Principal planning agent after delegated spec acceptance |
| Execute | Project execution skill and applicable Superpowers plan executor | Runner selected by effort/risk; project skill remains binding |
| Review | Human or requested independent review | Fresh cross-vendor review plus supervisor verification |
| Complete | Project lifecycle update | Task-source update after reproduced evidence |

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
canonical task source.

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
plane code validates and applies state transitions, budgets, locks, task-source
mutations, sync acknowledgement, and Git target restrictions. Model judgment
cannot bypass mechanical invariants.

The supervisor:

- owns the campaign state machine and task-source mutations;
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
- task-source driver, protocol, configuration/implementation/capability hashes,
  workflow-policy hash, authenticated identity summary, and sync health;
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

At run start Quirks asks whether the proposal may route work across other
external agent providers/profiles. If disabled, the proposal is constrained to
a child runner session using the current harness's configured CLI/profile; the
interactive host still does not become the durable supervisor or bypass the
control plane. If enabled, preflight may spread compatible work across approved
Claude, Codex, Cursor, and later runner profiles.

Quirks renders the candidate envelope as an ephemeral loopback approval
workspace. The HTML is a projection, not an artifact or state store. It shows:

- campaign summary: exact scope, waves, estimated time, confidence, budget, and
  landing/push boundary;
- dependency and execution map with ordered waves and conflict lanes;
- agent lanes identifying runner, model, effort, task order, and health;
- complete task list with readiness, blockers, design gates, risk, effort, and
  proposed route;
- selected-task inspector with routing rationale, tests, fallback, confidence,
  and acceptance proof; and
- a fixed approval area binding the exact campaign ID and digest.

The approval action consumes a short-lived one-time token and records an
operator-attributed approval event containing the exact digest. Nothing may
claim, dispatch, or mutate a task before that event is durable. Changing task
scope, route, model, fallback, budget, authority, verification, landing, or push
regenerates the envelope and requires approval of the new digest. A runtime
fallback may proceed without another approval only when that exact route and
conditions were already present in the approved envelope; otherwise Quirks
pauses for a new proposal.

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
- `preflight`: task source, workflow policy, repository, runners, tasks, risks,
  and baseline are being inspected without project mutation.
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
- `complete`: final report and all canonical task updates and required
  provenance writes are acknowledged; no required sync intent remains pending.

Every state transition is append-only with timestamp, actor/session, from/to,
reason, and sanitized evidence.

## 14. Execution and integration flow

1. Acquire the repository campaign lock, refresh the canonical task source, and
   revalidate the approved envelope against native revisions and sync health.
2. Claim eligible tasks through task-source compare-and-swap, with the mutation
   intent durably recorded before the adapter call.
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
11. Submit criterion-specific evidence through the task-source adapter.
12. The supervisor accepts reviewed work and creates the exact task commit when
    sandbox restrictions prevent the worker from committing.
13. Merge accepted task work into the campaign branch serially and run affected
    integration verification.
14. Validate and journal compact provenance, synchronize it to the task source
    when supported, then advance the native task only as far as its declared
    completion boundary permits, with exact commit/artifact evidence and
    acknowledged required sync revisions.
15. Recompute eligibility after every accepted task; never infer new tasks into
    the approved set.
16. Run final whole-campaign verification and a fresh principal review.
17. Revalidate target freshness, merge the exact reviewed set, and verify before
    any push.
18. Push only when the envelope names the exact remote and branch.
19. Complete tasks whose declared boundary has now succeeded, reconcile every
    canonical task state and outbox entry, and write the final campaign report.

Same-surface sequential tasks may resume a warm implementer session. Reviewers
and final reviewers remain fresh.

Every task-source write follows the durable intent → adapter mutation →
acknowledgement sequence. A transport timeout after a provider may have accepted
the request is resolved by idempotency-key lookup or fresh provider state, never
by blindly repeating a non-idempotent mutation.

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

The task-source adapter, workflow policy, or project instructions may impose a
stricter branch/PR policy. The plugin cannot relax it.

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
  approvals.jsonl
  events.jsonl
  sync-outbox.jsonl
  state.json
  sessions.json
  tasks/<task-id>.json
  artifacts/<job-id>/
  lessons.jsonl
  final-report.md
```

- `campaign.json` is the immutable approved envelope.
- `approvals.jsonl` records digest-bound operator approval events and token-use
  results; it contains no reusable approval secret.
- `events.jsonl` is the append-only recovery/audit sequence.
- `sync-outbox.jsonl` stores idempotent task-source mutation intents,
  acknowledgements, conflicts, and native revisions.
- `state.json` is a derived atomic snapshot and can be rebuilt from events.
- `sessions.json` stores opaque handles and liveness metadata, not credentials.
- task files store normalized snapshots, sync status, native revision tokens,
  and a derived compact provenance read model from canonical source metadata and
  validated campaign events.
- artifacts are bounded, redacted, and excluded from secret/raw-log capture.
- the final report is sanitized and may optionally be copied to a project path
  only when project workflow policy declares that deliverable.

Version one permits one active write campaign per repository on one device. An
atomic lock and heartbeat identify its local owner. Stale-lock recovery checks
live processes, sessions, Git state, and event history before taking ownership.
This lock is not a shared lease and cannot prevent another clone or machine from
attempting the same task. The UI must say `Local coordination only` rather than
implying an exclusive global claim.

On resume a qualifying supervisor revalidates:

- campaign/envelope hashes;
- task-source, workflow-policy, and project-instruction hashes;
- native task revisions and ownership;
- campaign/target branches and commits;
- worktrees and running processes;
- runner sessions and output artifacts;
- budgets and outage entries; and
- last verified integration state.

Any irreconcilable disagreement pauses or holds the campaign. Recovery never
rewrites event history to make the current state look clean.

The local control UI builds three read models without creating another source of
truth:

- **Existing Tasks** refreshes from the selected task-source adapter and shows
  dependency frontier, readiness, blockers, design gates, scores, suggested
  routes, source identity, last sync, pending writes, and conflicts. Selecting
  tasks starts a new preflight rather than mutating them directly.
- **Campaigns** shows active, paused, blocked, held, completed, and cancelled
  local journals with tasks, agents/models, time/spend, outcomes, commits,
  evidence, reports, and sync state. It defaults to the current repository with
  an explicit all-projects filter.
- **Task History** combines the task's compact provenance index with immutable
  campaign journals to show iterations, governing files, commits, pull requests,
  verification, deviations, attribution, follow-ups, and supersession.

Past campaign journals and task iterations are append-only. `Run again` creates
a new preflight and digest; it never edits a completed campaign or reuses its
approval.

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
the task-source adapter and cannot enter the active campaign without new
approval.

## 19. Budgets and circuit breakers

Every campaign has explicit maximum task count, concurrency, wall-clock, token,
cost where available, retries, and optional per-runner quota allocations.

Defaults:

- one resume/retry for a classified transient runner failure;
- no retry for a known usage-limit failure before its reset/probe condition;
- pause one lane after two consecutive task failures;
- pause the campaign after an integration or post-merge verification failure;
- stop before exceeding an approved token/cost/wall-clock ceiling;
- pause on task-source/policy/instruction/task revision drift;
- pause on target conflicts or unexpected protected-branch policy;
- block on missing human approval or escaped delegated-design decision; and
- hold after ambiguous accepted/pushed state.

The supervisor may reduce concurrency or choose a same-tier healthy runner. It
cannot increase budget, retries, authority, or task scope without a new envelope.

## 20. Security boundaries

- External task-source commands are argv arrays; Quirks never executes adapter
  shell strings.
- A committed external adapter is executable project code. Preflight displays
  its path, hash, capabilities, concurrency strength, and requested permissions
  before approval.
- Provider credentials are referenced by user-configured aliases. They never
  enter project configuration, task JSON, argv, prompts, worker environments,
  campaign evidence, or rendered UI. A built-in provider driver or isolated
  external-adapter child receives only the minimum credential material required
  for that provider operation through a scrubbed allow-listed environment.
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

The local control UI is an authorization boundary, not a decorative report:

- it binds only to loopback and generates an exact `127.0.0.1` authority with a
  random port; requests with another `Host` authority fail;
- a cryptographically random, single-use token that expires after at most 15
  minutes is bound to one campaign ID and envelope digest; it is delivered in
  the URL fragment, kept in page memory, and never written to history state,
  logs, cookies, or local storage;
- the initial shell contains no proposal data; authenticated same-origin JSON
  requests fetch the envelope projection and submit approval;
- approval accepts only JSON, the exact origin, `Sec-Fetch-Site: same-origin`,
  the session-bound token, and the displayed digest. There are no form or GET
  mutation endpoints, and replay fails after the first terminal result;
- every response uses `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`,
  and `Cross-Origin-Opener-Policy: same-origin`;
- CSP is generated per response with a fresh nonce and no remote dependencies:
  `default-src 'none'; script-src 'nonce-<random>'; style-src 'nonce-<random>';
  img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none';
  base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
- task text, paths, headers, Git metadata, provider data, logs, and traffic data
  are rendered as escaped text. URLs are parsed; remote links require `https`,
  file/Git actions use internal application routes, and `http` is accepted only
  for the exact loopback UI authority. No attacker-controlled HTML, CSS, script,
  image URL, or automatic remote fetch is accepted; and
- rendered HTML is ephemeral and is never persisted as a campaign artifact.
  Only the canonical envelope, digest, and terminal approval event are durable.

Operator, runner, Git, and provider attribution is evidence, not authorization.
The UI labels local Git identity as self-asserted and uses `verified` only for a
valid signature or authenticated provider identity. It also states that
version-one task claims coordinate only the current device/clone.

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
- **Task-source conflict**: canonical provider/file revision wins; preserve the
  local intent, pause the affected lane, and require explicit reconciliation.
- **Task-source outage**: keep the durable outbox pending; do not claim,
  complete, or report a transition that requires fresh canonical state.
- **Ambiguous mutation acknowledgement**: query by idempotency key or refresh
  native state; never blindly repeat a potentially accepted operation.
- **Invalid provenance**: reject missing Git objects, paths outside the
  repository, mismatched commit/PR boundaries, unsupported URL schemes, and
  unverifiable claims. History displays unavailable references honestly.
- **Stale or replayed approval**: reject the token/digest, perform no mutation,
  and return to a fresh preflight when the underlying envelope changed.
- **Integration failure**: stop new dispatches, preserve exact accepted commits,
  and pause for diagnosis.
- **Pre-push landing failure**: do not push; record landing revision and pause.
- **Post-push ambiguity**: hold for operator; never silently unassign or revert.
- **Crash/restart**: reconstruct from events, Git, task source, sync outbox,
  sessions, and locks; never trust memory.

## 22. Run-start user experience

`quirks-campaign` opens one ephemeral local control workspace with four
provider-neutral views. The underlying read models are also available as
bounded schema-valid CLI JSON for agents and MCP clients; HTML never becomes the
API or source of truth.

**Existing Tasks** refreshes the selected task source, exposes source/sync
health, and shows task readiness, dependencies, blockers, workflow phase,
design/plan gates, risk, effort, confidence, suggested route, and current local
coordination state. A user selects an exact set and starts preflight. The view
does not offer unchecked direct provider mutations.

**Preflight Proposal** is concise but complete:

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

It includes the dependency/execution map, agent lanes, full task list,
selected-task inspector, tests, fallback, and routing rationale. The fixed
approval area offers editing before approval and one exact digest-bound approve
action. After approval, any material change returns to this view with a new
digest.

**Campaigns** lists active and immutable past campaign journals with status,
tasks, waves, runners/models, timing, spend, deviations, outcomes, accepted
commits, pull requests, verification, reports, and sync state. The default scope
is the current repository; all-project history is an explicit filter. `Run
again` always creates a new candidate envelope.

**Task History** shows the compact provenance index without copying its sources:
governing spec/plan/review links at their executed commits, iteration outcomes,
accepted and partial commits, pull requests, verification, deviations,
follow-ups, and distinct operator/agent/Git/provider attribution. Historical
references support `Open as executed`, `Open current`, and `Compare`; missing
objects stay visibly missing.

Every view carries an explicit source/sync freshness indicator. Version one also
shows `Local coordination only` and `No shared lease`; it does not imply that a
claim prevents work from another clone or machine.

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
- changing a task source, workflow policy, or task after approval;
- provider conflict and pressure to overwrite canonical status;
- provider outage with pressure to report a pending completion as done;
- an ambiguous provider timeout that tempts a duplicate mutation;
- a worker fabricating commit, file, pull-request, or identity provenance;
- approval token replay or approval of a digest different from the page;
- pushing when push was not enabled;
- broadening network/production authority;
- quota exhaustion and tempting lower-tier fallback;
- hostile task/log/path/header/Git/provider content rendered in the local UI;
- partial work and sunk-cost pressure;
- target movement, conflicts, and post-push failure; and
- recovery with contradictory Git, task, and campaign state.

### 23.2 Deterministic tests

Dependency-free tests cover:

- every JSON schema and unknown-field rejection;
- campaign state transitions and append-only events;
- canonical envelope hashes;
- shared task-source contract behavior and capability negotiation;
- JSON-driver canonical revisions, local locks, atomic writes, stale updates, and
  recovery from interrupted replacement;
- external-adapter framing, argv-only execution, revisions, diagnostics, and
  output bounds;
- sync outbox intent/acknowledgement ordering, idempotency, retry, pending state,
  provider conflict, ambiguous acknowledgement, and explicit `tasks sync`;
- provenance schemas, Git/path/URL/provider validation, attribution evidence,
  historical-reference failure, and rejection of duplicated content;
- one-time approval token binding, expiry, replay rejection, digest mismatch,
  exact Host/Origin/Fetch Metadata checks, and zero mutation before approval;
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
and adapters: one uses the built-in JSON driver and one uses an external fake
provider implementing the same contract. End-to-end tests prove:

- Quirks contains no native-task assumptions;
- both adapters normalize into the same campaign flow;
- lifecycle-boundary refresh, outbound sync, manual sync, pending writes, and
  canonical conflicts behave identically at the control-plane boundary;
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

### 23.7 Local control UI and provenance tests

Browser tests render realistic attacker-controlled task titles, descriptions,
paths, headers, Git identities, provider metadata, logs, and traffic data. They
verify escaping, URL-scheme restrictions, nonce propagation, the exact CSP and
security headers, no remote requests, no cached proposal response, clickjacking
protection, and no approval via form, GET, cross-origin request, stale token, or
replay.

Projection tests prove that proposal HTML is derived only from the canonical
envelope, that the displayed digest equals the approved digest, and that no HTML
file is persisted. Responsive checks cover the task map, lanes, task list,
inspector, existing tasks, campaigns, and task-history views at desktop and
compact widths without horizontal page overflow; intentionally wide commit
tables may scroll only inside their bounded panel.

History fixtures cover current and missing specifications/plans, partial and
superseded iterations, signed and unsigned Git identities, distinct operator
and provider actors, pull requests and CI links, unavailable providers, and
corrupted campaign journals. The UI must never replace missing historical data
with current data or claim that a local task lock is globally exclusive.

## 24. Acceptance criteria for version one

Version one is acceptable when:

1. The same installed plugin completes deterministic fake-runner campaigns in
   two repositories, one using the built-in JSON task source and one using an
   external fake-provider adapter.
2. Claude Code, Codex, and Cursor each invoke the same control plane and pass all
   three Claude/Codex/Cursor runner cells in the dated real smoke matrix.
3. Campaign preflight resolves an exact task set, flags every design gate,
   presents the approved task map, routes, models, authority, verification,
   merge/push choices, source/sync state, and prevents execution before the
   local UI records digest-specific approval.
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
11. The selected task source remains canonical while Quirks normally performs
    lifecycle writes through one provider-neutral contract.
12. Automatic lifecycle-boundary sync and manual `quirks tasks sync` preserve
    durable intent, idempotency, expected revisions, provider acknowledgement,
    honest pending state, and conflict pauses. No task reports complete before
    its required canonical update is acknowledged.
13. Task JSON provenance fields store only a compact validated index. Governing
    files, commits, pull requests, verification, iterations, deviations,
    follow-ups, and distinct human/agent/Git/provider attribution link to
    authoritative sources without copying their contents.
14. The loopback UI binds approval to a short-lived single-use token and exact
    digest, enforces Host/Origin/Fetch Metadata and the documented CSP/security
    headers, escapes hostile data, makes no remote asset requests, and persists
    no rendered HTML.
15. Existing Tasks, Campaigns, and Task History read models remain
    provider-neutral, show sync freshness and unavailable historical references
    honestly, and state that version-one coordination is local only.
16. Crash recovery reconstructs the campaign and sync outbox without lost
    accepted work, duplicated task dispatch, or rewritten history.
17. Merge reaches only the approved target and push reaches only the explicitly
   approved remote/branch after final verification.
18. Credentials, secrets, project-specific names, personal paths, and account
    identifiers are absent from shipped plugin artifacts and campaign evidence.
19. Skill baseline/forward tests, schema tests, task-source contract tests,
    sync/provenance tests, local UI security/browser tests, fake-runner
    integration, package validation, and portability fixtures all pass.
20. The final report distinguishes completed, rejected, blocked, held, skipped,
    and newly proposed work, with exact commits and reproducible evidence.

## 25. Delivery sequence

Implementation begins only after this written specification is reviewed and
approved. The required delivery order is:

1. write and approve the implementation plan;
2. scaffold and validate the plugin package;
3. implement schemas, canonical campaign state, approval events, sync outbox,
   provenance validator, and the host-independent control-plane lifecycle;
4. implement the provider-neutral `TaskSource` contract, built-in JSON driver,
   external-executable driver, project workflow policy, manual/boundary sync,
   and two portability fixtures;
5. implement the ephemeral loopback UI/API and provider-neutral Existing Tasks,
   Preflight Proposal, Campaigns, and Task History read models;
6. baseline-test and author `dispatching-external-agents`, including versioned
   Claude, Codex, and Cursor runner references;
7. baseline-test and author `delegated-brainstorming`;
8. baseline-test and author `running-agent-campaigns`;
9. implement fake runners/hosts, watchdog, resume, budgets, quota-pool routing,
   and circuit breakers;
10. implement Git integration, merge, approved push, and validated provenance
    write-back;
11. implement and validate Claude Code, Codex, and Cursor installation/control
    integrations without copying the canonical skills;
12. run portable fixture end-to-end acceptance, task-source/sync/provenance/UI
    suites, and the dated nine-cell real host/runner smoke matrix;
13. install through the personal plugin marketplace and expose canonical skills
    to supported harnesses; and
14. run one bounded real project campaign only after the disposable acceptance
    suite passes.
