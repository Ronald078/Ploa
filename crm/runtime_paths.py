"""Application code and each local account's files have separate roots."""
import os
from pathlib import Path

CODE_ROOT = Path(__file__).resolve().parent.parent


def data_root():
    value = os.environ.get("PLOA_DATA_ROOT")
    if not value:
        return str(CODE_ROOT)
    if not os.path.isabs(value) or "\0" in value:
        raise ValueError("Diretório de dados do Ploa inválido.")
    return os.path.abspath(value)
