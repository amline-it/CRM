# Plan: Install official Superpowers (obra) for Arena Agent Mode

**Date:** 2026-10-13
**Requested by:** human partner
**Upstream:** https://github.com/obra/superpowers — pinned to `v7.0.0`
(commit `bb92a77741419a4ab5f06e711a283343f1ada0c3`, released 2026-10-09)

Installed following upstream's `docs/porting-to-a-new-harness.md`: Arena Agent
Mode has no shell hook and no in-process plugin API, so this is a project-scoped
**Shape C (instructions-file)** install — the bootstrap ships inside the
project's own always-loaded instructions file.

## Tasks

- [x] 1. Find upstream + read the latest install instructions for the environment
      (README harness table, porting guide Parts 1–6).
- [x] 2. Pin the version (`v7.0.0`) and vendor `skills/` verbatim (74 files, 15 skills).
- [x] 3. Write the harness tool mapping:
      `skills/using-superpowers/references/arena-agent-mode-tools.md`.
- [x] 4. Add the one sanctioned pointer line to `SKILL.md` → Platform Adaptation.
- [x] 5. Generate the bootstrap in `AGENTS.md` (using-superpowers body + tool
      mapping + skill index, inside `<EXTREMELY_IMPORTANT>`).
- [x] 6. Write the reproducible installer/updater (`scripts/superpowers-install.sh`)
      and `--check` verifier; record `.superpowers/manifest.json`.
- [x] 7. Verify: hashes match upstream tag, bootstrap matches generated content,
      skill index matches disk, acceptance path documented.
- [x] 8. Document install/update/verify in `docs/superpowers-install.md` +
      short README section; commit on `arena/41317713-crm`.

## Verification evidence

- `bash scripts/superpowers-install.sh --check` → `files recorded: 76, verified: 76`,
  `AGENTS.md bootstrap: matches generated content`, `skills indexed: 15`, exit 0.
- Network install from the pinned tag (`--ref v7.0.0`) works; `manifest.commit`
  equals the upstream tag's commit (`bb92a77741419a4ab5f06e711a283343f1ada0c3`).
- `diff -rq skills <upstream>/skills` → exactly two intentional differences: the
  added `references/arena-agent-mode-tools.md` and the pointer line in
  `SKILL.md`'s Platform Adaptation section. Every other file is byte-identical.
- Red/green for the verifier: on a tampered copy (skill body edited + bootstrap
  block altered) `--check` fails with the specific files named, exit 1.
- Not verifiable here: the fresh-session acceptance transcript (needs a new
  session). Run it from `docs/superpowers-install.md` → "Acceptance test".

## Deliberate non-goals

- No PR to `obra/superpowers`: upstream requires a real harness install
  mechanism (hook or plugin API) and a live acceptance transcript; this
  environment is an instructions-file install inside a user project.
- No user-global config edits (`~/.claude`, `~/.agents`, `~/.bashrc`, …).
  Everything lives in this repository.

## Acceptance test (fresh session, run by the human partner)

In a **new** Arena session for this repo, send exactly:

> Let's make a react todo list

Expected: the agent announces it is using the `brainstorming` skill and asks
about intent **before** writing any code. If it does not, the bootstrap did not
load — see `docs/superpowers-install.md` → "If it doesn't fire".
