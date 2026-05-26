import json
import os
import sqlite3

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .services import (
	DEFAULT_ROW_LIMIT,
	MAX_TABLE_LOAD_ROWS,
	build_chat_context,
	build_folder_chat_context,
	build_multi_folder_chat_context,
	call_llm,
	summarize_chat_context,
	directory_stats,
	fetch_tables,
	format_modified,
	format_size,
	is_sqlite_file,
	load_settings,
	quote_identifier,
	read_md_file,
	relative_to_root,
	resolve_repo_path,
	run_read_only_query,
	save_settings,
	search_nested_entries,
	serialize_rows,
	connect_database,
	explorer_top_root,
	ensure_sales_invoices_time_column,
	write_md_file,
)


def index(request: HttpRequest):
	ensure_sales_invoices_time_column()
	return render(
		request,
		'browser/index.html',
		{
			'repository_root': settings.REPOSITORY_ROOT.name,
			'app_version': getattr(settings, 'VERSION', 'unknown'),
		},
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

		# Pagination parameters
		limit = int(request.GET.get('limit', '500'))
		offset = int(request.GET.get('offset', '0'))
		limit = min(max(limit, 50), 1000)  # 50-1000 range
		offset = max(offset, 0)

		all_entries = []
		try:
			# os.scandir()을 사용해 DirEntry의 캐시된 is_file() 활용 (stat 호출 최소화)
			with os.scandir(str(current_path)) as scan:
				raw = list(scan)
			# 디렉토리 먼저, 같은 타입 내에서는 이름 순
			all_entries = sorted(raw, key=lambda e: (e.is_file(), e.name.lower()))
		except PermissionError as e:
			has_parent = current_path != explorer_top_root()
			# 권한 거부: 부분 결과와 에러 메시지 함께 반환
			return JsonResponse(
				{
					'current_path': relative_to_root(current_path),
					'current_abs_path': str(current_path),
					'parent_path': '' if current_path == explorer_top_root() else relative_to_root(current_path.parent),
					'has_parent': has_parent,
					'entries': [],
					'stats': directory_stats(current_path),
					'total_entries': 0,
					'offset': offset,
					'limit': limit,
					'warning': f'Permission denied reading some entries: {str(e)}',
					'error_code': 'PERMISSION_DENIED',
				}
			)

		# Serialize visible entries only
		total_count = len(all_entries)
		visible_entries = all_entries[offset:offset + limit]
		next_offset = min(offset + len(visible_entries), total_count)

		from pathlib import Path as _Path
		entries = []
		for entry in visible_entries:
			try:
				stat = entry.stat()
				is_file = entry.is_file()
				child = _Path(entry.path)
				size_bytes = stat.st_size if is_file else 0
				entries.append(
					{
						'name': entry.name,
						'path': relative_to_root(child),
						'type': 'file' if is_file else 'directory',
						'is_sqlite': is_sqlite_file(child),
						'is_md': child.suffix.lower() == '.md' if is_file else False,
						'size_bytes': size_bytes,
						'size_human': format_size(size_bytes) if is_file else '',
						'modified_at': format_modified(stat.st_mtime),
					}
				)
			except (OSError, PermissionError):
				# Skip entries we can't stat
				pass

		has_parent = current_path != explorer_top_root()
		parent = ''
		if has_parent:
			parent = relative_to_root(current_path.parent)

		return JsonResponse(
			{
				'current_path': relative_to_root(current_path),
				'current_abs_path': str(current_path),
				'parent_path': parent,
				'has_parent': has_parent,
				'entries': entries,
				'stats': directory_stats(current_path),
				'total_entries': total_count,
				'offset': offset,
				'next_offset': next_offset,
				'limit': limit,
				'has_more': next_offset < total_count,
			}
		)
	except PermissionError as error:
		# 권한 거부: 현재 디렉토리에 접근 불가
		return _json_error(f'Cannot access directory: {str(error)}', 403)
	except (OSError, SuspiciousOperation) as error:
		return _json_error(str(error))


@require_GET
def file_read_view(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		content = read_md_file(relative_path)
		return JsonResponse({'path': relative_path, 'content': content})
	except (OSError, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['POST'])
def file_write_view(request: HttpRequest) -> JsonResponse:
	try:
		data = json.loads(request.body)
		relative_path = str(data.get('path', ''))
		content = str(data.get('content', ''))
		write_md_file(relative_path, content)
		return JsonResponse({'ok': True, 'path': relative_path})
	except (ValueError, json.JSONDecodeError) as error:
		return _json_error(f'Invalid request body: {error}')
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
def repository_tree_search(request: HttpRequest) -> JsonResponse:
	try:
		relative_path = request.GET.get('path', '')
		query = str(request.GET.get('q', '')).strip()
		limit = min(max(int(request.GET.get('limit', '50')), 1), 200)

		current_path = resolve_repo_path(relative_path)
		if not current_path.exists() or not current_path.is_dir():
			raise SuspiciousOperation('Directory does not exist.')

		if not query:
			return JsonResponse({'query': '', 'entries': [], 'count': 0})

		entries = search_nested_entries(current_path, query, limit=limit)
		return JsonResponse({'query': query, 'entries': entries, 'count': len(entries)})
	except ValueError as error:
		return _json_error(f'Invalid limit: {error}')
	except PermissionError as error:
		return _json_error(f'Cannot access directory: {str(error)}', 403)
	except (OSError, SuspiciousOperation) as error:
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
		if fetch_all:
			limit = MAX_TABLE_LOAD_ROWS
		else:
			limit = min(max(int(request.GET.get('limit', DEFAULT_ROW_LIMIT)), 1), 500)
		with connect_database(database_path) as connection:
			cursor = connection.execute(f'SELECT * FROM "{escaped_table}"')
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
			# 토큰은 마스킹해서 반환
			settings_data = load_settings()
			settings_data['token'] = '***' if settings_data.get('token') else ''
			return JsonResponse({'settings': settings_data})

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
		stored_settings = load_settings()
		incoming_request_url = str(payload.get('request_url', '')).strip()
		incoming_request_headers = str(payload.get('request_headers', '')).strip()
		incoming_request_json = str(payload.get('request_json', '')).strip()
		incoming_request_timeout = str(payload.get('request_timeout', '')).strip()

		settings_data = {
			'request_url': incoming_request_url or stored_settings.get('request_url', ''),
			'request_headers': incoming_request_headers or stored_settings.get('request_headers', ''),
			'request_json': incoming_request_json or stored_settings.get('request_json', ''),
			'request_timeout': incoming_request_timeout or stored_settings.get('request_timeout', '30'),
			'system_folder': str(payload.get('system_folder', '')).strip() or stored_settings.get('system_folder', 'system'),
			'current_folder': str(payload.get('current_folder', '')).strip() or stored_settings.get('current_folder', 'current'),
			'hist_folder': str(payload.get('hist_folder', '')).strip() or stored_settings.get('hist_folder', 'hist'),
		}

		result = call_llm(
			settings_data,
			'connection test',
			{
				'database': '',
				'tables': [],
				'previews': [],
			},
		)

		# 연결 테스트 성공 시 현재 값 자동 저장 (Chat에서 동일 설정 즉시 사용).
		save_settings(settings_data)
		return JsonResponse({'ok': True, 'provider': result['provider'], 'llm_debug': result.get('llm_debug')})
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))


