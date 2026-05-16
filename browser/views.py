import json
import sqlite3

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .services import (
	DEFAULT_ROW_LIMIT,
	build_chat_context,
	call_llm,
	directory_stats,
	fetch_tables,
	format_modified,
	format_size,
	is_sqlite_file,
	load_settings,
	quote_identifier,
	relative_to_root,
	resolve_repo_path,
	run_read_only_query,
	save_settings,
	serialize_rows,
	connect_database,
	explorer_top_root,
)


def index(request: HttpRequest):
	return render(
		request,
		'browser/index.html',
		{'repository_root': settings.REPOSITORY_ROOT.name},
	)


def _json_error(message: str, status: int = 400) -> JsonResponse:
	return JsonResponse({'error': message}, status=status)


@require_GET
def repository_tree(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		current_path = resolve_repo_path(relative_path)

		if not current_path.exists() or not current_path.is_dir():
			raise SuspiciousOperation('Directory does not exist.')

		entries = []
		for child in sorted(current_path.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
			stat = child.stat()
			size_bytes = stat.st_size if child.is_file() else 0
			entries.append(
				{
					'name': child.name,
					'path': relative_to_root(child),
					'type': 'directory' if child.is_dir() else 'file',
					'is_sqlite': is_sqlite_file(child),
					'size_bytes': size_bytes,
					'size_human': format_size(size_bytes) if child.is_file() else '',
					'modified_at': format_modified(stat.st_mtime),
				}
			)

		parent = ''
		if current_path != explorer_top_root():
			parent = relative_to_root(current_path.parent)

		return JsonResponse(
			{
				'current_path': relative_to_root(current_path),
				'current_abs_path': str(current_path),
				'parent_path': parent,
				'entries': entries,
				'stats': directory_stats(current_path),
			}
		)
	except (OSError, SuspiciousOperation) as error:
		return _json_error(str(error))


@require_GET
def open_database(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		database_path = resolve_repo_path(relative_path)

		if not is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		return JsonResponse(
			{
				'database': {
					'name': database_path.name,
					'path': relative_to_root(database_path),
					'tables': fetch_tables(database_path),
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
		database_path = resolve_repo_path(relative_path)

		if not is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')
		if not table_name:
			raise SuspiciousOperation('Table name is required.')

		escaped_table = quote_identifier(table_name)
		fetch_all = request.GET.get('all', '') in {'1', 'true', 'True'}
		limit: int | None = None
		if not fetch_all:
			limit = min(max(int(request.GET.get('limit', DEFAULT_ROW_LIMIT)), 1), 500)
		with connect_database(database_path) as connection:
			if limit is None:
				cursor = connection.execute(f'SELECT * FROM "{escaped_table}"')
			else:
				cursor = connection.execute(f'SELECT * FROM "{escaped_table}" LIMIT {limit}')
			payload = serialize_rows(cursor, limit=limit)

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
		database_path = resolve_repo_path(relative_path)

		if not is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		result = run_read_only_query(database_path, sql)

		return JsonResponse(result)
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def settings_view(request: HttpRequest) -> JsonResponse:
	try:
		if request.method == 'GET':
			return JsonResponse({'settings': load_settings()})

		payload = json.loads(request.body or '{}')
		settings_data = save_settings(payload)
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
			settings_data = load_settings()

		result = call_llm(
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

		database_path = resolve_repo_path(relative_path)
		if not is_sqlite_file(database_path):
			raise SuspiciousOperation('Selected file is not a SQLite database.')

		context = build_chat_context(database_path)
		response = call_llm(load_settings(), question, context, database_path)
		response['database'] = {
			'name': database_path.name,
			'path': relative_to_root(database_path),
		}
		response['question'] = question
		return JsonResponse(response)
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))
