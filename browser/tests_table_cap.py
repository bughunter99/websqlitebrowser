import sqlite3
import shutil
import tempfile
from pathlib import Path

from django.test import TestCase, override_settings


class TableLoadCapTests(TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.repository_root = Path(self.tempdir.name)
        source_database = Path('/root/workspace/websqlitebrowser/repository/sample.db')
        shutil.copy2(source_database, self.repository_root / 'sample.db')
        self.override = override_settings(REPOSITORY_ROOT=self.repository_root)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        self.tempdir.cleanup()

    def test_table_rows_caps_fetch_all_to_10000_rows(self):
        large_db = self.repository_root / 'large.db'
        with sqlite3.connect(large_db) as connection:
            connection.execute('CREATE TABLE big_table (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
            connection.executemany(
                'INSERT INTO big_table (name) VALUES (?)',
                [(f'row-{index}',) for index in range(10050)],
            )

        response = self.client.get('/api/table/', {'path': 'large.db', 'table': 'big_table', 'all': '1'})
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertEqual(payload['row_count'], 10000)
        self.assertTrue(payload['truncated'])
        self.assertEqual(len(payload['rows']), 10000)
