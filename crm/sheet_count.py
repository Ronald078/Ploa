"""Count nonempty rows of the first worksheet with bounded memory (stdlib only)."""
import json
from pathlib import Path
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile


def count_sheet(file):
    file = Path(file)
    before = file.stat()
    with zipfile.ZipFile(file) as book:
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        sheet = next(item for item in workbook.iter() if item.tag.endswith("}sheet"))
        relationship = next(value for key, value in sheet.attrib.items() if key.endswith("}id"))
        relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        link = next(item for item in relationships if item.attrib.get("Id") == relationship)
        if link.attrib.get("TargetMode") == "External":
            raise ValueError("Worksheet externa não suportada")
        target = link.attrib["Target"]
        target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
        empty_strings = set()
        if "xl/sharedStrings.xml" in book.namelist():
            with book.open("xl/sharedStrings.xml") as stream:
                iterator = ET.iterparse(stream, events=("start", "end"))
                _, root = next(iterator)
                index = 0
                for event, item in iterator:
                    if event == "end" and item.tag.endswith("}si"):
                        if not "".join(node.text or "" for node in item.iter() if node.tag.endswith("}t")).strip():
                            empty_strings.add(str(index))
                        index += 1
                        root.clear()
        count, header, parent = 0, False, None
        with book.open(target) as stream:
            for event, item in ET.iterparse(stream, events=("start", "end")):
                if event == "start" and item.tag.endswith("}sheetData"):
                    parent = item
                if event != "end" or not item.tag.endswith("}row"):
                    continue
                nonempty = False
                for cell in item:
                    values = [node.text or "" for node in cell.iter() if node.tag.endswith(("}v", "}t"))]
                    value = "".join(values).strip()
                    if value and not (cell.attrib.get("t") == "s" and value in empty_strings):
                        nonempty = True
                        break
                if not header:
                    header = True  # First row is the header used by the sender.
                elif nonempty:
                    count += 1
                if parent is not None:
                    parent.clear()
    after = file.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("Planilha alterada durante a contagem")
    return {"version": 1, "rows": count, "size": str(after.st_size), "mtimeNs": str(after.st_mtime_ns)}


if __name__ == "__main__":
    print(json.dumps(count_sheet(sys.argv[1])))
