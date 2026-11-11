# Agent instructions

These rules apply to every AI agent that works in this repository.

## Communication with the owner

Write all messages and owner-facing text in **ASD-STE100 Simplified Technical English**.
Owner-facing text includes chat replies, reports, briefs, primers, hints and demo pages.

- Use a maximum of 20 words in a procedural sentence. Use a maximum of 25 words in a descriptive sentence.
- Write one instruction in each sentence. Use the imperative for steps.
- Use the active voice. Use only simple tenses: present, past and future.
- Use words that have one meaning. Do not use idioms or slang.
- Write one topic in each paragraph. Use a maximum of 6 sentences in a paragraph.
- Use lists for steps and options.
- You can use technical names, for example MAVLink, GUIDED and NED.

## Text in the repository (hybrid rule, D-024)

- Use STE for procedures, setup and run steps, test procedures, primers, hints and safety rules.
- Use normal technical English for the README introduction, research notes and the decision log.
- The README must include this line: "Procedures in this repository follow ASD-STE100 Simplified Technical English."
- Do not put absolute home paths, usernames, hostnames or emails in tracked files.

## Commit authorship (D-036)

- Agents commit with an agent identity, never as the owner. Use `git -c user.name="Landing Lab Agent (<model>)" -c user.email="agent-<model>@noreply.invalid" commit ...`.
- The owner's own commits use his identity and get no co-author line.

## Context rules (prevent compaction loops)

- Read project docs ONCE at the start. Use `grep` or `sed` ranges for the rows you need. Don't `cat` whole large files.
- After a context compaction, don't re-read the docs. Continue from your own notes file.
- Write findings or progress to a file AS YOU GO (for example after each area). Don't keep them only in context.
- Read code in slices of 150 lines or fewer, and only where you need them.
- If you have compacted TWICE in one task, stop exploring: write the result you have, mark what is unfinished, and finish.
- Keep each task to one area. Split large reviews into several tasks.

## Project rules

- Read `docs/charter.md` and `docs/decisions.md` before you start work.
- Do not write solutions for the owner's learning pieces. See the "Collin" items in `docs/architecture.md`.
- When the owner asks for help with his pieces, follow `docs/learning/tutor.md`.
- Do not push, publish, install on the host or change system settings without the owner's approval.
- Keep raw host data in `local/`. Do not commit it.