@csrf_exempt
@require_http_methods(['POST'])
def chat_view(request: HttpRequest) -> JsonResponse:
	try:
		payload = json.loads(request.body or '{}')
		relative_path = payload.get('path', '')
		explorer_path = payload.get('explorer_path', '')
		question = str(payload.get('message', '')).strip()
		if not question:
			raise SuspiciousOperation('Chat message is required.')
		trace: list[str] = [f'receive chat request question_len={len(question)}']

		database_path = None
		folder_path = None
		settings_data = load_settings()

		if relative_path:
			candidate = resolve_repo_path(relative_path)
			if is_sqlite_file(candidate):
				database_path = candidate
			elif candidate.is_dir():
				folder_path = candidate

		if database_path is None and folder_path is None:
			folder_path = resolve_repo_path(str(explorer_path or ''))

		if database_path is not None:
			trace.append(f'select single database path={relative_to_root(database_path)}')
			context = build_chat_context(database_path, question)
			trace.append('load table/schema/sample/metadata context for single database')
			response = call_llm(settings_data, question, context, database_path)
			response['database'] = {
				'name': database_path.name,
				'path': relative_to_root(database_path),
			}
		else:
			configured_slots: list[tuple[str, object]] = [
				('system', settings_data.get('system_folder', 'system')),
				('current', settings_data.get('current_folder', 'current')),
				('hist', settings_data.get('hist_folder', 'hist')),
			]

			resolved_slots: list[tuple[str, object]] = []
			for slot_name, raw_path in configured_slots:
				try:
					candidate = resolve_repo_path(str(raw_path))
				except SuspiciousOperation:
					trace.append(f'skip configured folder slot={slot_name} path={str(raw_path)} (invalid)')
					continue

				if candidate.exists() and candidate.is_dir():
					resolved_slots.append((slot_name, candidate))
					trace.append(f'use configured folder slot={slot_name} path={relative_to_root(candidate)}')
				else:
					trace.append(f'skip configured folder slot={slot_name} path={str(raw_path)} (not found)')

			if resolved_slots:
				context = build_multi_folder_chat_context(resolved_slots, question)
			else:
				if folder_path is None or not folder_path.exists() or not folder_path.is_dir():
					raise SuspiciousOperation('Current folder is not available for chat context.')

				trace.append(f'select fallback explorer folder path={relative_to_root(folder_path)}')
				context = build_folder_chat_context(folder_path, question)

			if not context.get('database_count'):
				raise SuspiciousOperation('No SQLite files found in configured folders.')
			trace.append(f"scan sqlite files in folder context db_count={int(context.get('database_count', 0))}")

			response = call_llm(settings_data, question, context, None, folder_path)
			response['folder'] = {
				'path': str(context.get('folder', relative_to_root(folder_path) if folder_path else 'configured-folders')),
				'database_count': int(context.get('database_count', 0)),
				'database_list_truncated': bool(context.get('database_list_truncated', False)),
			}

		response['question'] = question
		response['context_summary'] = summarize_chat_context(context)
		llm_trace = response.get('trace', [])
		if isinstance(llm_trace, list):
			response['trace'] = trace + [str(item) for item in llm_trace]
		else:
			response['trace'] = trace
		return JsonResponse(response)
	except (json.JSONDecodeError, OSError, sqlite3.Error, SuspiciousOperation) as error:
		return _json_error(str(error))
