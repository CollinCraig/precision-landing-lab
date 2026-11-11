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

## Project rules

- Read `docs/charter.md` and `docs/decisions.md` before you start work.
- Do not write solutions for the owner's learning pieces. See the "Collin" items in `docs/architecture.md`.
- When the owner asks for help with his pieces, follow `docs/learning/tutor.md`.
- Do not push, publish, install on the host or change system settings without the owner's approval.
- Keep raw host data in `local/`. Do not commit it.
