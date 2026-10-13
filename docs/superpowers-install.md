# Superpowers install (Arena Agent Mode)

This repository has the official **Superpowers** skills by
[Jesse Vincent (obra)](https://github.com/obra/superpowers) installed for
Arena.ai Agent Mode.

| | |
| --- | --- |
| Upstream | https://github.com/obra/superpowers |
| Pinned ref | `v7.0.0` (commit `bb92a77741419a4ab5f06e711a283343f1ada0c3`, released 2026-10-09) |
| Skills | `skills/` — 15 skills, 75 files, vendored verbatim (MIT) |
| Bootstrap | `AGENTS.md` — always-loaded instructions file, generated block between markers |
| Tool mapping | `skills/using-superpowers/references/arena-agent-mode-tools.md` |
| Record | `.superpowers/manifest.json` (version, commit, per-file sha256) |
| Installer | `scripts/superpowers-install.sh` (`install` · `--check`) |

## Why this shape

Superpowers ships per-harness integrations (Claude Code hooks, OpenCode/pi
in-process plugins, Gemini instructions file, …). Arena Agent Mode is not in
that list, so the install follows upstream's
[`docs/porting-to-a-new-harness.md`](https://github.com/obra/superpowers/blob/main/docs/porting-to-a-new-harness.md)
for a harness with no shell hook and no plugin API — **Shape C
(instructions-file)**:

- the *content* is the vendored `skills/` tree, byte-identical to upstream;
- the *bootstrap* (the full `using-superpowers` skill, wrapped in
  `<EXTREMELY_IMPORTANT>`) plus the harness tool mapping and skill index is
  generated into `AGENTS.md`, which agents working in a repository read at
  session start;
- the *tool mapping* translates skill actions ("dispatch a subagent", "create a
  todo", "invoke a skill") into this harness's real tools — including the three
  that do not exist here (subagents, todos, a skill tool) and their sanctioned
  fallbacks.

Per upstream's rules, no skill body was edited: the only additions inside
`skills/` are the pointer line in `SKILL.md`'s *Platform Adaptation* section (the
one edit a port may make) and the tool-mapping reference file.

Everything is project-scoped. Nothing was written to user-global config
(`~/.claude`, `~/.agents`, shells, …).

## Verify

```bash
bash scripts/superpowers-install.sh --check
```

Checks every recorded file's sha256 against `.superpowers/manifest.json`, that
the `AGENTS.md` bootstrap block matches what the generator produces from the
current skills, and that every installed skill appears in the index. Exits
non-zero with a list of problems on drift (hand-edits inside the generated block,
a modified skill file, a half-finished update).

## Update

```bash
bash scripts/superpowers-install.sh --ref main      # or a newer tag, e.g. v7.1.0
bash scripts/superpowers-install.sh --check
git diff --stat                                     # review, then commit
```

`--source /path/to/superpowers` installs from a local checkout (offline).
`--no-agents` vendors `skills/` without regenerating the `AGENTS.md` block.
The manifest records which upstream commit you are on, so
`git diff` on `skills/` plus `.superpowers/manifest.json` is a readable update
diff.

## Use

Nothing to configure: every session in this repository gets the bootstrap from
`AGENTS.md`, and skills trigger on their own descriptions (the index is at the
bottom of that file). To invoke one explicitly, name it — "use the brainstorming
skill" / "run systematic-debugging on this failure" — or read
`skills/<skill-name>/SKILL.md` directly.

The methodology is not coding-only. `brainstorming` explicitly covers
non-software work (a talk, a business, a renovation), `writing-plans` and
`executing-plans` drive any multi-step deliverable, `verification-before-completion`
governs any "it's done" claim, and `writing-skills` covers authoring new skills.
The tool mapping's last section lists what those tasks use in this environment
(`ask_user`, `fetch_page`, `write_file`, media tools — often no shell at all).

### Acceptance test (upstream's, run in a **fresh** session)

Send exactly:

> Let's make a react todo list

Expected: the agent announces it is using the `brainstorming` skill and asks what
you actually want **before** writing any code. That is the same test upstream
uses for a new harness port.

### If it doesn't fire

1. `bash scripts/superpowers-install.sh --check` — rule out drift.
2. Confirm the session is rooted in this repository (the bootstrap travels with
   the repo; a session opened elsewhere won't see it).
3. Belt-and-braces: paste one line into the chat —
   "Read `skills/using-superpowers/SKILL.md` and follow it." That is this
   harness's documented skill-loading mechanism, and it re-arms everything else.

This is the honest limit of an instructions-file install: upstream's structural
guarantees (hook injection, dedup, re-injection after compaction) require a
harness hook or plugin API that Agent Mode does not expose. If a session is
compacted, re-read `skills/using-superpowers/SKILL.md`.

## Uninstall

```bash
rm -rf skills .superpowers && rm -f AGENTS.md
```

or drop the generated block from `AGENTS.md` (everything between the
`BEGIN superpowers` / `END superpowers` markers) and delete `skills/` +
`.superpowers/`.

## License

Upstream Superpowers is MIT (© Jesse Vincent). The vendored copy in `skills/`
keeps the upstream license; see `LICENSE` upstream.
