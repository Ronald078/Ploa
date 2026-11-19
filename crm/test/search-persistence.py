"""Filesystem-only tests. No search, network, operational files or credentials."""
import ctypes
import errno
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from crm import search_persistence as persistence


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="ploa-json-test-")
        self.addCleanup(self.folder.cleanup)
        self.target = Path(self.folder.name) / "progresso_busca.json"
        self.target.write_text('{"version": 1}')

    def read(self):
        return json.loads(self.target.read_text(encoding="utf-8"))

    def test_transient_access_denial_retries_and_publishes(self):
        replace = os.replace
        attempts, sleeps = [], []
        def busy(source, target):
            attempts.append(source)
            if len(attempts) < 3:
                raise PermissionError(errno.EACCES, "Simulated access denial")
            return replace(source, target)
        with patch.object(persistence.os, "replace", busy), patch.object(persistence.time, "sleep", sleeps.append):
            persistence.write_json_atomic(self.target, {"version": 2, "text": "ação"})
        self.assertEqual(self.read()["version"], 2)
        self.assertEqual(len(sleeps), 2)
        self.assertFalse(list(self.target.parent.glob("*.tmp")))

    def test_persistent_denial_keeps_old_and_new_then_recovers(self):
        with patch.object(persistence.os, "replace", side_effect=PermissionError(errno.EACCES, "Locked")) as replace, patch.object(persistence.time, "sleep"):
            with self.assertRaises(PermissionError):
                persistence.write_json_atomic(self.target, {"version": 2})
            self.assertEqual(replace.call_count, len(persistence.REPLACE_DELAYS) + 1)
        self.assertEqual(self.read(), {"version": 1})
        self.assertEqual(len(list(self.target.parent.glob("*.tmp"))), 1)
        result = persistence.read_json_recoverable(self.target, lambda data: isinstance(data, dict))
        self.assertEqual(result, {"version": 2})
        self.assertEqual(self.read(), result)

    def test_disk_full_does_not_retry_or_erase_pending(self):
        with patch.object(persistence.os, "replace", side_effect=OSError(errno.ENOSPC, "Full")), patch.object(persistence.time, "sleep") as sleep:
            with self.assertRaises(OSError):
                persistence.write_json_atomic(self.target, {"version": 2})
            sleep.assert_not_called()
        self.assertEqual(self.read(), {"version": 1})
        self.assertEqual(len(list(self.target.parent.glob("*.tmp"))), 1)

    def test_legacy_temporary_recovers_only_after_validation(self):
        pending = Path(str(self.target) + ".tmp")
        pending.write_text('{"version": 2}')
        os.utime(pending, ns=(self.target.stat().st_mtime_ns + 1000000,) * 2)
        recovered = []
        self.assertEqual(persistence.read_json_recoverable(self.target, lambda data: isinstance(data, dict), recovered.append), {"version": 2})
        self.assertEqual(recovered, [self.target.name])
        self.assertFalse(pending.exists())

    def test_invalid_partial_or_wrong_structure_never_replaces_committed(self):
        pending = Path(str(self.target) + ".tmp")
        for text in ['{"version":', '[]']:
            pending.write_text(text)
            self.assertEqual(persistence.read_json_recoverable(self.target, lambda data: isinstance(data, dict)), {"version": 1})
            self.assertTrue(pending.exists())

    def test_old_temporary_cannot_roll_back_current_progress(self):
        pending = Path(str(self.target) + ".tmp")
        pending.write_text('{"version": 0}')
        os.utime(pending, ns=(self.target.stat().st_mtime_ns - 1000000,) * 2)
        self.assertEqual(persistence.read_json_recoverable(self.target, lambda data: True), {"version": 1})

    def test_missing_destination_can_recover(self):
        pending = Path(str(self.target) + ".tmp")
        pending.write_text('{"version": 2}')
        self.target.unlink()
        self.assertEqual(persistence.read_json_recoverable(self.target, lambda data: True), {"version": 2})

    def test_serialization_failure_does_not_leave_partial_temporary(self):
        with self.assertRaises(TypeError):
            persistence.write_json_atomic(self.target, {"unsupported": object()})
        self.assertFalse(list(self.target.parent.glob("*.tmp")))
        self.assertEqual(self.read(), {"version": 1})

    def test_unique_temporary_does_not_overwrite_existing_pending(self):
        pending = Path(str(self.target) + ".tmp")
        pending.write_text('{"version": 0}')
        persistence.write_json_atomic(self.target, {"version": 2})
        self.assertEqual(json.loads(pending.read_text()), {"version": 0})
        self.assertEqual(self.read(), {"version": 2})

    @unittest.skipUnless(os.name == "nt", "Windows sharing semantics")
    def test_real_windows_sharing_lock_is_retried(self):
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        # Permit reading/writing, but deny deletion/replacement until released.
        handle = kernel.CreateFileW(str(self.target), 0x80000000, 3, None, 3, 0x80, None)
        self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
        timer = threading.Timer(0.25, lambda: kernel.CloseHandle(handle))
        timer.start()
        try:
            persistence.write_json_atomic(self.target, {"version": 2})
        finally:
            timer.join()
        self.assertEqual(self.read(), {"version": 2})


if __name__ == "__main__":
    unittest.main(verbosity=2)
