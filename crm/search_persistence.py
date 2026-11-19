"""Atomic JSON persistence for the search worker, including Windows sharing locks."""
import errno
import json
import os
from pathlib import Path
import re
import tempfile
import time


REPLACE_DELAYS = (0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0)


def valid_search_progress(data):
    return (isinstance(data, dict)
            and isinstance(data.get("assinatura"), str)
            and isinstance(data.get("cidades_concluidas", []), list)
            and isinstance(data.get("leads_pendentes", []), list)
            and isinstance(data.get("fontes_por_cidade", {}), dict))


def replace_with_retry(source, destination):
    """Never truncate the destination; retry only sharing/access failures."""
    for attempt in range(len(REPLACE_DELAYS) + 1):
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            transient = error.errno in (errno.EACCES, errno.EPERM, errno.EBUSY) or getattr(error, "winerror", None) in (5, 32, 33)
            if not transient or attempt == len(REPLACE_DELAYS):
                raise
            time.sleep(REPLACE_DELAYS[attempt])


def write_json_atomic(destination, data):
    """Close and sync a unique temporary before publishing. Keep it if rename fails."""
    destination = Path(destination)
    descriptor, temporary = tempfile.mkstemp(prefix=destination.name + ".", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        # Only remove the incomplete temporary created by this invocation.
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    try:
        replace_with_retry(temporary, destination)
    except OSError as error:
        error.add_note("O arquivo anterior foi preservado. A gravação nova permanece em " + temporary)
        raise


def read_json_recoverable(destination, validate, on_recover=None):
    """Recover only a newer, complete, valid temporary for this exact destination."""
    destination = Path(destination)
    try:
        committed_time = destination.stat().st_mtime_ns
    except FileNotFoundError:
        committed_time = -1
    pattern = re.compile(re.escape(destination.name) + r"(?:\.[A-Za-z0-9_-]{8})?\.tmp\Z")
    candidates = []
    for item in destination.parent.iterdir():
        if not pattern.fullmatch(item.name):
            continue
        try:
            modified = item.stat().st_mtime_ns
        except FileNotFoundError:
            continue
        if modified >= committed_time and item.is_file():
            candidates.append((modified, item))
    for _, item in sorted(candidates, key=lambda candidate: candidate[0], reverse=True):
        try:
            with item.open(encoding="utf-8") as stream:
                data = json.load(stream)
        except (OSError, ValueError):
            continue
        if not validate(data):
            continue
        replace_with_retry(item, destination)
        if on_recover:
            on_recover(destination.name)
        return data
    with destination.open(encoding="utf-8") as stream:
        data = json.load(stream)
    if not validate(data):
        raise ValueError("Estrutura inválida em " + destination.name)
    return data
