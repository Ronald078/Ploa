"""Read only the contact columns of the first XLSX sheet, without loading it whole."""
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def sheet_rows(archive, sheet, strings, formats):
    with archive.open(sheet) as stream:
        parent = None
        for event, element in ET.iterparse(stream, events=('start', 'end')):
            if event == 'start' and element.tag == NS + 'sheetData':
                parent = element
            if event != 'end' or element.tag != NS + 'row':
                continue
            values = {}
            numeric_formats = {}
            for cell in element.findall(NS + 'c'):
                column = re.sub(r'\d', '', cell.get('r', ''))
                raw = cell.findtext(NS + 'v', '')
                kind = cell.get('t')
                if kind == 's':
                    raw = strings[int(raw)] if raw else ''
                elif kind == 'inlineStr':
                    raw = ''.join(cell.itertext())
                elif kind not in ('str', 'b', 'e') and raw:
                    style = int(cell.get('s', '0'))
                    numeric_formats[column] = formats[style] if style < len(formats) else 0
                values[column] = raw
            yield values, numeric_formats
            element.clear()
            if parent is not None:
                parent.clear()


def read_rows(file):
    with zipfile.ZipFile(file) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as stream:
                for _, element in ET.iterparse(stream, events=('end',)):
                    if element.tag == NS + 'si':
                        strings.append(''.join(element.itertext()))
                        element.clear()
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        first = workbook.find(NS + 'sheets/' + NS + 'sheet')
        rid = first.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(item.get('Target') for item in relationships if item.get('Id') == rid)
        sheet = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
        formats = [0]
        if 'xl/styles.xml' in archive.namelist():
            styles = ET.fromstring(archive.read('xl/styles.xml'))
            custom = {int(item.get('numFmtId')): item.get('formatCode') for item in styles.findall(NS + 'numFmts/' + NS + 'numFmt')}
            formats = [custom.get(int(item.get('numFmtId', '0')), int(item.get('numFmtId', '0'))) for item in styles.findall(NS + 'cellXfs/' + NS + 'xf')] or [0]
        rows = sheet_rows(archive, sheet, strings, formats)
        header, _ = next(rows, ({}, {}))
        columns = {column: value.strip().lower() for column, value in header.items()}
        counts, hits = {}, {}
        has_number_header = 'numero' in columns.values()
        phone_seen, field = False, None
        for values, _ in rows:
            row = {name: values.get(column, '') for column, name in columns.items()}
            if row.get('numero'):
                field = 'numero'
                break
            if row.get('telefone'):
                phone_seen = True
                if not has_number_header:
                    field = 'telefone'
                    break
            for name, value in row.items():
                if name == 'nome' or not value:
                    continue
                counts[name] = counts.get(name, 0) + 1
                if 8 <= len(re.sub(r'\D', '', value)) <= 15:
                    hits[name] = hits.get(name, 0) + 1
        rows.close()
        if field is None and phone_seen:
            field = 'telefone'
        if field is None:
            best = 0
            for name, total in counts.items():
                ratio = hits.get(name, 0) / total
                if total >= 5 and ratio >= .7 and ratio > best:
                    best, field = ratio, name
        if field is None:
            if counts:
                raise ValueError('Phone column unavailable')
            return []
        result = []
        phone_column = next(column for column, name in reversed(list(columns.items())) if name == field)
        for index, (values, numeric_formats) in enumerate(sheet_rows(archive, sheet, strings, formats)):
            if index == 0:
                continue
            row = {name: values.get(column, '') for column, name in columns.items()}
            if row.get(field):
                result.append([row[field], row.get('país') or row.get('pais') or 'Brasil', row.get('ddi', ''), row.get('categoria', ''), numeric_formats.get(phone_column)])
        return result


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        json.dump(read_rows(sys.argv[1]), sys.stdout, ensure_ascii=False, separators=(',', ':'))
    except Exception:
        sys.stderr.write('Contact worksheet unavailable\n')
        sys.exit(1)
