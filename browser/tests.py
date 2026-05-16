import json
import os
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path
from unittest import mock

from django.core.exceptions import SuspiciousOperation
from django.test import TestCase, override_settings

from browser import services


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
		# POST 응답에서는 토큰이 마스킹됨
		self.assertEqual(response.json()['settings']['token'], '***')

		response = self.client.get('/api/settings/')
		payload = response.json()
		self.assertEqual(payload['settings']['endpoint'], 'http://localhost:11434/v1')
		# GET 응답에서도 토큰은 마스킹됨
		self.assertEqual(payload['settings']['token'], '***')
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


# ---------------------------------------------------------------------------
# 서비스 레이어 단위 테스트
# ---------------------------------------------------------------------------

class ResolveRepoPathTests(TestCase):
    """resolve_repo_path() – 경로 해석 및 OS 루트 초과 방어"""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tempdir.name)
        self.override = override_settings(REPOSITORY_ROOT=self.repo_root)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        self.tempdir.cleanup()

    def test_empty_path_returns_repo_root(self):
        result = services.resolve_repo_path('')
        self.assertEqual(result, self.repo_root.resolve())

    def test_normal_relative_path_resolved(self):
        sub = self.repo_root / 'sub'
        sub.mkdir()
        result = services.resolve_repo_path('sub')
        self.assertEqual(result, sub.resolve())

    def test_nested_path_allowed(self):
        nested = self.repo_root / 'a' / 'b' / 'c'
        nested.mkdir(parents=True)
        result = services.resolve_repo_path('a/b/c')
        self.assertEqual(result, nested.resolve())

    def test_path_traversal_resolves_within_os_root(self):
        # 설계상 OS 루트(/)까지의 탐색은 허용한다.
        # ../../.. 가 결국 파일시스템 루트 내에 있으므로 예외가 발생하지 않아야 한다.
        result = services.resolve_repo_path('../../..')
        self.assertIsInstance(result, Path)

    def test_path_stays_within_filesystem_anchor(self):
        # 결과 경로가 OS 앵커(/ 또는 C:\) 아래에 있어야 한다.
        result = services.resolve_repo_path('')
        anchor = Path(result.anchor)
        self.assertTrue(result == anchor or anchor in result.parents or result == anchor)


class TranslateOracleRownumTests(TestCase):
    """translate_oracle_rownum() – Oracle ROWNUM 구문 변환"""

    def test_less_than(self):
        sql = 'SELECT * FROM orders WHERE rownum < 11'
        result = services.translate_oracle_rownum(sql)
        self.assertIn('LIMIT 10', result)

    def test_less_than_or_equal(self):
        sql = 'SELECT * FROM orders WHERE rownum <= 5'
        result = services.translate_oracle_rownum(sql)
        self.assertIn('LIMIT 5', result)

    def test_rownum_less_than_one_yields_zero(self):
        sql = 'SELECT * FROM orders WHERE rownum < 1'
        result = services.translate_oracle_rownum(sql)
        self.assertIn('LIMIT 0', result)

    def test_count_star_with_rownum(self):
        sql = 'SELECT COUNT(*) FROM orders WHERE rownum < 11'
        result = services.translate_oracle_rownum(sql)
        self.assertIn('COUNT(*)', result)
        self.assertIn('LIMIT 10', result)

    def test_no_rownum_unchanged(self):
        sql = 'SELECT * FROM orders WHERE id > 5'
        result = services.translate_oracle_rownum(sql)
        self.assertEqual(result, sql)

    def test_and_rownum(self):
        sql = 'SELECT * FROM orders WHERE id > 0 AND rownum <= 3'
        result = services.translate_oracle_rownum(sql)
        self.assertIn('LIMIT 3', result)


