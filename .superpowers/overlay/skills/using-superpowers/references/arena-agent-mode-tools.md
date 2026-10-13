# Arena Agent Mode Tool Mapping

Skills speak in actions ("read a file", "dispatch a subagent", "create a todo").
In Arena.ai Agent Mode (the sandboxed coding agent with a bash workspace, a git
checkout, and live previews) those actions resolve to the tools below.

Tool names here come from the harness's own tool list. Trust your actual tool
list over this table when they disagree.

## Core mapping

| Action a skill requests | Arena Agent Mode equivalent |
| --- | --- |
| Invoke a skill (`Skill` tool, `superpowers:brainstorming`) | **No native skill tool.** Read `skills/<skill-name>/SKILL.md` with `read_file`. Reading `SKILL.md` *is* this harness's skill-loading mechanism — it is not a violation of the "never read skill files manually" rule. Open the file, then follow it exactly. |
| Read a file | `read_file` (`path`, optional `offset`/`limit`, in lines) |
| Create / overwrite a file | `write_file` (`path`, full `content`; parent dirs are created) |
| Edit a file | `edit_file` (`path`, `old_text`, `new_text`; fuzzy on whitespace/indentation, replaces the **first** match only) |
| Delete / move / chmod a file | `bash` (`rm`, `mv`, `chmod`) |
| Run a shell command | `bash` (`command`, optional `cwd`, optional `timeout`, max 1800s) |
| Search file contents / find files by name | `bash` with `grep`, `rg`, `find`, `ls` (there are no separate Grep/Glob tools) |
| Fetch a URL | `fetch_page` |
| Search the web | `web_search` (+ `image_search`, `generate_image`, `generate_speech`/`add_voice` for media) |
| Show a file to the human partner | `present_file` |
| Ask the human partner a question / present choices (`AskUserQuestion`, "ask one question at a time", "present multiple-choice options", "wait for their choice") | `ask_user` (`questions[]`; each has 2–4 `options` with `label`/`description`, plus optional free text). Ask one question per call when a skill says one at a time; put the recommended option first and say so in its label. |
| Connected apps (Notion, Slack, GitHub, …) | `list_connector_tools` with the connector slug, then the tools it returns. Load them before use; they are not available until loaded. |
| Dispatch a subagent (`Subagent (general-purpose):`, `Task tool (general-purpose)`, implementer/reviewer subagents) | **Not available.** There is no subagent/Task tool. Do not fabricate `Task` calls. Use `executing-plans` (inline execution with one fresh-eyes review at the end) instead of `subagent-driven-development` / `dispatching-parallel-agents`, and say plainly that the subagent capability is unavailable if a skill requires it. Meeting-style/human "subagents" (asking the user to fetch something) are fine. |
| Create / update todos (`TodoWrite`, "create a todo per item") | No todo tool. Track tasks in a checklist Markdown file — `docs/plans/YYYY-MM-DD-<slug>.md` for planned work, or `TODO.md` at the repo root for ongoing lists. Announce progress in messages as usual. |
| Long-running work (dev server, watcher, test watcher, visual companion) | `start_process` (`command`, `cwd`, `name`, `startup_wait`) then `get_process_output` / `stop_process`. Never run these through `bash` — a `bash` call stops waiting at its timeout and you lose control of the process. |

## Harness facts that change how skills must be executed

**Git.** The repository is a checkout at `/home/user/CRM`. **This session is
pinned to the branch `arena/41317713-crm`** — never create, switch to, rename,
or push any other branch. Consequences:

- `using-git-worktrees`: **Step 0 always reports an externally managed
  workspace.** Do not create a branch or a git worktree; do the work in place on
  `arena/41317713-crm`. Say so instead of silently skipping.
- `finishing-a-development-branch`: commit and `git push origin
  arena/41317713-crm`, then present the options (PR / keep / discard) to the
  human partner — Arena owns merging. Open PRs with `gh pr create` from this
  branch only; never merge or close a PR without the human partner asking.
- `subagent-driven-development` / `dispatching-parallel-agents`: no subagent
  tool exists, so these degrade to inline work (see above), not to invented
  tool calls.

**Shell environment.** Every `bash` call is a *fresh* shell: no TTY, stdin
closed, no `cwd`/env/aliases/history carried over. Pass `cwd=` explicitly, use
absolute paths, chain with `&&`, and never start something interactive without
`-y` / `--yes` / `DEBIAN_FRONTEND=noninteractive`.

**Network.** `bash` egress is limited to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
`npm` / `pip` / `git clone` from GitHub work; arbitrary `curl`/`pip install` from
other hosts will fail. `fetch_page` / `web_search` go through the platform and
are not affected.

**Persistence.** Only files under `/home/user` are saved between turns, and
directories such as `node_modules`, `dist`, `build`, `.venv`, `__pycache__`,
`target`, `coverage`, `.next`, `.cache` are excluded from snapshots. Keep
deliverables in tracked paths; keep large datasets and build output out of git.

**Browser previews.** Anything the human partner views is proxied from
`https://{port}-{sandboxId}.e2b.app`, so the browser is *not* the sandbox: bind
dev servers to `0.0.0.0`, reference other services with relative URLs (never
`localhost`/`127.0.0.1` from browser-facing code), and have the dev server proxy
to the backend. This applies to the `brainstorming` visual companion and any
server started for a plan's demo step.

**Compaction.** If the session is compacted, re-read
`skills/using-superpowers/SKILL.md` (and this file) before continuing: the
bootstrap in `AGENTS.md` may no longer be in context.

## Non-coding work

Several skills explicitly cover non-software work (a talk, a business, a
renovation, writing). Run them exactly as written here — the mapping above is
the only adaptation. `ask_user`, `fetch_page`, `web_search`, `present_file`, and
the deliverable tools (documents via `write_file`, images via `generate_image`,
speech via `add_voice` + `generate_speech`) are usually the whole tool surface
those tasks need; shell and git often do not apply at all.
