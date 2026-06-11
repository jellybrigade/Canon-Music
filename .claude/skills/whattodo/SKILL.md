---
name: whattodo
description: Manage the Canon backlog in instructions/what-to-do.md. Add, remove, reprioritize, or display items. Use when user says "what to do", "show the backlog", "add to backlog", "remove from backlog", "reprioritize", or invokes /whattodo.
---

Read `instructions/what-to-do.md`. Then act based on what the user asked:

**No args / "show":** Print the table only (not the detail sections).

**"add [feature]":** Add a new row to the table. Ask for Type (Bugfix / QoL / Feature / Perf) and Priority (High / Medium / Low) if not provided. Also append a detail section at the bottom with what the user told you — describe the problem or desired outcome clearly, but do NOT include implementation suggestions, file names, or approach hints. The implementing agent will explore the codebase and figure out the how. Keep competitor-audit references if relevant.

**"remove [feature]" / "done [feature]":** Delete the matching row from the table AND its detail section.

**"prioritize [feature] [high/medium/low]":** Update the Priority cell in the table row. No other changes.

**"move up/down [feature]":** Reorder the row within its priority group (items are grouped loosely by priority in the table).

After any edit, confirm the change in one line. Do not reprint the full table unless asked.
