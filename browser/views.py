import json
import re
import shutil
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

SQLITE_SUFFIXES = {'.db', '.sqlite', '.sqlite3'}
READ_ONLY_PREFIXES = ('select', 'with', 'pragma', 'explain')
DEFAULT_ROW_LIMIT = 100
DEFAULT_SAMPLE_LIMIT = 3
SETTINGS_FILENAME = '.websqlitebrowser-settings.json'
ORACLE_ROWNUM_PATTERN = re.compile(r'(?is)\s+(where|and)\s+rownum\s*(<|<=)\s*(\d+)\s*$')
FENCED_SQL_PATTERN = re.compile(r'```(?:sql)?\s*(.*?)```', re.IGNORECASE | re.DOTALL)


def index(request: HttpRequest):
	return render(
		request,
		'browser/index.html',
		{'repository_root': settings.REPOSITORY_ROOT.name},
	)


def _json_error(message: str, status: int = 400) -> JsonResponse:
	return JsonResponse({'error': message}, status=status)


def _repository_root() -> Path:
	return Path(settings.REPOSITORY_ROOT).resolve()


def _resolve_repo_path(relative_path: str = '') -> Path:
	root = _repository_root()
	candidate = (root / relative_path).resolve()
	if candidate != root and root not in candidate.parents:
		raise SuspiciousOperation('Path is outside repository root.')
	return candidate


def _is_sqlite_file(path: Path) -> bool:
	return path.is_file() and path.suffix.lower() in SQLITE_SUFFIXES


def _relative_to_root(path: Path) -> str:
	root = _repository_root()
	if path == root:
		return ''
	return path.relative_to(root).as_posix()


def _format_size(value: int) -> str:
	units = ['B', 'KB', 'MB', 'GB', 'TB']
	size = float(max(value, 0))
	for unit in units:
		if size < 1024.0 or unit == units[-1]:
			if unit == 'B':
				return f'{int(size)} {unit}'
			return f'{size:.1f} {unit}'
		size /= 1024.0
	return '0 B'


def _format_modified(value: float) -> str:
	return datetime.fromtimestamp(value).strftime('%Y%m%d %H%M%S')


def _directory_stats(current_path: Path) -> dict[str, object]:
	directories = 0
	files = 0
	total_size_bytes = 0

	for child in current_path.iterdir():
		if child.is_dir():
			directories += 1
			for nested in child.rglob('*'):
				if nested.is_file():
					files += 1
					total_size_bytes += nested.stat().st_size
		elif child.is_file():
			files += 1
			total_size_bytes += child.stat().st_size

	disk = shutil.disk_usage(current_path)
	used_percent = (disk.used / disk.total * 100.0) if disk.total else 0.0

	return {
		'directories': directories,
		'files': files,
		'total_size_bytes': total_size_bytes,
		'total_size_human': _format_size(total_size_bytes),
		'disk': {
			'total_bytes': disk.total,
			'used_bytes': disk.used,
			'free_bytes': disk.free,
			'total_human': _format_size(disk.total),
			'used_human': _format_size(disk.used),
			'free_human': _format_size(disk.free),
			'used_percent': round(used_percent, 1),
		},
	}


def _settings_path() -> Path:
	return _repository_root() / SETTINGS_FILENAME


def _load_settings() -> dict[str, str]:
	path = _settings_path()
	if not path.exists():
		return {'endpoint': '', 'token': '', 'model': ''}

	with path.open('r', encoding='utf-8') as handle:
		data = json.load(handle)

	return {
		'endpoint': str(data.get('endpoint', '')),
		'token': str(data.get('token', '')),
		'model': str(data.get('model', '')),
	}


def _save_settings(payload: dict[str, object]) -> dict[str, str]:
	data = {
		'endpoint': str(payload.get('endpoint', '')).strip(),
		'token': str(payload.get('token', '')).strip(),
		'model': str(payload.get('model', '')).strip(),
	}
	path = _settings_path()
	path.parent.mkdir(parents=True, exist_ok=True)
	temporary_path = path.with_suffix(path.suffix + '.tmp')
	with temporary_path.open('w', encoding='utf-8') as handle:
		json.dump(data, handle, ensure_ascii=False, indent=2)
	temporary_path.replace(path)
	return data


