---
description: Generate a brag document — a polished summary of what's actually shipped on this project, pulled from git history
argument-hint: "[optional: a scope like \"this week\", \"since <tag-or-commit>\", or a date — leave blank for the whole project]"
allowed-tools: Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git rev-parse:*)
---

Generate a brag document for this project: a short, honest, achievement-framed
summary of what's actually been built and shipped, suitable for a performance
review, a resume/portfolio bullet list, a status update to a manager, or just
a record of the work for the person who did it.

Scope: $ARGUMENTS (if blank, cover the full history on the current branch)

## How to build it

1. Resolve the scope into a git range/since-date. If a relative phrase like
   "this week" or "last month" was given, convert it to `--since="..."` for
   `git log`. If a ref/tag/commit was given, use `<ref>..HEAD`. If blank, use
   the full log on the current branch.

2. Pull the real history for that scope — `git log --stat` (or `--patch` for
   anything whose impact isn't clear from the message + stat alone) — and
   read it. Don't just reformat commit subject lines: look at what each
   change actually did (a schema migration, a real bug fixed under load, a
   feature that didn't exist before) and write from that, not from the
   commit message's own framing of itself.

3. Group the result by theme, not chronology — e.g. "Core product", "Real-time
   infrastructure", "Security hardening", "Performance", "Growth/SEO" — 
   whatever categories actually fit what's in the log. Skip trivial/noise
   commits (typo fixes, formatting-only changes, a revert of something in
   the same log) rather than padding the list.

4. Write each line as an outcome, not a mechanism: not "added rate limiting"
   but "closed a brute-force/credential-stuffing gap on login and signup,
   verified under concurrent load" — specific enough that someone who wasn't
   in the room can tell it was real work, without overselling anything the
   log doesn't actually support. No invented metrics — if a real number
   exists in the history (response time, a bug class closed, a limit
   enforced) use it; if it doesn't, don't make one up to sound more
   impressive.

5. Present it as clean markdown directly in the reply. Don't create a file or
   publish an artifact unless asked — this is meant to be read and copied
   from, not necessarily kept as a standing document.
