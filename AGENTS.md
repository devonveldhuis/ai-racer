# AGENTS.md

This repository uses a coordinator/worker/reviewer agent workflow. Every feature or change goes through the loop below. Any agent working in this repo must follow the role it was spawned into.

## Roles

| Role | Model | Responsibility | May edit code? | May commit/push? |
|------|-------|----------------|----------------|------------------|
| **Coordinator** (main thread) | Opus 5.5 | Designs features, talks to the human, writes task specs, spawns workers and reviewers, commits and pushes | No (only `Tasks/` and docs) | Yes, after human approval |
| **Worker** | Sonnet 5.5 | Implements one task spec autonomously, records deviations | Yes | No |
| **Reviewer** | Sonnet 5.5 | Reviews the worker's changes against the spec, approves or rejects | No | No |

Sub-agents are spawned by the coordinator with the model set explicitly (e.g. `model: "sonnet"`). Sub-agents never spawn further agents.

## Workflow

```
 ┌──────────────────────────────────────────────────────────────┐
 │ 1. Coordinator designs feature (iterates with human)         │
 │    → writes Tasks/NNN-feature-name.md                        │
 └──────────────┬───────────────────────────────────────────────┘
                ▼
 ┌──────────────────────────────┐
 │ 2. Worker (Sonnet) implements│◄──────────────┐
 │    → documents deviations    │               │
 └──────────────┬───────────────┘               │
                ▼                               │
 ┌──────────────────────────────┐   REJECTED    │
 │ 3. Reviewer (Sonnet) reviews │──────────────►│ 4. Coordinator designs
 └──────────────┬───────────────┘               │    the fixes, updates the
                │ APPROVED                      │    task file, re-spawns
                ▼                               │    a worker
 ┌──────────────────────────────┐               │
 │ 5. Human final approval      │── changes ────┘
 │    → coordinator commits     │   requested
 │      and pushes to origin    │
 └──────────────────────────────┘
```

### 1. Design (Coordinator)

- Clarify requirements with the human when anything is ambiguous. Don't guess on scope, gameplay feel, or architecture decisions the human cares about.
- Write the feature definition to `Tasks/NNN-short-name.md` (zero-padded, incrementing: `001-car-physics.md`, `002-track-builder.md`, …) using the template below.
- A task should be small enough for one worker to finish in one session. Split larger features into multiple task files.
- Set `Status: ready` when the spec is complete.

### 2. Implement (Worker)

The coordinator spawns a worker with Sonnet 5.5, pointing it at a single task file. The worker:

- Reads `AGENTS.md` and the assigned task file before starting.
- Works **fully autonomously**: it does not ask the human or coordinator questions. When the spec is unclear or wrong, it makes the most reasonable choice and records it.
- Implements only what the task asks for. No unrelated refactors.
- Runs any available builds, tests or linters and fixes failures it introduced.
- Appends an `## Implementation Notes` section to the task file containing:
  - Summary of what was built and the files touched
  - **Deviations**: every place the implementation differs from the spec, and why
  - Known limitations or follow-ups
- Sets `Status: in-review`.
- Does **not** commit, push, or modify other task files.

### 3. Review (Reviewer)

The coordinator spawns a reviewer with Sonnet 5.5, pointing it at the task file. The reviewer:

- Reads the task spec, the worker's implementation notes, and the code changes (`git diff` against the last commit).
- Checks:
  - Every acceptance criterion is met
  - Deviations are justified and acceptable
  - Correctness, edge cases, and obvious bugs
  - Code quality and consistency with the existing codebase
  - Builds/tests pass
  - No unrelated or out-of-scope changes
- Does **not** edit code.
- Appends a `## Review (round N)` section to the task file with a verdict of **APPROVED** or **REJECTED**, plus a list of concrete, actionable issues (blocking vs. non-blocking).

### 4. Rework loop (Coordinator)

If rejected:

- The coordinator reads the review, decides which issues to address (and whether any spec changes are needed), and appends a `## Rework (round N)` section to the task file describing exactly what must change.
- Set `Status: ready` and spawn a **new** worker, then a **new** reviewer. Repeat until approved.
- After **3 rejected rounds**, the coordinator stops and escalates to the human instead of looping further.

### 5. Human approval and ship (Coordinator)

Once the reviewer approves:

- The coordinator presents the human with a summary: what was built, the deviations, the reviewer's notes, and the diff (or a list of changed files).
- **Nothing is committed without explicit human approval.**
- If the human requests changes, go back to step 4.
- If approved:
  - Set `Status: done` in the task file.
  - Commit the code changes and the task file together with a message referencing the task, e.g. `feat: car physics (Tasks/001-car-physics.md)`.
  - Push to `origin` on the current branch.

## Task file template

```markdown
# NNN – Feature name

Status: draft | ready | in-progress | in-review | approved | done

## Goal
One or two sentences on what this feature achieves and why.

## Requirements
- Concrete, testable behaviour
- ...

## Acceptance criteria
- [ ] ...
- [ ] ...

## Technical notes
Suggested approach, relevant files, assets to use (e.g. `Models/raceCarRed.glb`), constraints.

## Out of scope
What the worker should not touch.

<!-- Sections below are appended during the workflow -->

## Implementation Notes
(worker)

### Deviations
(worker — "None" if none)

## Review (round 1)
Verdict: APPROVED | REJECTED
(reviewer)

## Rework (round 1)
(coordinator, only if rejected)
```

## General rules for all agents

- The task file is the single source of truth for a feature; all hand-offs between agents go through it.
- Only the coordinator talks to the human.
- Only the coordinator commits or pushes, and only after human approval.
- Never force-push or rewrite published history.
- Assets in `Models/` are third-party source files; don't modify them.