class ValidateReadOnlySqlTests(TestCase):
    """validate_read_only_sql() – 허용/거부 정책"""

    def test_select_allowed(self):
        result = services.validate_read_only_sql('SELECT 1')
        self.assertEqual(result, 'SELECT 1')

    def test_with_cte_allowed(self):
        sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte'
        result = services.validate_read_only_sql(sql)
        self.assertEqual(result, sql)

    def test_pragma_allowed(self):
        result = services.validate_read_only_sql('PRAGMA table_info(customers)')
        self.assertIn('PRAGMA', result)

    def test_explain_allowed(self):
        result = services.validate_read_only_sql('EXPLAIN SELECT 1')
        self.assertIn('EXPLAIN', result)

    def test_delete_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('DELETE FROM orders')

    def test_drop_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('DROP TABLE orders')

    def test_insert_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('INSERT INTO orders VALUES (1)')

    def test_update_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('UPDATE orders SET id=1')

    def test_empty_sql_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('   ')


class SplitSqlStatementsTests(TestCase):
    """split_sql_statements() – 세미콜론 기반 다중 SQL 파싱"""

    def test_single_statement(self):
        stmts = services.split_sql_statements('SELECT 1;')
        self.assertEqual(len(stmts), 1)
        self.assertEqual(stmts[0], 'SELECT 1')

    def test_multiple_statements(self):
        sql = 'SELECT 1;\nSELECT 2;'
        stmts = services.split_sql_statements(sql)
        self.assertEqual(len(stmts), 2)
        self.assertEqual(stmts[0], 'SELECT 1')
        self.assertEqual(stmts[1], 'SELECT 2')

    def test_no_trailing_semicolon(self):
        stmts = services.split_sql_statements('SELECT 1')
        self.assertEqual(len(stmts), 1)
        self.assertEqual(stmts[0], 'SELECT 1')

    def test_empty_sql_raises(self):
        with self.assertRaises(SuspiciousOperation):
            services.split_sql_statements('  ')

    def test_semicolon_inside_string_not_split(self):
        sql = "SELECT 'a;b' AS v"
        stmts = services.split_sql_statements(sql)
        self.assertEqual(len(stmts), 1)


class ParseLlmContentTests(TestCase):
    """parse_llm_content() – LLM 응답 파싱"""

    def test_fenced_json(self):
        content = '```json\n{"answer": "hello", "sql": "SELECT 1"}\n```'
        answer, sql = services.parse_llm_content(content)
        self.assertEqual(answer, 'hello')
        self.assertEqual(sql, 'SELECT 1')

    def test_bare_json(self):
        content = '{"answer": "hi", "sql": "SELECT 2"}'
        answer, sql = services.parse_llm_content(content)
        self.assertEqual(answer, 'hi')
        self.assertEqual(sql, 'SELECT 2')

    def test_plain_text_fallback(self):
        content = 'Just a plain answer without JSON'
        answer, sql = services.parse_llm_content(content)
        self.assertEqual(answer, content)
        self.assertEqual(sql, '')

    def test_fenced_sql_extraction(self):
        content = 'Here is the query:\n```sql\nSELECT 3\n```'
        answer, sql = services.parse_llm_content(content)
        self.assertEqual(sql, 'SELECT 3')

    def test_empty_content(self):
        answer, sql = services.parse_llm_content('')
        self.assertEqual(answer, '')
        self.assertEqual(sql, '')

    def test_json_answer_only(self):
        content = '{"answer": "only answer"}'
        answer, sql = services.parse_llm_content(content)
        self.assertEqual(answer, 'only answer')
        self.assertEqual(sql, '')


class FormatSizeTests(TestCase):
    """format_size() – 사람이 읽기 쉬운 크기 포맷"""

    def test_bytes(self):
        self.assertEqual(services.format_size(512), '512 B')

    def test_kilobytes(self):
        self.assertEqual(services.format_size(1024), '1.0 KB')

    def test_megabytes(self):
        self.assertEqual(services.format_size(1024 * 1024), '1.0 MB')

    def test_zero(self):
        self.assertEqual(services.format_size(0), '0 B')


