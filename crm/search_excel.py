"""Streaming spreadsheet I/O for the existing sender contract."""
import os
from pathlib import Path
import tempfile
from openpyxl import Workbook, load_workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from crm.search_persistence import replace_with_retry, write_json_atomic


def read_leads(file, sheet_name="Contatos", check=lambda: None, progress=lambda message: None):
    file = Path(file)
    if not file.exists():
        return []
    workbook = load_workbook(file, read_only=True, data_only=True)
    try:
        if sheet_name not in workbook.sheetnames:
            raise ValueError("Aba Contatos ausente; arquivo original preservado")
        rows = workbook[sheet_name].iter_rows(values_only=True)
        first = next(rows, None)
        if first is None:
            return []
        header = [str(value).strip() if value is not None else "" for value in first]
        if not all(name in header for name in ("Nome", "Telefone")):
            raise ValueError("Cabeçalho Nome/Telefone ausente; arquivo original preservado")
        leads = []
        for index, row in enumerate(rows):
            if index % 256 == 0:
                check()
            if all(value is None or str(value).strip() == "" for value in row):
                continue
            leads.append({field: value if value is not None else "" for field, value in zip(header, row)})
            if len(leads) % 16384 == 0:
                progress(f"Lendo planilha: {len(leads):,} contatos carregados.".replace(",", "."))
        progress(f"Leitura concluída: {len(leads):,} contatos carregados.".replace(",", "."))
        return leads
    finally:
        workbook.close()


def _sheet(workbook, name, rows, columns, progress):
    progress(f"Preparando aba {name}: {len(rows):,} contatos.".replace(",", "."))
    sheet = workbook.create_sheet(name)
    sheet.freeze_panes = "A2"
    for index, field in enumerate(columns, 1):
        largest = max(len(field), max((len(str(lead.get(field, ""))) for lead in rows), default=0))
        sheet.column_dimensions[get_column_letter(index)].width = min(largest + 3, 50)
    header = []
    for field in columns:
        cell = WriteOnlyCell(sheet, value=field)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(start_color="2F5597", end_color="2F5597", fill_type="solid")
        header.append(cell)
    sheet.append(header)
    for index, lead in enumerate(rows, 1):
        sheet.append([lead.get(field, "") for field in columns])
        if index % 20000 == 0:
            progress(f"Exportando aba {name}: {index:,} de {len(rows):,} contatos.".replace(",", "."))


def write_leads(leads, file, columns, sheet_name="Contatos", progress=lambda message: None):
    if not leads:
        return []
    file = Path(file)
    groups = {}
    for lead in leads:
        groups.setdefault(lead.get("Categoria", ""), []).append(lead)
    workbook = Workbook(write_only=True)
    descriptor, temporary = tempfile.mkstemp(prefix=file.name + ".", suffix=".tmp.xlsx", dir=file.parent)
    os.close(descriptor)
    try:
        _sheet(workbook, sheet_name, leads, columns, progress)
        for category in sorted(groups):
            _sheet(workbook, str(category)[:31], groups[category], columns, progress)
        progress("Compactando e publicando a planilha; o arquivo anterior permanece protegido até concluir.")
        workbook.save(temporary)
        with open(temporary, "rb+") as stream:
            os.fsync(stream.fileno())
        replace_with_retry(temporary, file)
    finally:
        workbook.close()
    # A sidecar is accepted by the server only for this exact file version.
    stat = file.stat()
    try:
        write_json_atomic(str(file) + ".metrics.json", {"version": 1, "rows": len(leads),
                          "size": str(stat.st_size), "mtimeNs": str(stat.st_mtime_ns)})
    except OSError:
        print("A contagem auxiliar será refeita pelo painel; a planilha foi salva.", flush=True)
    return [sheet_name] + sorted(groups)
