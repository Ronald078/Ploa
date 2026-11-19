"""Checkpoint and streaming-XLSX regressions in disposable directories."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from openpyxl import Workbook, load_workbook
from crm.search_checkpoint import SearchCheckpoint
from crm.search_excel import read_leads, write_leads
from crm.sheet_count import count_sheet

COLUMNS = ["Nome", "Telefone", "Categoria", "País", "DDI", "Idioma"]


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="ploa-storage-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.file = self.root / "progresso_busca.json"
        self.progress = {"assinatura": "same-configuration", "cidades_concluidas": ["A"],
                         "leads_pendentes": [{"Nome": "Pendente", "Telefone": "+5511999999999"}],
                         "fontes_por_cidade": {"A": {"overture": {"concluida": True, "leads": [{"Nome": "Fonte 1"}]},
                                                     "osm": {"categorias_concluidas": ["Restaurante"], "leads": []}}}}

    def legacy(self):
        content = json.dumps(self.progress, ensure_ascii=False).encode()
        self.file.write_bytes(content)
        return content

    def test_legacy_roundtrip_and_verified_backup(self):
        original = self.legacy()
        store = SearchCheckpoint(self.file)
        loaded = store.load()
        store.save(loaded)
        manifest = json.loads(self.file.read_text())
        self.assertEqual(manifest["versao"], 2)
        self.assertEqual((self.root / manifest["backup_legacy"]).read_bytes(), original)
        resumed = SearchCheckpoint(self.file).load()
        for key, value in self.progress.items():
            self.assertEqual(resumed[key], value)

    def test_only_dirty_source_is_persisted_and_unchanged_save_writes_no_parts(self):
        self.progress["fontes_por_cidade"]["A"]["overture"]["padding"] = "x" * 2_000_000
        store = SearchCheckpoint(self.file)
        store.save(self.progress)
        first = json.loads(self.file.read_text())
        writes = store.part_writes
        store.save(self.progress)
        self.assertEqual(store.part_writes, writes)
        self.progress["fontes_por_cidade"]["A"]["osm"]["categorias_concluidas"].append("Petshop")
        store.save(self.progress, "A", "osm")
        second = json.loads(self.file.read_text())
        self.assertEqual(store.part_writes, writes + 1)
        self.assertEqual(first["fontes_ref"]["A"]["overture"], second["fontes_ref"]["A"]["overture"])
        self.assertLess(self.file.stat().st_size, 4096)

    def test_manifest_failure_keeps_previous_committed_version(self):
        store = SearchCheckpoint(self.file)
        store.save(self.progress)
        self.progress["fontes_por_cidade"]["A"]["osm"]["changed"] = True
        with patch("crm.search_checkpoint.write_json_atomic", side_effect=PermissionError("simulated")):
            with self.assertRaises(PermissionError):
                store.save(self.progress, "A", "osm")
        restored = SearchCheckpoint(self.file).load()
        self.assertNotIn("changed", restored["fontes_por_cidade"]["A"]["osm"])

    def test_missing_or_corrupt_part_fails_closed(self):
        store = SearchCheckpoint(self.file)
        store.save(self.progress)
        manifest = json.loads(self.file.read_text())
        part = store.parts / (manifest["fontes_ref"]["A"]["osm"] + ".json")
        part.write_text("{}")
        with self.assertRaises(ValueError):
            SearchCheckpoint(self.file).load()
        part.unlink()
        with self.assertRaises(ValueError):
            SearchCheckpoint(self.file).load()

    def test_signature_change_preserves_pending_and_resets_source_index(self):
        store = SearchCheckpoint(self.file)
        store.save(self.progress)
        changed = {**self.progress, "assinatura": "new", "cidades_concluidas": [], "fontes_por_cidade": {}}
        store.save(changed)
        restored = SearchCheckpoint(self.file).load()
        self.assertEqual(restored["fontes_por_cidade"], {})
        self.assertEqual(restored["leads_pendentes"], self.progress["leads_pendentes"])

    def test_invalid_reference_does_not_escape_storage(self):
        store = SearchCheckpoint(self.file)
        store.save(self.progress)
        manifest = json.loads(self.file.read_text())
        manifest["fontes_ref"]["A"]["osm"] = "../unexpected"
        self.file.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            SearchCheckpoint(self.file).load()

    def rows(self):
        return [{"Nome": "Empresa " + country, "Telefone": phone, "Categoria": category, "País": country, "DDI": ddi, "Idioma": language}
                for country, phone, ddi, language, category in [
                    ("Brasil", "5511999991234", "55", "pt-BR", "Restaurante"),
                    ("Portugal", "351912345678", "351", "pt-PT", "Salão de beleza"),
                    ("Estados Unidos", "12125551234", "1", "en-US", "Restaurante"),
                    ("Espanha", "34612345678", "34", "es-ES", "Salão de beleza")]]

    def test_streaming_xlsx_preserves_sender_contract_style_and_exact_count(self):
        file = self.root / "contatos.xlsx"
        rows = self.rows()
        messages = []
        write_leads(rows, file, COLUMNS, progress=messages.append)
        self.assertEqual(read_leads(file, progress=messages.append), rows)
        self.assertTrue(any("Preparando aba Contatos" in message for message in messages))
        self.assertTrue(any("Leitura concluída: 4" in message for message in messages))
        book = load_workbook(file)
        self.addCleanup(book.close)
        self.assertEqual(book.sheetnames, ["Contatos", "Restaurante", "Salão de beleza"])
        self.assertEqual(book["Contatos"].freeze_panes, "A2")
        self.assertTrue(book["Contatos"]["A1"].font.bold)
        self.assertEqual(book["Contatos"]["A1"].fill.fgColor.rgb, "002F5597")
        self.assertGreater(book["Contatos"].column_dimensions["A"].width, 10)
        count = count_sheet(file)
        self.assertEqual(count["rows"], 4)
        self.assertEqual(count, json.loads(Path(str(file) + ".metrics.json").read_text()))

    def test_corrupt_or_missing_sheet_never_silently_replaces_existing_data(self):
        file = self.root / "contatos.xlsx"
        file.write_bytes(b"invalid workbook")
        with self.assertRaises(Exception):
            read_leads(file)
        book = Workbook()
        book.active.title = "Outra"
        book.save(file)
        with self.assertRaises(ValueError):
            read_leads(file)

    def test_replace_failure_keeps_old_workbook_and_complete_new_temporary(self):
        file = self.root / "contatos.xlsx"
        write_leads(self.rows(), file, COLUMNS)
        digest = hashlib.sha256(file.read_bytes()).digest()
        with patch("crm.search_excel.replace_with_retry", side_effect=PermissionError("locked")):
            with self.assertRaises(PermissionError):
                write_leads(self.rows()[:2], file, COLUMNS)
        self.assertEqual(hashlib.sha256(file.read_bytes()).digest(), digest)
        temporary = list(self.root.glob("*.tmp.xlsx"))
        self.assertEqual(len(temporary), 1)
        self.assertEqual(len(read_leads(temporary[0])), 2)

    def test_count_ignores_blank_and_secondary_rows(self):
        file = self.root / "contatos.xlsx"
        book = Workbook()
        sheet = book.active
        sheet.append(["Nome", "Telefone"])
        sheet.append(["", " "])
        sheet.append([0, None])
        sheet.append([False, None])
        sheet.append(["Cliente", "123"])
        book.create_sheet("Duplicados").append(["não contar"])
        book.save(file)
        self.assertEqual(count_sheet(file)["rows"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