class QuoteIdentifierTests(TestCase):
    """quote_identifier() – SQL 식별자 내부 따옴표 이스케이프"""

    def test_normal_name_unchanged(self):
        # 특수문자 없는 이름은 그대로 반환
        result = services.quote_identifier('orders')
        self.assertEqual(result, 'orders')

    def test_internal_double_quote_escaped(self):
        # 내부 " 는 "" 로 이스케이프
        result = services.quote_identifier('table"name')
        self.assertEqual(result, 'table""name')

    def test_multiple_quotes_escaped(self):
        result = services.quote_identifier('a"b"c')
        self.assertEqual(result, 'a""b""c')


class SqlInjectionDefenseTests(TestCase):
    """validate_read_only_sql() – SQL 인젝션 방어"""

    def test_select_statement_allowed(self):
        # SELECT는 읽기 전용이므로 허용
        sql = 'SELECT * FROM users'
        result = services.validate_read_only_sql(sql)
        self.assertEqual(result.strip(), sql)

    def test_with_statement_allowed(self):
        # WITH (CTE)는 읽기 전용이므로 허용
        sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte'
        result = services.validate_read_only_sql(sql)
        self.assertIn('WITH', result)

    def test_pragma_allowed(self):
        # PRAGMA는 읽기 전용이므로 허용
        sql = 'PRAGMA table_info(users)'
        result = services.validate_read_only_sql(sql)
        self.assertIn('PRAGMA', result)

    def test_insert_rejected(self):
        # INSERT는 쓰기 명령이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('INSERT INTO users VALUES (1)')

    def test_update_rejected(self):
        # UPDATE는 쓰기 명령이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('UPDATE users SET name = "x"')

    def test_delete_rejected(self):
        # DELETE는 쓰기 명령이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('DELETE FROM users')

    def test_attach_rejected(self):
        # ATTACH는 위험한 패턴이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('ATTACH DATABASE "evil.db" AS evil')

    def test_detach_rejected(self):
        # DETACH는 위험한 패턴이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('DETACH DATABASE evil')

    def test_vacuum_rejected(self):
        # VACUUM은 위험한 패턴이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('VACUUM')

    def test_sql_line_comment_removed(self):
        # -- 주석은 제거됨
        sql = 'SELECT * FROM users -- SELECT * FROM sensitive'
        result = services.validate_read_only_sql(sql)
        self.assertNotIn('sensitive', result)

    def test_sql_block_comment_removed(self):
        # /* */ 주석은 제거됨
        sql = 'SELECT * FROM users /* DROP TABLE users */'
        result = services.validate_read_only_sql(sql)
        self.assertNotIn('DROP', result)

    def test_join_limit_enforced(self):
        # 6개 이상의 JOIN은 거부 (복잡도 제한)
        sql = '''
            SELECT * FROM t1
            JOIN t2 ON t1.id = t2.id
            JOIN t3 ON t1.id = t3.id
            JOIN t4 ON t1.id = t4.id
            JOIN t5 ON t1.id = t5.id
            JOIN t6 ON t1.id = t6.id
            JOIN t7 ON t1.id = t7.id
        '''
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql(sql)

    def test_subquery_limit_enforced(self):
        # 4개 이상의 "(SELECT" 패턴은 거부 (복잡도 제한)
        # 검증에서는 "(SELECT" 또는 "(select" 패턴을 3개 초과로 거부
        sql = 'SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT 1))))'
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql(sql)

    def test_empty_sql_rejected(self):
        # 빈 SQL은 거부
        with self.assertRaises(SuspiciousOperation):
            services.validate_read_only_sql('   ')

    def test_whitespace_trimmed(self):
        # 공백은 정리됨
        sql = '  SELECT 1  '
        result = services.validate_read_only_sql(sql)
        self.assertEqual(result, 'SELECT 1')