def _connect_database(database_path: Path) -> sqlite3.Connection:
	connection = sqlite3.connect(f'file:{database_path}?mode=ro', uri=True)
	connection.row_factory = sqlite3.Row
	return connection


def _fetch_tables(database_path: Path) -> list[dict[str, object]]:
	with _connect_database(database_path) as connection:
		cursor = connection.execute(
			"""
			SELECT name
			     , sql
			FROM sqlite_master
			WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
			ORDER BY name
			"""
		)
		tables = []
		for row in cursor.fetchall():
			table_name = row['name']
			create_sql = row['sql'] or ''
			escaped_table_name = table_name.replace('"', '""')
			columns = [dict(column) for column in connection.execute(
				f'PRAGMA table_info("{escaped_table_name}")'
			).fetchall()]
			indexes = []
			for index_row in connection.execute(f'PRAGMA index_list("{escaped_table_name}")').fetchall():
				index_name = index_row['name']
				index_columns = [
					column['name']
					for column in connection.execute(f'PRAGMA index_info("{_quote_identifier(index_name)}")').fetchall()
				]
				index_sql_row = connection.execute(
					'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
					('index', index_name),
				).fetchone()
				indexes.append(
					{
						'name': index_name,
						'unique': bool(index_row['unique']),
						'origin': index_row['origin'],
						'partial': bool(index_row['partial']),
						'columns': index_columns,
						'sql': index_sql_row['sql'] if index_sql_row else '',
					}
				)
			tables.append(
				{
					'name': table_name,
					'create_sql': create_sql,
					'columns': columns,
					'indexes': indexes,
				}
			)
		return tables


def _serialize_rows(cursor: sqlite3.Cursor, limit: int = 100) -> dict[str, object]:
	columns = [description[0] for description in cursor.description or []]
	fetched_rows = cursor.fetchmany(limit + 1)
	truncated = len(fetched_rows) > limit
	rows = [dict(row) for row in fetched_rows[:limit]]
	return {
		'columns': columns,
		'rows': rows,
		'row_count': len(rows),
		'limit': limit,
		'truncated': truncated,
	}


def _quote_identifier(identifier: str) -> str:
	return identifier.replace('"', '""')


def _table_preview(database_path: Path, table_name: str, limit: int = DEFAULT_SAMPLE_LIMIT) -> list[dict[str, object]]:
	with _connect_database(database_path) as connection:
		escaped_table_name = _quote_identifier(table_name)
		cursor = connection.execute(f'SELECT * FROM "{escaped_table_name}" LIMIT {limit}')
		return [dict(row) for row in cursor.fetchall()]


def _build_chat_context(database_path: Path) -> dict[str, object]:
	tables = _fetch_tables(database_path)
	preview_rows = []
	for table in tables:
		preview_rows.append(
			{
				'table': table['name'],
				'rows': _table_preview(database_path, table['name']),
			}
		)

	return {
		'database': database_path.name,
		'tables': tables,
		'previews': preview_rows,
	}


def _normalise_chat_endpoint(endpoint: str) -> str:
	cleaned = endpoint.strip().rstrip('/')
	if not cleaned:
		return cleaned
	if cleaned.endswith('/chat/completions'):
		return cleaned
	return f'{cleaned}/chat/completions'


