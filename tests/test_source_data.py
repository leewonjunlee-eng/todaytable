import base64
import hashlib
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_source_data import extract


class SourceDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).resolve().parents[1] / 'files/우연한식탁_가상데이터.xlsx'
        cls.payload = extract(cls.source)

    def test_every_response_and_blank_column_is_preserved(self):
        rows = self.payload['records']
        self.assertEqual(len(rows), 294)
        self.assertEqual([r['sheet_row'] for r in rows], list(range(3, 297)))
        self.assertTrue(all(len(r['raw_values']) == 17 for r in rows))
        self.assertTrue(all(r['fields']['contact_phone'] == '' for r in rows))
        self.assertTrue(all('birth_year' not in r['fields'] for r in rows))
        self.assertTrue(all('PAYMENT_STATUS_UNKNOWN' in r['issues'] for r in rows))

    def test_nested_commas_and_uncertain_values_are_not_reinterpreted(self):
        first = self.payload['records'][0]['fields']
        self.assertEqual(first['interests'], '운동 (헬스, 러닝, 클라이밍 등), 자기계발·공부')
        self.assertEqual(first['food_budgets'], '20,000~30,000원')
        self.assertEqual(first['age'], '27.0')
        self.assertEqual(first['dates'], '5/28 (목), 6/4 (목)')
        self.assertEqual(first['mbti'], 'Entj')

    def test_duplicate_candidates_and_mbti_anomalies_survive(self):
        manifest = self.payload['manifest']
        self.assertEqual(manifest['distinct_names'], 258)
        self.assertEqual(manifest['mbti_review_count'], 15)
        self.assertEqual(manifest['duplicate_candidate_rows'], [[218, 271]])
        rows = {r['sheet_row']: r for r in self.payload['records']}
        self.assertEqual(rows[218]['raw_values'], rows[271]['raw_values'])
        self.assertEqual(rows[98]['fields']['mbti'], 'wNTJ')

    def test_original_workbook_roundtrips_byte_for_byte(self):
        restored = base64.b64decode(self.payload['original_base64'])
        self.assertEqual(restored, self.source.read_bytes())
        self.assertEqual(hashlib.sha256(restored).hexdigest(), self.payload['sha256'])


if __name__ == '__main__':
    unittest.main()
