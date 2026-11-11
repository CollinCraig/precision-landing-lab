"""Text checks for the learner files: role rules, exercise text, hint levels and sentence length."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "pilot-template"


def read(path):
    return (ROOT / path).read_text()


def procedural_sentences(path):
    """Yield (line, sentence) for each sentence in a learner file. Tables, headings and code blocks are skipped."""
    in_code = False
    for number, line in enumerate(path.read_text().splitlines(), 1):
        text = line.strip()
        if text.startswith("```"):
            in_code = not in_code
            continue
        if in_code or not text or text.startswith(("|", "#")):
            continue
        text = re.sub(r"^([-*]|\d+\.) ", "", text)
        text = re.sub(r"`[^`]*`", "CODE", text)
        for sentence in re.split(r"(?<=[.!?:])\s+", text):
            yield number, sentence


PASSIVE = re.compile(r"\b(is|are|was|were|be|been|being) (\w+(ed|en)|refused|written|given|shown|sent|made|done|read|set)\b")


class LearnerTextTests(unittest.TestCase):
    def test_owner_writes_progress_and_tutor_only_proposes_the_help_level(self):
        agents, progress = read("pilot-template/AGENTS.md"), read("pilot-template/progress.md")
        tutor, sessions = read("docs/learning/tutor.md"), read("docs/learning/m1-sessions.md")
        self.assertIn("Never edit `mission.py`, `notes/` or `progress.md`", agents)
        self.assertIn("propose", agents)
        self.assertIn("You write the whole row", progress)
        self.assertIn("The tutor proposes the value in chat. You write it.", progress)
        self.assertIn("The tutor never edits `progress.md`", tutor)
        self.assertIn("The tutor proposes the highest help level", tutor)
        self.assertIn("The tutor proposes the help level in chat. You write it.", sessions)
        for text in (agents, progress, tutor, sessions):
            self.assertNotRegex(text, r"[Tt]he tutor (writes|adds)\b")

    def test_transfer_exercise_text_fits_the_fake(self):
        gate = read("docs/learning/mastery-gate.md")
        row = next(line for line in gate.splitlines() if line.startswith("| 3. Transfer"))
        for phrase in ("hold 8 seconds at 5 m", "the other landing request", "accepts both landing requests",
                       "takeoff height of 5 m only", "keep 5 m",
                       "fails for a 5 second hold", "fails for the old landing request"):
            self.assertIn(phrase, row)
        self.assertNotIn("second climb", row)

    def test_hint_files_are_help_level_2_everywhere(self):
        hints = sorted((TEMPLATE / "hints").glob("step-*/hint-*.md"))
        self.assertEqual(len(hints), 12)
        for hint in hints:
            text = hint.read_text()
            self.assertIn('column "Hint file"', text, hint)
            self.assertIn("All hint files are help level 2.", text, hint)
            self.assertNotRegex(text, r"[Hh]elp level [013]\b", hint)
        for path in ("pilot-template/START-HERE.md", "docs/learning/tutor.md", "docs/learning/m1-sessions.md"):
            self.assertIn("All hint files are help level 2", read(path), path)
        self.assertIn("2 = a hint file (any of the three)", read("pilot-template/progress.md"))
        self.assertIn("(1 to 3)", read("pilot-template/progress.md"))

    def test_learner_files_use_short_active_sentences(self):
        problems = []
        for path in sorted(TEMPLATE.rglob("*.md")):
            for number, sentence in procedural_sentences(path):
                where = f"{path.relative_to(ROOT)}:{number}"
                if len(sentence.split()) > 20:
                    problems.append(f"{where}: {len(sentence.split())} words: {sentence[:60]}")
                if PASSIVE.search(sentence):
                    problems.append(f"{where}: passive voice: {sentence[:60]}")
        self.assertEqual(problems, [])

    def test_the_api_page_names_everything_that_the_platform_gives(self):
        """API.md is a reference. A name that the platform adds must also appear on the page."""
        from lab import mavlite, learn_cli
        from lab.pilot_api import FAIL_CODES, Autopilot, Budgets
        import dataclasses
        page = (TEMPLATE / "API.md").read_text()
        names = ["ap." + name for name in vars(Autopilot) if not name.startswith("_") and callable(vars(Autopilot)[name])]
        names += ["ap.latest", "ap.acks", "ap.texts"]
        names += ["budgets." + field.name for field in dataclasses.fields(Budgets)]
        names += [f"`{code}`" for code in FAIL_CODES]
        names += [f"`{fault}`" for fault in learn_cli.FAKE_FAULTS if fault != "none"]
        names += [spec[0] for spec in mavlite.SPECS.values()]
        names += [f"`{field}`" for spec in mavlite.SPECS.values() for field in spec[2] if not field.startswith("errors_count")]
        names += ["message.type", "message.fields", "message.pretty()"]
        names += ["mavlite." + name for name in dir(mavlite) if name.startswith(("CMD_", "MODE_", "BASE_MODE", "EKF_", "RESULT_"))]
        missing = [name for name in names if name not in page]
        self.assertEqual(missing, [])
        self.assertNotIn("```", page, "The API page gives names. It shows no usage sequence or code block.")

    def test_hint_3_files_do_not_hold_name_tables(self):
        for hint in sorted((TEMPLATE / "hints").glob("step-*/hint-3.md")):
            text = hint.read_text()
            self.assertIn("API.md", text, hint)
            self.assertNotIn("| Item | Reference |", text, hint)
        self.assertIn("API.md", read("pilot-template/START-HERE.md"))
        self.assertIn("SESSION-1.md", read("pilot-template/START-HERE.md"))
        self.assertTrue((TEMPLATE / "SESSION-1.md").is_file())

    def test_no_page_names_a_missing_explainer(self):
        for path in list(TEMPLATE.rglob("*.md")) + [ROOT / "docs/learning/m1-sessions.md"]:
            self.assertNotIn("Explainer 01", path.read_text(), path)

    def test_the_sentence_check_finds_long_and_passive_sentences(self):
        self.assertTrue(PASSIVE.search("A command can be refused."))
        self.assertFalse(PASSIVE.search("The autopilot can refuse a command."))


if __name__ == "__main__":
    unittest.main()