def _call_llm(
	settings_data: dict[str, str],
	question: str,
	context: dict[str, object],
	database_path: Path | None = None,
) -> dict[str, object]:
	endpoint = _normalise_chat_endpoint(settings_data.get('endpoint', ''))
	if not endpoint:
		raise SuspiciousOperation('LLM endpoint is required.')

	model = settings_data.get('model', '').strip()
	if not model:
		raise SuspiciousOperation('LLM model is required.')

	system_prompt = (
		'You are a Korean assistant for SQLite database exploration. '
		'Answer using the provided schema and sample rows. '
		'If you are unsure, say so clearly. '
		'Prefer returning JSON with keys answer and sql. '
		'If you include SQL, keep it read-only and valid for SQLite. '
		'When relevant, include a short SQL query in a fenced code block.'
	)
	user_prompt = json.dumps(
		{
			'question': question,
			'context': context,
		},
		ensure_ascii=False,
		indent=2,
	)
	payload = {
		'model': model,
		'messages': [
			{'role': 'system', 'content': system_prompt},
			{'role': 'user', 'content': user_prompt},
		],
		'temperature': 0.2,
	}
	headers = {
		'Content-Type': 'application/json',
	}
	token = settings_data.get('token', '').strip()
	if token:
		headers['Authorization'] = f'Bearer {token}'

	request = urllib.request.Request(
		endpoint,
		data=json.dumps(payload).encode('utf-8'),
		headers=headers,
		method='POST',
	)

	try:
		with urllib.request.urlopen(request, timeout=30) as response:
			response_payload = json.loads(response.read().decode('utf-8'))
	except urllib.error.HTTPError as error:
		detail = error.read().decode('utf-8', errors='ignore').strip()
		message = f'LLM request failed with status {error.code}.'
		if detail:
			message = f'{message} {detail}'
		raise SuspiciousOperation(message)
	except urllib.error.URLError as error:
		raise SuspiciousOperation(f'LLM connection failed: {error.reason}')

	choices = response_payload.get('choices') or []
	message = ''
	if choices:
		first_choice = choices[0]
		if isinstance(first_choice, dict):
			message_block = first_choice.get('message', {})
			if isinstance(message_block, dict):
				message = str(message_block.get('content', '')).strip()
			if not message:
				message = str(first_choice.get('text', '')).strip()

	if not message:
		raise SuspiciousOperation('LLM response did not include a message.')

	suggested_sql = _extract_sql_from_text(message)
	query_result = None
	if suggested_sql and database_path is not None:
		try:
			query_result = _run_read_only_query(database_path, suggested_sql)
		except (OSError, sqlite3.Error, SuspiciousOperation) as error:
			query_result = {'error': str(error)}

	return {
		'answer': message,
		'suggested_sql': suggested_sql,
		'query_result': query_result,
		'provider': 'openai-compatible',
	}


def _validate_read_only_sql(sql: str) -> str:
	cleaned = sql.strip()
	if not cleaned:
		raise SuspiciousOperation('SQL is required.')

	statements = [part.strip() for part in cleaned.split(';') if part.strip()]
	if len(statements) != 1:
		raise SuspiciousOperation('Only one SQL statement is allowed.')

	normalized = statements[0].lower()
	if not normalized.startswith(READ_ONLY_PREFIXES):
		raise SuspiciousOperation('Only read-only SQL statements are allowed.')

	return statements[0]


def _translate_oracle_rownum(sql: str) -> str:
	cleaned = sql.strip().rstrip(';')
	match = ORACLE_ROWNUM_PATTERN.search(cleaned)
	if not match:
		return cleaned

	comparison = match.group(2)
	limit = int(match.group(3))
	if comparison == '<':
		limit -= 1
	if limit < 0:
		limit = 0

	base_sql = cleaned[:match.start()].rstrip()
	base_sql = re.sub(r'(?is)\s+(where|and)\s*$', '', base_sql).rstrip()
	count_match = re.match(r'(?is)^select\s+count\(\*\)\s+from\s+(?P<source>.+)$', base_sql)
	if count_match:
		source = count_match.group('source').strip()
		return f'SELECT COUNT(*) AS count FROM (SELECT * FROM {source} LIMIT {limit}) AS oracle_compat'

	return f'SELECT * FROM ({base_sql}) AS oracle_compat LIMIT {limit}'


def _run_read_only_query(database_path: Path, sql: str) -> dict[str, object]:
	validated_sql = _translate_oracle_rownum(_validate_read_only_sql(sql))
	with _connect_database(database_path) as connection:
		cursor = connection.execute(validated_sql)
		return _serialize_rows(cursor)


def _extract_sql_from_text(text: str) -> str:
	cleaned = text.strip()
	json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
	if json_match:
		try:
			payload = json.loads(json_match.group(0))
			sql_value = str(payload.get('sql', '')).strip()
			if sql_value:
				return sql_value
		except json.JSONDecodeError:
			pass

	fenced_match = FENCED_SQL_PATTERN.search(cleaned)
	if fenced_match:
		return fenced_match.group(1).strip()

	return ''


