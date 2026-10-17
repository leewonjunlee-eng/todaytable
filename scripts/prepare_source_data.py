"""Prepare the supplied XLSX without inventing user identities or payment state."""
import argparse
import base64
import collections
import hashlib
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
FIELDS = ['submitted_at', 'name', 'contact_phone', 'instagram', 'age', 'gender',
          'occupation', 'mbti', 'areas', 'interests', 'traits', 'desired_traits',
          'food_budgets', 'dates', 'pass_choice', 'consent', 'dietary_notes']


def extract(path):
    path = Path(path)
    original = path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError('Workbook ZIP integrity check failed')
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = workbook.findall('s:sheets/s:sheet', NS)
        if len(sheets) != 1 or sheets[0].get('name') != '설문지 응답 시트1':
            raise ValueError('Unexpected source workbook sheets')
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in node.findall('.//s:t', NS))
                       for node in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        parsed = []
        for row in sheet.findall('s:sheetData/s:row', NS):
            values = [''] * len(FIELDS)
            for cell in row.findall('s:c', NS):
                column = re.match(r'[A-Z]+', cell.attrib['r'])[0]
                index = 0
                for character in column:
                    index = index * 26 + ord(character) - ord('A') + 1
                if cell.find('s:f', NS) is not None or cell.get('t') == 'e':
                    raise ValueError('Unexpected formula/error cell: ' + cell.attrib['r'])
                value_node = cell.find('s:v', NS)
                value = value_node.text or '' if value_node is not None else ''
                if cell.get('t') == 's':
                    value = strings[int(value)] if value else ''
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                if index > len(FIELDS):
                    if value:
                        raise ValueError('Unexpected extra source column')
                else:
                    values[index - 1] = value
            if any(values):
                parsed.append((int(row.attrib['r']), values))
    if parsed[0][0] != 2 or parsed[0][1][1] != '이름(가명)':
        raise ValueError('Expected source headers on Excel row 2')
    headers = parsed[0][1]
    records = []
    fingerprints = collections.defaultdict(list)
    for row_number, values in parsed[1:]:
        fields = dict(zip(FIELDS, values))
        mbti = fields['mbti'].strip().upper()
        issues = ['BIRTH_YEAR_UNKNOWN', 'DATE_YEAR_UNKNOWN', 'PAYMENT_STATUS_UNKNOWN', 'IDENTITY_UNVERIFIED']
        if not re.fullmatch(r'[IE][NS][FT][JP]', mbti):
            issues.append('MBTI_REVIEW_REQUIRED')
        for field in ['submitted_at', 'contact_phone', 'instagram', 'occupation']:
            if not fields[field]:
                issues.append(field.upper() + '_MISSING')
        records.append({'sheet_row': row_number, 'raw_values': values, 'fields': fields, 'issues': issues})
        fingerprints[tuple(values)].append(row_number)
    duplicates = [rows for rows in fingerprints.values() if len(rows) > 1]
    for record in records:
        if any(record['sheet_row'] in group for group in duplicates):
            record['issues'].append('DUPLICATE_CANDIDATE_PRESERVED')
    manifest = {
        'sheet_name': sheets[0].attrib['name'], 'header_row': 2,
        'headers': headers, 'field_keys': FIELDS, 'record_count': len(records),
        'distinct_names': len({r['fields']['name'] for r in records}),
        'gender_counts': dict(collections.Counter(r['fields']['gender'] for r in records)),
        'mbti_review_count': sum('MBTI_REVIEW_REQUIRED' in r['issues'] for r in records),
        'duplicate_candidate_rows': duplicates,
        'blank_counts': {field: sum(not r['fields'][field] for r in records) for field in FIELDS},
        'source_kind': 'SUPPLIED_SYNTHETIC_SURVEY_RESPONSES',
        'conversion_policy': 'Preserve all rows; do not infer birth year, date year, identity or payment.',
    }
    return {'filename': path.name, 'sha256': hashlib.sha256(original).hexdigest(),
            'original_base64': base64.b64encode(original).decode(), 'manifest': manifest, 'records': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='files/우연한식탁_가상데이터.xlsx')
    parser.add_argument('--output', default='.data/provided-data-import.json')
    args = parser.parse_args()
    payload = extract(args.source)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    output.chmod(0o600)
    print(json.dumps({'output': str(output), 'sha256': payload['sha256'], 'manifest': payload['manifest']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