class PathValidationSecurityTests(TestCase):
    """resolve_repo_path() – 경로 검증 보안"""

    @override_settings(REPOSITORY_ROOT='/tmp/test_repo')
    def test_null_byte_in_path_rejected(self):
        # null byte는 경로 조작의 징후이므로 거부
        with self.assertRaises(SuspiciousOperation):
            services.resolve_repo_path('file\x00.txt')

    @override_settings(REPOSITORY_ROOT='/tmp/test_repo')
    def test_non_string_path_rejected(self):
        # 문자열이 아닌 경로는 거부
        with self.assertRaises(SuspiciousOperation):
            services.resolve_repo_path(123)  # type: ignore

    @override_settings(REPOSITORY_ROOT='/tmp/test_repo')
    def test_resolved_path_within_repo_root(self):
        # resolve()된 경로가 top_root 범위 내에 있어야 함
        result = services.resolve_repo_path('subdir')
        # top_root 이하에 있어야 함
        top_root = services.explorer_top_root()
        try:
            result.relative_to(top_root)
            # 성공: 범위 내에 있음
            self.assertTrue(True)
        except ValueError:
            self.fail('Path is outside allowed root')


class TokenEncryptionTests(TestCase):
    """토큰 암호화/복호화 테스트"""

    def test_encrypt_decrypt_token(self):
        # 토큰 암호화 후 복호화
        original_token = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456789'
        encrypted = services._encrypt_token(original_token)
        
        # 암호화된 토큰은 원본과 다름
        self.assertNotEqual(encrypted, original_token)
        
        # 복호화하면 원본과 같음
        decrypted = services._decrypt_token(encrypted)
        self.assertEqual(decrypted, original_token)

    def test_encrypt_empty_token(self):
        # 빈 토큰은 암호화하지 않음
        encrypted = services._encrypt_token('')
        self.assertEqual(encrypted, '')

    def test_decrypt_empty_token(self):
        # 빈 토큰은 복호화하지 않음
        decrypted = services._decrypt_token('')
        self.assertEqual(decrypted, '')

    def test_encrypt_decrypt_special_chars(self):
        # 특수문자 포함 토큰
        token = 'token!@#$%^&*()_+-=[]{}|;:,.<>?'
        encrypted = services._encrypt_token(token)
        decrypted = services._decrypt_token(encrypted)
        self.assertEqual(decrypted, token)


class SensitiveInfoMaskingTests(TestCase):
    """민감 정보 마스킹 테스트"""

    def test_mask_absolute_paths_windows(self):
        # Windows 절대 경로 마스킹
        content = 'Data is stored in C:\\Users\\Admin\\database.sqlite'
        masked = services.mask_sensitive_info(content)
        self.assertNotIn('C:\\', masked)
        self.assertIn('[DATABASE_PATH]', masked)

    def test_mask_absolute_paths_posix(self):
        # POSIX 절대 경로 마스킹
        content = 'Data is stored in /home/user/data/database.sqlite'
        masked = services.mask_sensitive_info(content)
        self.assertNotIn('/home/user', masked)
        self.assertIn('[DATABASE_PATH]', masked)

    def test_mask_token_patterns(self):
        # 긴 토큰 문자열 마스킹 (40자 이상)
        content = 'Your token is sk-proj-abcdefghijklmnopqrstuvwxyz1234567890abcdef'
        masked = services.mask_sensitive_info(content)
        self.assertIn('[TOKEN]', masked)
        self.assertNotIn('sk-proj', masked)

    def test_mask_email_addresses(self):
        # 이메일 주소 마스킹
        content = 'Contact admin@example.com for help'
        masked = services.mask_sensitive_info(content)
        self.assertIn('[EMAIL]', masked)
        self.assertNotIn('admin@example.com', masked)

    def test_mask_database_path(self):
        # 데이터베이스 경로 마스킹
        from pathlib import Path
        db_path = Path('/repo/sample.db')
        content = 'Found data in /repo/sample.db with records from /repo'
        masked = services.mask_sensitive_info(content, db_path)
        self.assertNotIn('sample.db', masked)

    def test_normal_text_unchanged(self):
        # 일반 텍스트는 변경되지 않음
        content = 'This is normal database query result'
        masked = services.mask_sensitive_info(content)
        self.assertEqual(masked, content)
