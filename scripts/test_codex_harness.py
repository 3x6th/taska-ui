"""Regression checks for the role boundary, not for Taska's product code."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("harness", Path(__file__).with_name("codex-harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class HarnessTest(unittest.TestCase):
    def test_only_builder_gets_write_access(self):
        for role in harness.ROLES:
            with self.subTest(role=role):
                args = harness.command("codex", role, Path("verdict.md"))
                mode = args[args.index("--sandbox") + 1]
                self.assertEqual(mode, "workspace-write" if role == "frontend-builder" else "read-only")
                for protection in ("--ignore-user-config", "--ignore-rules", "--ephemeral",
                                   'approval_policy="never"', "features.apps=false",
                                   "features.plugins=false", "features.request_permissions_tool=false",
                                   "features.image_generation=false", "features.hooks=false",
                                   "agents.enabled=false", 'web_search="disabled"',
                                   'shell_environment_policy.inherit="none"'):
                    self.assertIn(protection, args)
                self.assertNotIn("--approve-for-me", args)
                self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", args)

    def test_missing_or_modified_role_fails_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".claude/agents").mkdir(parents=True)
            for role in harness.ROLES:
                (root / ".claude/agents" / f"{role}.md").write_text(
                    f"---\nname: {role}\ndescription: Test role\nmodel: opus\ntools: Read\n---\n\nIdentical body.\n")
            with patch.object(harness, "ROOT", root):
                with self.assertRaises(ValueError):
                    harness.sync(check=True)
                harness.sync()
                harness.sync(check=True)
                target = root / ".codex/agents/release-reviewer.toml"
                target.write_text(target.read_text().replace("Identical body.", "Silently changed."))
                with self.assertRaises(ValueError):
                    harness.sync(check=True)

    def test_bad_explicit_cli_never_falls_back(self):
        with patch.dict(harness.os.environ, {"TASKA_CODEX_BIN": "/missing/codex"}), \
             patch.object(harness.shutil, "which", return_value="/some/other/codex"):
            # Existing binaries after an explicit missing path must not be tried.
            with self.assertRaises(RuntimeError):
                harness.binary()

    def test_real_role_definitions_are_synchronized(self):
        harness.sync(check=True)

    def test_failed_isolation_never_starts_a_reviewer(self):
        with patch.object(harness, "sync"), \
             patch.object(harness, "binary", return_value="codex"), \
             patch.object(harness, "probe", side_effect=RuntimeError("Isolation failed")), \
             patch.object(harness.subprocess, "run") as execute:
            with self.assertRaisesRegex(RuntimeError, "Isolation failed"):
                harness.run("release-reviewer", Path("unused-brief.md"), Path("unused-output.md"))
            execute.assert_not_called()

    def test_successful_probe_exit_without_all_denials_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(harness, "ROOT", Path(directory)), \
             patch.object(harness.socket, "create_server"), \
             patch.object(harness.subprocess, "run", return_value=harness.subprocess.CompletedProcess(
                 [], 0, '{"read": true, "overwrite_denied": true, "create_denied": true, "network_denied": false}', "")):
            with self.assertRaisesRegex(RuntimeError, "Incomplete read-only probe"):
                harness.probe("codex")


if __name__ == "__main__":
    unittest.main()
