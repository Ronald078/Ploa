"""Small atomic manifest + immutable source parts; legacy checkpoint recovery."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from uuid import uuid4
from crm.search_persistence import (read_json_recoverable, valid_search_progress,
                                    write_json_atomic, replace_with_retry)


class SearchCheckpoint:
    def __init__(self, file):
        self.path = Path(file)
        self.parts = self.path.with_name(self.path.name + ".partes")
        self.refs, self.verified = {}, set()
        self.signature, self.version, self.backup = None, None, None
        self.part_writes = 0

    def _read_part(self, reference):
        if not isinstance(reference, str) or not re.fullmatch(r"[0-9a-f]{64}", reference):
            raise ValueError("Referência de checkpoint inválida")
        try:
            content = (self.parts / (reference + ".json")).read_bytes()
        except OSError as error:
            raise ValueError("Parte do checkpoint ausente/ilegível; progresso preservado") from error
        if hashlib.sha256(content).hexdigest() != reference:
            raise ValueError("Parte do checkpoint não passou na conferência")
        self.verified.add(reference)
        return json.loads(content)

    def _write_part(self, value):
        content = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        reference = hashlib.sha256(content).hexdigest()
        if reference in self.verified:
            return reference
        self.parts.mkdir(exist_ok=True)
        destination = self.parts / (reference + ".json")
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).hexdigest() == reference:
                self.verified.add(reference)
                return reference
        descriptor, temporary = tempfile.mkstemp(prefix="parte-", suffix=".tmp", dir=self.parts)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        replace_with_retry(temporary, destination)
        self.verified.add(reference)
        self.part_writes += 1
        return reference

    def load(self):
        document = read_json_recoverable(self.path, valid_search_progress)
        self.signature = document["assinatura"]
        self.version = document.get("versao", 1)
        if self.version == 1:
            return document
        if self.version != 2 or not isinstance(document.get("fontes_ref"), dict):
            raise ValueError("Formato de checkpoint não suportado")
        self.refs = document["fontes_ref"]
        self.backup = document.get("backup_legacy")
        sources = {}
        for city, references in self.refs.items():
            if not isinstance(references, dict):
                raise ValueError("Índice de fontes inválido")
            sources[city] = {}
            for source, reference in references.items():
                data = self._read_part(reference)
                if not isinstance(data, dict):
                    raise ValueError("Fonte de checkpoint inválida")
                sources[city][source] = data
        pending = self._read_part(document["pendentes_ref"]) if document.get("pendentes_ref") else []
        if not isinstance(pending, list):
            raise ValueError("Leads pendentes inválidos")
        return {**document, "fontes_por_cidade": sources, "leads_pendentes": pending}

    def _backup_legacy(self):
        if self.version != 1 or self.backup or not self.path.exists():
            return
        directory = self.path.parent / "backups"
        directory.mkdir(exist_ok=True)
        target = directory / (self.path.name + ".legacy-" + uuid4().hex + ".json")
        shutil.copy2(self.path, target)
        with self.path.open("rb") as original, target.open("rb") as backup:
            if hashlib.file_digest(original, "sha256").digest() != hashlib.file_digest(backup, "sha256").digest():
                raise OSError("Cópia do checkpoint antigo não confirmada")
        self.backup = str(target.relative_to(self.path.parent))

    def save(self, progress, city=None, source=None):
        self._backup_legacy()
        changed_signature = self.signature != progress["assinatura"]
        initial = self.version != 2 or changed_signature
        if initial:
            self.refs = {}
        states = progress.get("fontes_por_cidade", {})
        if initial:
            for name, sources in states.items():
                self.refs[name] = {key: self._write_part(value) for key, value in sources.items()}
        elif city is not None and source is not None:
            self.refs.setdefault(city, {})[source] = self._write_part(states[city][source])
        pending = progress.get("leads_pendentes", [])
        manifest = {"versao": 2, "assinatura": progress["assinatura"],
                    "cidades_concluidas": progress.get("cidades_concluidas", []),
                    "fontes_por_cidade": {}, "leads_pendentes": [],
                    "fontes_ref": self.refs,
                    "pendentes_ref": self._write_part(pending) if pending else None,
                    "atualizado_em": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "backup_legacy": self.backup}
        # Publish only after every referenced part has been closed and synced.
        write_json_atomic(self.path, manifest)
        self.version, self.signature = 2, progress["assinatura"]
