import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from django.test import TestCase, override_settings


class BrowserApiTests(TestCase):
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

	def test_repository_tree_lists_sqlite_file(self):
		response = self.client.get('/api/tree/')
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		self.assertEqual(payload['current_path'], '')
		self.assertIn('current_abs_path', payload)
		self.assertTrue(os.path.isabs(payload['current_abs_path']))
		self.assertEqual(payload['parent_path'], '..')
		self.assertEqual(payload['entries'][0]['name'], 'sample.db')
		self.assertTrue(payload['entries'][0]['is_sqlite'])
		self.assertIn('size_human', payload['entries'][0])
		self.assertIn('modified_at', payload['entries'][0])
		self.assertRegex(payload['entries'][0]['modified_at'], r'^\d{8} \d{6}$')
		self.assertIn('stats', payload)
		self.assertIn('directories', payload['stats'])
		self.assertIn('files', payload['stats'])
		self.assertIn('total_size_human', payload['stats'])
		self.assertIn('disk', payload['stats'])
		self.assertIn('used_percent', payload['stats']['disk'])

	def test_open_database_returns_table_metadata(self):
		response = self.client.get('/api/database/', {'path': 'sample.db'})
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		tables = payload['database']['tables']
		self.assertEqual([table['name'] for table in tables], ['customers', 'orders', 'sample'])
		self.assertEqual(tables[0]['columns'][0]['name'], 'id')
		self.assertIn('create_sql', tables[0])
		self.assertIn('indexes', tables[0])

	def test_settings_test_requires_configuration(self):
		response = self.client.post('/api/settings/test/', data=json.dumps({}), content_type='application/json')
		self.assertEqual(response.status_code, 400)
		self.assertIn('LLM endpoint is required', response.json()['error'])

	def test_run_query_executes_read_only_sql(self):
		response = self.client.post(
			'/api/query/',
			data=json.dumps({'path': 'sample.db', 'sql': 'SELECT name FROM customers ORDER BY id'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		self.assertEqual(payload['columns'], ['name'])
		self.assertEqual([row['name'] for row in payload['rows']], ['Kim Mina', 'Park Joon', 'Lee Sora'])

	def test_run_query_executes_multiple_read_only_sql(self):
		response = self.client.post(
			'/api/query/',
			data=json.dumps(
				{
					'path': 'sample.db',
					'sql': (
						"SELECT name FROM sqlite_master WHERE type = 'table';\n"
						"SELECT name FROM customers ORDER BY id LIMIT 2;"
					),
				}
			),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		self.assertIn('results', payload)
		self.assertEqual(payload['result_count'], 2)
		self.assertEqual(payload['results'][0]['statement_index'], 1)
		self.assertEqual(payload['results'][1]['statement_index'], 2)
		self.assertEqual(payload['results'][0]['columns'], ['name'])
		self.assertEqual(payload['results'][1]['columns'], ['name'])
		self.assertEqual(
			[row['name'] for row in payload['results'][1]['rows']],
			['Kim Mina', 'Park Joon'],
		)

	def test_settings_persist_in_repository(self):
		response = self.client.post(
			'/api/settings/',
			data=json.dumps({'endpoint': 'http://localhost:11434/v1', 'token': 'secret', 'model': 'demo'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		response = self.client.get('/api/settings/')
		payload = response.json()
		self.assertEqual(payload['settings']['endpoint'], 'http://localhost:11434/v1')
		self.assertEqual(payload['settings']['token'], 'secret')
		self.assertEqual(payload['settings']['model'], 'demo')

	def test_chat_requires_llm_settings(self):
		response = self.client.post(
			'/api/chat/',
			data=json.dumps({'path': 'sample.db', 'message': 'customers 테이블을 요약해줘'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)
		self.assertIn('LLM endpoint is required', response.json()['error'])

	@mock.patch('browser.services.urllib.request.urlopen')
	def test_chat_executes_returned_sql(self, mocked_urlopen):
		self.client.post(
			'/api/settings/',
			data=json.dumps({'endpoint': 'http://localhost:11434/v1', 'token': 'secret', 'model': 'demo'}),
			content_type='application/json',
		)

		mocked_response = mock.Mock()
		mocked_response.read.return_value = json.dumps(
			{
				'choices': [
					{
						'message': {
							'content': json.dumps(
								{
									'answer': 'customers 테이블에는 3개의 행이 있습니다.',
									'sql': 'SELECT COUNT(*) AS count FROM customers',
								},
								ensure_ascii=False,
							),
						},
					}
				]
			}
		).encode('utf-8')
		mocked_urlopen.return_value.__enter__.return_value = mocked_response

		response = self.client.post(
			'/api/chat/',
			data=json.dumps({'path': 'sample.db', 'message': 'customers 개수를 알려줘'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		payload = response.json()
		self.assertIn('customers 테이블에는 3개의 행이 있습니다.', payload['answer'])
		self.assertEqual(payload['suggested_sql'], 'SELECT COUNT(*) AS count FROM customers')
		self.assertEqual(payload['query_result']['columns'], ['count'])
		self.assertEqual(payload['query_result']['rows'][0]['count'], 3)