@require_GET
def repository_tree(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		current_path = _resolve_repo_path(relative_path)

		if not current_path.exists() or not current_path.is_dir():
			raise SuspiciousOperation('Directory does not exist.')

		entries = []
		for child in sorted(current_path.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
			stat = child.stat()
			size_bytes = stat.st_size if child.is_file() else 0
			entries.append(
				{
					'name': child.name,
					'path': _relative_to_root(child),
					'type': 'directory' if child.is_dir() else 'file',
					'is_sqlite': _is_sqlite_file(child),
					'size_bytes': size_bytes,
					'size_human': _format_size(size_bytes) if child.is_file() else '',
					'modified_at': _format_modified(stat.st_mtime),
				}
			)

		parent = ''
		if current_path != _repository_root():
			parent = _relative_to_root(current_path.parent)

		return JsonResponse(
			{
				'current_path': _relative_to_root(current_path),
				'parent_path': parent,
				'entries': entries,
				'stats': _directory_stats(current_path),
			}
		)
	except (OSError, SuspiciousOperation) as error:
		return _json_error(str(error))


@require_GET
def open_database(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		database_path = _resolve_repo_path(relative_path)

		if not _is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		return JsonResponse(
			{
				'database': {
					'name': database_path.name,
					'path': _relative_to_root(database_path),
					'tables': _fetch_tables(database_path),
				},
			}
		)
	except (OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@require_GET
def table_rows(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		table_name = request.GET.get('table', '')
		database_path = _resolve_repo_path(relative_path)

		if not _is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')
		if not table_name:
			raise SuspiciousOperation('Table name is required.')

		escaped_table = _quote_identifier(table_name)
		limit = min(max(int(request.GET.get('limit', DEFAULT_ROW_LIMIT)), 1), 500)
		with _connect_database(database_path) as connection:
			cursor = connection.execute(f'SELECT * FROM "{escaped_table}" LIMIT {limit}')
			payload = _serialize_rows(cursor, limit=limit)

		return JsonResponse(payload)
	except ValueError as error:
		return _json_error(f'Invalid limit: {error}')
	except (OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['POST'])
def run_query(request: HttpRequest) -> JsonResponse:
	try:
		payload = json.loads(request.body or '{}')
		relative_path = payload.get('path', '')
		sql = payload.get('sql', '')
		database_path = _resolve_repo_path(relative_path)

		if not _is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		result = _run_read_only_query(database_path, sql)

		return JsonResponse(result)
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def settings_view(request: HttpRequest) -> JsonResponse:
	try:
		if request.method == 'GET':
			return JsonResponse({'settings': _load_settings()})

		payload = json.loads(request.body or '{}')
		settings_data = _save_settings(payload)
		return JsonResponse({'settings': settings_data})
	except (json.JSONDecodeError, OSError, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['POST'])
def settings_test_view(request: HttpRequest) -> JsonResponse:
	try:
		payload = json.loads(request.body or '{}')
		settings_data = {
			'endpoint': str(payload.get('endpoint', '')).strip(),
			'token': str(payload.get('token', '')).strip(),
			'model': str(payload.get('model', '')).strip(),
		}
		if not settings_data['endpoint'] or not settings_data['model']:
			settings_data = _load_settings()

		result = _call_llm(
			settings_data,
			'connection test',
			{
				'database': '',
				'tables': [],
				'previews': [],
			},
		)
		return JsonResponse({'ok': True, 'provider': result['provider']})
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['POST'])
def chat_view(request: HttpRequest) -> JsonResponse:
	try:
		payload = json.loads(request.body or '{}')
		relative_path = payload.get('path', '')
		question = str(payload.get('message', '')).strip()
		if not question:
			raise SuspiciousOperation('Chat message is required.')

		database_path = _resolve_repo_path(relative_path)
		if not _is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		context = _build_chat_context(database_path)
		response = _call_llm(_load_settings(), question, context, database_path)
		response['database'] = {
			'name': database_path.name,
			'path': _relative_to_root(database_path),
		}
		response['question'] = question
		return JsonResponse(response)
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))
