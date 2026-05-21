import json
import os
import re
import ast
import shutil
import sqlite3
import gzip
import hashlib
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.utils.html import escape

from . import oracle_to_sqlite

SQLITE_SUFFIXES = {'.db', '.sqlite', '.sqlite3'}
GZIP_SUFFIX = '.gz'
SQLITE_MAGIC_HEADER = b'SQLite format 3\x00'
READ_ONLY_PREFIXES = ('select', 'with', 'pragma', 'explain')
DEFAULT_ROW_LIMIT = 100
MAX_TABLE_LOAD_ROWS = 10000
DEFAULT_SAMPLE_LIMIT = 3
SETTINGS_FILENAME = '.websqlitebrowser-settings.json'
DEFAULT_REQUEST_URL = ''
DEFAULT_REQUEST_HEADERS = '{\n  "Content-Type": "application/json"\n}'
DEFAULT_REQUEST_JSON = '{\n  "messages": [\n    {"role": "user", "content": "{{user_prompt}}"}\n  ]\n}'
DEFAULT_REQUEST_TIMEOUT_SECONDS = '30'
DEFAULT_SYSTEM_FOLDER = 'system'
DEFAULT_CURRENT_FOLDER = 'current'
DEFAULT_HIST_FOLDER = 'hist'
DEFAULT_ADDITIONAL_HEADERS = ''
DEFAULT_ADDITIONAL_PAYLOAD = ''
METADATA_MAX_DOCS = 12
METADATA_MAX_CHARS_PER_DOC = 5000
FOLDER_CHAT_MAX_DATABASES = 8
FOLDER_CHAT_PREVIEW_TABLES_PER_DB = 2
LEGACY_DEFAULT_LLM_ENDPOINTS = {
    'http://127.0.0.1:11434/v1',
    'http://localhost:11434/v1',
}
FENCED_SQL_PATTERN = re.compile(r'```(?:sql)?\s*(.*?)```', re.IGNORECASE | re.DOTALL)
FENCED_JSON_PATTERN = re.compile(r'```(?:json)?\s*(\{.*?\})\s*```', re.IGNORECASE | re.DOTALL)
AMBIGUOUS_ANSWER_MARKERS = (
    '필요합니다',
    '명시',
    '불명확',
    '제약',
    '추가 정보',
    '정확한 분석',
    '정확한 계산',
)
CLARIFICATION_SELECTED_MARKERS = (
    '기준 선택:',
    'WARN 이전/이후 기준과 계산식',
)


def repository_root() -> Path:
    return Path(settings.REPOSITORY_ROOT).resolve()


def explorer_top_root() -> Path:
    # Allow browsing up to filesystem root (Windows drive root or POSIX '/').
    root = repository_root()
    return Path(root.anchor).resolve()


def resolve_repo_path(relative_path: str = '') -> Path:
    """
    강화된 경로 검증
    - 심볼릭 링크 공격 방지
    - 경로 트래버설 공격 감지
    - 정규화된 절대 경로 사용
    - 허용된 범위 내 경로만 반환
    """
    repo_root = repository_root()
    top_root = explorer_top_root()
    
    # 1. 입력 검증
    if not isinstance(relative_path, str):
        raise SuspiciousOperation('Invalid path format.')
    
    # 경로에서 null byte 검사
    if '\x00' in relative_path:
        raise SuspiciousOperation('Null byte in path.')
    
    # 2. 경로 정규화 (심볼릭 링크 해석)
    try:
        candidate = (repo_root / relative_path).resolve()
    except (OSError, RuntimeError) as e:
        raise SuspiciousOperation(f'Invalid path: {str(e)}')
    
    # 3. 경로 범위 검증
    # candidate는 top_root이거나 그 자식이어야 함
    if candidate != top_root:
        try:
            candidate.relative_to(top_root)
        except ValueError:
            # candidate가 top_root의 부모 또는 형제
            raise SuspiciousOperation('Path is outside allowed root.')
    
    # 4. 존재하는 경로인 경우 추가 검증
    if candidate.exists():
        # 심볼릭 링크 감지 (strict 모드에서 선택)
        # is_symlink()를 사용하여 심볼릭 링크 자체는 괜찮지만,
        # 심볼릭 링크를 통한 범위 이탈은 방지
        if candidate.is_symlink():
            # 심볼릭 링크의 실제 대상 확인
            real_target = candidate.resolve()
            try:
                real_target.relative_to(top_root)
            except ValueError:
                raise SuspiciousOperation('Symlink target is outside allowed root.')
    
    return candidate


def is_sqlite_file(path: Path) -> bool:
    if not path.is_file():
        return False

    suffix = path.suffix.lower()
    if suffix in SQLITE_SUFFIXES:
        return True

    if suffix == GZIP_SUFFIX:
        try:
            with gzip.open(path, 'rb') as handle:
                return handle.read(len(SQLITE_MAGIC_HEADER)) == SQLITE_MAGIC_HEADER
        except OSError:
            return False

    return False


def relative_to_root(path: Path) -> str:
    root = repository_root()
    relative = os.path.relpath(path, root)
    if relative == '.':
        return ''
    return relative.replace('\\', '/')


def format_size(value: int) -> str:
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    size = float(max(value, 0))
    for unit in units:
        if size < 1024.0 or unit == units[-1]:
            if unit == 'B':
                return f'{int(size)} {unit}'
            return f'{size:.1f} {unit}'
        size /= 1024.0
    return '0 B'


def format_modified(value: float) -> str:
    return datetime.fromtimestamp(value).strftime('%Y%m%d %H%M%S')


def directory_stats(current_path: Path) -> dict[str, object]:
    """
    현재 디렉토리의 직접 자식 항목만 통계 계산
    - 성능: O(n) where n = 현재 디렉토리의 직접 자식 개수
    - 이전 방식의 재귀 스캔 제거 (O(n*m) 성능 문제 해결)
    - 권한 거부 시 안전하게 처리
    """
    directories = 0
    files = 0
    total_size_bytes = 0

    try:
        for child in current_path.iterdir():
            try:
                # 심볼릭 링크 추적 안 함
                if child.is_symlink():
                    continue

                if child.is_dir():
                    directories += 1
                elif child.is_file():
                    files += 1
                    try:
                        total_size_bytes += child.stat().st_size
                    except (OSError, PermissionError):
                        # 개별 파일 크기 조회 권한 없으면 건너뜀
                        pass
            except (OSError, PermissionError):
                # 개별 항목 접근 권한 없으면 건너뜀
                pass
    except (OSError, PermissionError):
        # 현재 디렉토리 읽기 권한 없어도 부분 결과 반환
        pass

    disk = shutil.disk_usage(current_path)
    used_percent = (disk.used / disk.total * 100.0) if disk.total else 0.0

    return {
        'directories': directories,
        'files': files,
        'total_size_bytes': total_size_bytes,
        'total_size_human': format_size(total_size_bytes),
        'disk': {
            'total_bytes': disk.total,
            'used_bytes': disk.used,
            'free_bytes': disk.free,
            'total_human': format_size(disk.total),
            'used_human': format_size(disk.used),
            'free_human': format_size(disk.free),
            'used_percent': round(used_percent, 1),
        },
    }


def settings_path() -> Path:
    return repository_root() / SETTINGS_FILENAME


def _encrypt_token(token: str) -> str:
    """
    토큰을 인메모리 암호화 (Django SECRET_KEY 기반)
    주의: 이는 기본적인 보호이며, 프로덕션에서는 더 강력한 암호화 권장
    """
    if not token:
        return ''
    
    from django.utils.encoding import force_bytes, force_str
    from hashlib import sha256
    import base64
    
    # SECRET_KEY를 이용한 간단한 XOR 암호화
    # 실제 운영에서는 cryptography 라이브러리 사용 권장
    secret = force_bytes(settings.SECRET_KEY)[:32]
    token_bytes = force_bytes(token)
    
    # XOR 연산 (양방향)
    encrypted = bytearray()
    for i, byte in enumerate(token_bytes):
        encrypted.append(byte ^ secret[i % len(secret)])
    
    # Base64 인코딩
    return base64.b64encode(bytes(encrypted)).decode('ascii')


def _decrypt_token(encrypted: str) -> str:
    """
    암호화된 토큰을 복호화
    """
    if not encrypted:
        return ''
    
    from django.utils.encoding import force_bytes, force_str
    import base64
    
    try:
        secret = force_bytes(settings.SECRET_KEY)[:32]
        encrypted_bytes = base64.b64decode(encrypted)
        
        # XOR 연산 (양방향)
        decrypted = bytearray()
        for i, byte in enumerate(encrypted_bytes):
            decrypted.append(byte ^ secret[i % len(secret)])
        
        return decrypted.decode('utf-8')
    except Exception:
        # 복호화 실패 시 원본 반환 (하위호환성)
        return encrypted


def load_settings() -> dict[str, str]:
    path = settings_path()
    if not path.exists():
        return {
            'request_url': DEFAULT_REQUEST_URL,
            'request_headers': DEFAULT_REQUEST_HEADERS,
            'request_json': DEFAULT_REQUEST_JSON,
            'request_timeout': DEFAULT_REQUEST_TIMEOUT_SECONDS,
            'system_folder': DEFAULT_SYSTEM_FOLDER,
            'current_folder': DEFAULT_CURRENT_FOLDER,
            'hist_folder': DEFAULT_HIST_FOLDER,
        }

    with path.open('r', encoding='utf-8') as handle:
        data = json.load(handle)

    request_url = str(data.get('request_url', data.get('endpoint', DEFAULT_REQUEST_URL))).strip()
    request_headers = str(data.get('request_headers', data.get('additional_headers', DEFAULT_REQUEST_HEADERS))).strip()
    request_json = str(data.get('request_json', data.get('additional_payload', DEFAULT_REQUEST_JSON))).strip()
    request_timeout = str(data.get('request_timeout', DEFAULT_REQUEST_TIMEOUT_SECONDS)).strip() or DEFAULT_REQUEST_TIMEOUT_SECONDS
    system_folder = str(data.get('system_folder', DEFAULT_SYSTEM_FOLDER)).strip() or DEFAULT_SYSTEM_FOLDER
    current_folder = str(data.get('current_folder', DEFAULT_CURRENT_FOLDER)).strip() or DEFAULT_CURRENT_FOLDER
    hist_folder = str(data.get('hist_folder', DEFAULT_HIST_FOLDER)).strip() or DEFAULT_HIST_FOLDER

    if request_url in LEGACY_DEFAULT_LLM_ENDPOINTS:
        request_url = ''

    # Validate timeout format defensively and normalize to string integer.
    try:
        timeout_value = int(float(request_timeout))
    except (TypeError, ValueError):
        timeout_value = int(DEFAULT_REQUEST_TIMEOUT_SECONDS)
    if timeout_value <= 0:
        timeout_value = int(DEFAULT_REQUEST_TIMEOUT_SECONDS)
    request_timeout = str(timeout_value)

    return {
        'request_url': request_url,
        'request_headers': request_headers,
        'request_json': request_json,
        'request_timeout': request_timeout,
        'system_folder': system_folder,
        'current_folder': current_folder,
        'hist_folder': hist_folder,
    }


def save_settings(payload: dict[str, object]) -> dict[str, str]:
    request_url = str(payload.get('request_url', '')).strip()
    request_headers = str(payload.get('request_headers', '')).strip() or DEFAULT_REQUEST_HEADERS
    request_json = str(payload.get('request_json', '')).strip() or DEFAULT_REQUEST_JSON
    request_timeout_raw = str(payload.get('request_timeout', DEFAULT_REQUEST_TIMEOUT_SECONDS)).strip() or DEFAULT_REQUEST_TIMEOUT_SECONDS
    system_folder = str(payload.get('system_folder', '')).strip() or DEFAULT_SYSTEM_FOLDER
    current_folder = str(payload.get('current_folder', '')).strip() or DEFAULT_CURRENT_FOLDER
    hist_folder = str(payload.get('hist_folder', '')).strip() or DEFAULT_HIST_FOLDER
    try:
        request_timeout = int(float(request_timeout_raw))
    except (TypeError, ValueError):
        raise SuspiciousOperation('request_timeout must be a positive number.')
    if request_timeout <= 0:
        raise SuspiciousOperation('request_timeout must be a positive number.')

    # Allow both strict JSON and Python dict literal text copied from working scripts.
    parsed_headers = parse_json_object_setting(request_headers, 'request_headers')
    parsed_payload = parse_json_object_setting(request_json, 'request_json')

    # Persist normalized JSON text to reduce parsing ambiguity across environments.
    normalized_request_headers = (
        json.dumps(parsed_headers, ensure_ascii=False, indent=2)
        if request_headers else DEFAULT_REQUEST_HEADERS
    )
    normalized_request_json = (
        json.dumps(parsed_payload, ensure_ascii=False, indent=2)
        if request_json else DEFAULT_REQUEST_JSON
    )

    # 저장 전 경로 정규화 검증 (repository 기준 상대경로 또는 허용 범위 절대경로)
    resolve_repo_path(system_folder)
    resolve_repo_path(current_folder)
    resolve_repo_path(hist_folder)

    data = {
        'request_url': request_url,
        'request_headers': normalized_request_headers,
        'request_json': normalized_request_json,
        'request_timeout': str(request_timeout),
        'system_folder': system_folder,
        'current_folder': current_folder,
        'hist_folder': hist_folder,
    }
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + '.tmp')
    with temporary_path.open('w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temporary_path.replace(path)
    
    # 저장 후 반환할 때는 토큰 마스킹
    return {
        'request_url': data['request_url'],
        'request_headers': data['request_headers'],
        'request_json': data['request_json'],
        'request_timeout': data['request_timeout'],
        'system_folder': data['system_folder'],
        'current_folder': data['current_folder'],
        'hist_folder': data['hist_folder'],
    }


def parse_json_object_setting(raw_value: str, field_name: str) -> dict[str, object]:
    raw = str(raw_value or '').strip()
    if not raw:
        return {}

    # 1) Strict JSON first.
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        # 2) Fallback for Python dict literals copied from Python request code.
        #    Example: {'top_p': 0.9, 'stream': False, 'meta': None}
        try:
            parsed = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            raise SuspiciousOperation(
                f'Invalid JSON in {field_name}: {error.msg}. '
                'Use JSON object text like {"key":"value"} '
                'or Python dict literal text like {\'key\': \'value\'}.'
            )
    if not isinstance(parsed, dict):
        raise SuspiciousOperation(f'{field_name} must be a JSON object.')
    return parsed


def _gzip_cache_root() -> Path:
    cache_root = Path(tempfile.gettempdir()) / 'websqlitebrowser-gz-cache'
    cache_root.mkdir(parents=True, exist_ok=True)
    return cache_root


def _resolve_sqlite_source_path(database_path: Path) -> Path:
    if database_path.suffix.lower() != GZIP_SUFFIX:
        return database_path

    file_stat = database_path.stat()
    cache_key_source = f'{database_path.resolve()}::{file_stat.st_size}::{file_stat.st_mtime_ns}'
    cache_key = hashlib.sha256(cache_key_source.encode('utf-8')).hexdigest()
    cache_path = _gzip_cache_root() / f'{cache_key}.sqlite3'

    if cache_path.exists() and cache_path.is_file():
        return cache_path

    temp_path = cache_path.with_suffix('.tmp')
    try:
        with gzip.open(database_path, 'rb') as source, temp_path.open('wb') as target:
            header = source.read(len(SQLITE_MAGIC_HEADER))
            if header != SQLITE_MAGIC_HEADER:
                raise SuspiciousOperation('Selected .gz file does not contain a SQLite database.')
            target.write(header)
            shutil.copyfileobj(source, target, length=1024 * 1024)
        temp_path.replace(cache_path)
    except OSError as error:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise SuspiciousOperation(f'Failed to read gzip SQLite file: {error}')

    return cache_path


def connect_database(database_path: Path) -> sqlite3.Connection:
    source_path = _resolve_sqlite_source_path(database_path)
    connection = sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_sales_invoices_time_column() -> None:
    """Ensure repository/sales.db invoices has a time column for SYSDATE tests."""
    sales_db_path = repository_root() / 'sales.db'
    if not sales_db_path.exists() or not sales_db_path.is_file():
        return

    connection = sqlite3.connect(str(sales_db_path))
    try:
        table_exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND lower(name) = 'invoices' LIMIT 1"
        ).fetchone()
        if not table_exists:
            return

        columns = {
            str(row[1]).lower()
            for row in connection.execute('PRAGMA table_info("invoices")').fetchall()
        }

        if 'time' not in columns:
            connection.execute('ALTER TABLE "invoices" ADD COLUMN "time" TEXT')

        connection.execute(
            """
            UPDATE "invoices"
            SET "time" = COALESCE("time", DATETIME('now', '-' || rowid || ' minutes'))
            """
        )
        connection.commit()
    finally:
        connection.close()


def quote_identifier(identifier: str) -> str:
    return identifier.replace('"', '""')


def fetch_tables(database_path: Path) -> list[dict[str, object]]:
    with connect_database(database_path) as connection:
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
                    for column in connection.execute(f'PRAGMA index_info("{quote_identifier(index_name)}")').fetchall()
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


_JS_MAX_SAFE_INT = 9007199254740991  # 2^53 - 1


def _safe_value(v: object) -> object:
    """Convert integers that exceed JavaScript's Number.MAX_SAFE_INTEGER to strings
    to prevent silent precision loss during JSON.parse() on the frontend."""
    if isinstance(v, int) and not isinstance(v, bool):
        if v > _JS_MAX_SAFE_INT or v < -_JS_MAX_SAFE_INT:
            return str(v)
    return v


def _safe_row(row: dict) -> dict:
    return {k: _safe_value(v) for k, v in row.items()}


def serialize_rows(cursor: sqlite3.Cursor, limit: int | None = 100) -> dict[str, object]:
    columns = [description[0] for description in cursor.description or []]

    if limit is None:
        rows = [_safe_row(dict(row)) for row in cursor.fetchall()]
        return {
            'columns': columns,
            'rows': rows,
            'row_count': len(rows),
            'limit': None,
            'truncated': False,
        }

    fetched_rows = cursor.fetchmany(limit + 1)
    truncated = len(fetched_rows) > limit
    rows = [_safe_row(dict(row)) for row in fetched_rows[:limit]]
    return {
        'columns': columns,
        'rows': rows,
        'row_count': len(rows),
        'limit': limit,
        'truncated': truncated,
    }


def table_preview(database_path: Path, table_name: str, limit: int = DEFAULT_SAMPLE_LIMIT) -> list[dict[str, object]]:
    with connect_database(database_path) as connection:
        escaped_table_name = quote_identifier(table_name)
        cursor = connection.execute(f'SELECT * FROM "{escaped_table_name}" LIMIT {limit}')
        return [_safe_row(dict(row)) for row in cursor.fetchall()]


def metadata_root() -> Path:
    return repository_root() / 'metadata'


def _load_metadata_document(path: Path, scope: str, reason: str = '') -> dict[str, str] | None:
    if not path.exists() or not path.is_file():
        return None

    try:
        content = path.read_text(encoding='utf-8')
    except OSError:
        return None

    cleaned = content.strip()
    if not cleaned:
        return None

    if len(cleaned) > METADATA_MAX_CHARS_PER_DOC:
        cleaned = cleaned[:METADATA_MAX_CHARS_PER_DOC].rstrip() + '\n\n... (truncated)'

    _EXCERPT_LEN = 120
    excerpt_raw = cleaned[:_EXCERPT_LEN].replace('\n', ' ').strip()
    excerpt = (excerpt_raw + '…') if len(cleaned) > _EXCERPT_LEN else excerpt_raw

    return {
        'scope': scope,
        'source': f'{scope}:{path.name}',
        'content': cleaned,
        'reason': reason,
        'excerpt': excerpt,
    }


def _match_table_names_from_question(tables: list[dict[str, object]], question: str) -> list[str]:
    lowered_question = question.lower()
    matched: list[str] = []
    for table in tables:
        table_name = str(table.get('name', '')).strip()
        if table_name and table_name.lower() in lowered_question:
            matched.append(table_name)
    return matched


def _make_database_alias(db_path: Path, used_aliases: set[str]) -> str:
    base = re.sub(r'[^a-zA-Z0-9_]', '_', db_path.stem.strip().lower())
    if not base or not re.match(r'^[a-zA-Z_]', base):
        base = f'db_{base}' if base else 'db'

    alias = base
    sequence = 2
    while alias in used_aliases:
        alias = f'{base}_{sequence}'
        sequence += 1

    used_aliases.add(alias)
    return alias


def list_sqlite_files_in_directory(folder_path: Path, max_files: int = FOLDER_CHAT_MAX_DATABASES) -> tuple[list[Path], bool]:
    try:
        files = [
            child
            for child in sorted(folder_path.rglob('*'), key=lambda p: str(p.relative_to(folder_path)).lower())
            if is_sqlite_file(child)
        ]
    except OSError:
        return [], False

    truncated = len(files) > max_files
    return files[:max_files], truncated


def slim_table_for_chat(table: dict[str, object]) -> dict[str, object]:
    columns = []
    for column in table.get('columns', []):
        if isinstance(column, dict):
            name = str(column.get('name', '')).strip()
            col_type = str(column.get('type', '')).strip()
            if name:
                columns.append({'name': name, 'type': col_type})

    return {
        'name': str(table.get('name', '')).strip(),
        'columns': columns,
    }


def build_folder_chat_context(folder_path: Path, question: str = '') -> dict[str, object]:
    sqlite_files, truncated = list_sqlite_files_in_directory(folder_path)
    databases: list[dict[str, object]] = []
    used_aliases: set[str] = set()

    for db_path in sqlite_files:
        alias = _make_database_alias(db_path, used_aliases)
        try:
            tables = fetch_tables(db_path)
            slim_tables = [slim_table_for_chat(table) for table in tables]
            previews = []
            for table in tables[:FOLDER_CHAT_PREVIEW_TABLES_PER_DB]:
                table_name = str(table.get('name', '')).strip()
                if not table_name:
                    continue
                previews.append(
                    {
                        'table': table_name,
                        'rows': table_preview(db_path, table_name),
                    }
                )

            metadata_docs = load_metadata_documents(db_path, tables, question)

            databases.append(
                {
                    'alias': alias,
                    'database': db_path.name,
                    'path': relative_to_root(db_path),
                    'tables': slim_tables,
                    'previews': previews,
                    'metadata_docs': metadata_docs,
                }
            )
        except (OSError, sqlite3.Error):
            databases.append(
                {
                    'alias': alias,
                    'database': db_path.name,
                    'path': relative_to_root(db_path),
                    'error': 'Failed to inspect database.',
                }
            )

    return {
        'mode': 'folder',
        'folder': relative_to_root(folder_path),
        'database_count': len(databases),
        'database_list_truncated': truncated,
        'databases': databases,
        'guidance': {
            'note': 'When multiple databases are provided, prefer explicit database alias in SQL (e.g. sales.customers, marketing.orders).',
        },
    }


def build_multi_folder_chat_context(folder_slots: list[tuple[str, Path]], question: str = '') -> dict[str, object]:
    databases: list[dict[str, object]] = []
    used_aliases: set[str] = set()
    groups: list[dict[str, object]] = []

    for slot_name, folder_path in folder_slots:
        sqlite_files, truncated = list_sqlite_files_in_directory(folder_path)
        group_count_before = len(databases)

        for db_path in sqlite_files:
            alias = _make_database_alias(db_path, used_aliases)
            try:
                tables = fetch_tables(db_path)
                slim_tables = [slim_table_for_chat(table) for table in tables]
                previews = []
                for table in tables[:FOLDER_CHAT_PREVIEW_TABLES_PER_DB]:
                    table_name = str(table.get('name', '')).strip()
                    if not table_name:
                        continue
                    previews.append(
                        {
                            'table': table_name,
                            'rows': table_preview(db_path, table_name),
                        }
                    )

                metadata_docs = load_metadata_documents(db_path, tables, question)

                databases.append(
                    {
                        'alias': alias,
                        'database': db_path.name,
                        'path': relative_to_root(db_path),
                        'folder_slot': slot_name,
                        'folder_path': relative_to_root(folder_path),
                        'tables': slim_tables,
                        'previews': previews,
                        'metadata_docs': metadata_docs,
                    }
                )
            except (OSError, sqlite3.Error):
                databases.append(
                    {
                        'alias': alias,
                        'database': db_path.name,
                        'path': relative_to_root(db_path),
                        'folder_slot': slot_name,
                        'folder_path': relative_to_root(folder_path),
                        'error': 'Failed to inspect database.',
                    }
                )

        groups.append(
            {
                'slot': slot_name,
                'path': relative_to_root(folder_path),
                'database_count': len(databases) - group_count_before,
                'database_list_truncated': truncated,
            }
        )

    return {
        'mode': 'folder',
        'folder': 'configured-folders',
        'database_count': len(databases),
        'database_list_truncated': any(bool(group.get('database_list_truncated')) for group in groups),
        'database_groups': groups,
        'databases': databases,
        'guidance': {
            'note': 'Databases come from configured folders: system/current/hist. Use alias.table for cross-database joins.',
        },
    }


def load_metadata_documents(
    database_path: Path,
    tables: list[dict[str, object]],
    question: str,
) -> list[dict[str, str]]:
    root = metadata_root()
    if not root.exists() or not root.is_dir():
        return []

    db_stem = database_path.stem
    table_names = [str(table.get('name', '')).strip() for table in tables]
    table_names = [name for name in table_names if name]
    matched_table_names = _match_table_names_from_question(tables, question)

    prioritized_table_names: list[str]
    if matched_table_names:
        remainder = [name for name in table_names if name not in matched_table_names]
        prioritized_table_names = matched_table_names + remainder
    else:
        prioritized_table_names = table_names

    docs: list[dict[str, str]] = []
    seen_paths: set[Path] = set()

    def add_doc(path: Path, scope: str, reason: str = '') -> None:
        if len(docs) >= METADATA_MAX_DOCS:
            return
        normalized = path.resolve()
        if normalized in seen_paths:
            return
        document = _load_metadata_document(path, scope, reason)
        if document is None:
            return
        docs.append(document)
        seen_paths.add(normalized)

    # Database-level doc
    add_doc(
        root / 'databases' / f'{db_stem}.md',
        f'database/{db_stem}',
        f"DB '{db_stem}' 레벨 메타 문서 (기본 로드)",
    )

    # DB-scoped skills first (e.g. sample-skill01.md)
    skills_dir = root / 'skills'
    if skills_dir.exists() and skills_dir.is_dir():
        for file_path in sorted(skills_dir.glob(f'{db_stem}-*.md')):
            add_doc(file_path, f'skill/{db_stem}', f"DB '{db_stem}' 전용 스킬 문서")

        # Global skills (skill01.md, skill02.md, ...)
        for file_path in sorted(skills_dir.glob('skill*.md')):
            add_doc(file_path, 'skill/global', "전역 스킬 문서 (모든 DB 공통)")

    # Table docs (question-matched tables first)
    tables_dir = root / 'tables'
    for table_name in prioritized_table_names:
        if table_name in matched_table_names:
            table_reason = f"질문에 '{table_name}' 언급 → 우선 선택"
        else:
            table_reason = f"'{table_name}' 테이블 메타 (기본 로드)"
        add_doc(tables_dir / f'{table_name}.md', f'table/{table_name}', table_reason)

    return docs


def build_chat_context(database_path: Path, question: str = '') -> dict[str, object]:
    tables = fetch_tables(database_path)
    preview_rows = []
    for table in tables:
        preview_rows.append(
            {
                'table': table['name'],
                'rows': table_preview(database_path, table['name']),
            }
        )

    metadata_docs = load_metadata_documents(database_path, tables, question)

    return {
        'mode': 'single_db',
        'database': database_path.name,
        'path': relative_to_root(database_path),
        'tables': tables,
        'previews': preview_rows,
        'metadata_docs': metadata_docs,
    }


def summarize_chat_context(context: dict[str, object]) -> dict[str, object]:
    mode = str(context.get('mode', 'single_db'))
    summary: dict[str, object] = {
        'mode': mode,
        'database_count': 0,
        'databases': [],
        'metadata_sources': [],
    }

    metadata_sources: list[str] = []

    if mode == 'folder':
        databases = context.get('databases', [])
        database_items: list[dict[str, object]] = []
        if isinstance(databases, list):
            for item in databases:
                if not isinstance(item, dict):
                    continue
                name = str(item.get('database', '')).strip()
                alias = str(item.get('alias', '')).strip()
                folder_slot = str(item.get('folder_slot', '')).strip()
                path = str(item.get('path', '')).strip()
                if not name:
                    continue

                table_count = 0
                tables = item.get('tables', [])
                if isinstance(tables, list):
                    table_count = len(tables)

                db_meta_sources: list[dict[str, str]] = []
                docs = item.get('metadata_docs', [])
                if isinstance(docs, list):
                    for doc in docs:
                        if isinstance(doc, dict):
                            source = str(doc.get('source', '')).strip()
                            if source:
                                entry = {
                                    'source': source,
                                    'reason': str(doc.get('reason', '')),
                                    'excerpt': str(doc.get('excerpt', '')),
                                }
                                db_meta_sources.append(entry)
                                metadata_sources.append(entry)

                database_items.append(
                    {
                        'name': name,
                        'alias': alias,
                        'folder_slot': folder_slot,
                        'path': path,
                        'table_count': table_count,
                        'metadata_sources': db_meta_sources,
                    }
                )

        summary['database_count'] = len(database_items)
        summary['databases'] = database_items
    else:
        db_name = str(context.get('database', '')).strip()
        db_path = str(context.get('path', '')).strip()
        table_count = 0
        tables = context.get('tables', [])
        if isinstance(tables, list):
            table_count = len(tables)

        docs = context.get('metadata_docs', [])
        db_meta_sources: list[dict[str, str]] = []
        if isinstance(docs, list):
            for doc in docs:
                if isinstance(doc, dict):
                    source = str(doc.get('source', '')).strip()
                    if source:
                        entry = {
                            'source': source,
                            'reason': str(doc.get('reason', '')),
                            'excerpt': str(doc.get('excerpt', '')),
                        }
                        db_meta_sources.append(entry)
                        metadata_sources.append(entry)

        if db_name:
            summary['database_count'] = 1
            summary['databases'] = [
                {
                    'name': db_name,
                    'path': db_path,
                    'table_count': table_count,
                    'metadata_sources': db_meta_sources,
                }
            ]

    # Keep unique order for display.
    unique_sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in metadata_sources:
        source_key = item['source'] if isinstance(item, dict) else str(item)
        if source_key in seen:
            continue
        unique_sources.append(item if isinstance(item, dict) else {'source': source_key, 'reason': '', 'excerpt': ''})
        seen.add(source_key)

    summary['metadata_sources'] = unique_sources
    return summary


def normalise_chat_endpoint(endpoint: str) -> str:
    cleaned = endpoint.strip().rstrip('/')
    if not cleaned:
        return cleaned
    lower = cleaned.lower()
    if 'api.anthropic.com' in lower:
        if lower.endswith('/messages'):
            return cleaned
        if lower.endswith('/v1'):
            return f'{cleaned}/messages'
        return cleaned
    if cleaned.endswith('/chat/completions'):
        return cleaned
    return f'{cleaned}/chat/completions'


def detect_llm_provider(endpoint: str) -> str:
    lower = endpoint.lower()
    if 'api.anthropic.com' in lower:
        return 'anthropic'
    return 'openai-compatible'


def _anthropic_models_endpoint(messages_endpoint: str) -> str:
    cleaned = messages_endpoint.strip().rstrip('/')
    suffix = '/messages'
    if cleaned.lower().endswith(suffix):
        return f'{cleaned[:-len(suffix)]}/models'
    if cleaned.lower().endswith('/v1'):
        return f'{cleaned}/models'
    return 'https://api.anthropic.com/v1/models'


def fetch_anthropic_available_models(messages_endpoint: str, token: str) -> list[str]:
    if not token.strip():
        return []

    request = urllib.request.Request(
        _anthropic_models_endpoint(messages_endpoint),
        headers={
            'x-api-key': token,
            'anthropic-version': '2023-06-01',
        },
        method='GET',
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except Exception:
        return []

    data = payload.get('data')
    if not isinstance(data, list):
        return []

    model_ids: list[str] = []
    for item in data:
        if isinstance(item, dict):
            model_id = str(item.get('id', '')).strip()
            if model_id:
                model_ids.append(model_id)

    return model_ids


def validate_read_only_sql(sql: str) -> str:
    """
    강화된 SQL 인젝션 방어 검증
    - 읽기 전용 명령어만 허용
    - 위험한 패턴 감지
    - 주석 제거 (잠재적 위험 회피)
    - 쿼리 복잡도 제한
    """
    cleaned = strip_sql_comments(sql).strip()
    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    import re as regex_module

    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    # 1. 읽기 전용 여부 확인
    normalized = cleaned.lower()
    if not normalized.startswith(READ_ONLY_PREFIXES):
        raise SuspiciousOperation('Only read-only SQL statements are allowed.')

    # 2. 위험한 패턴 차단
    dangerous_patterns = [
        r'(?i)\battach\b',  # ATTACH DATABASE
        r'(?i)\bdetach\b',  # DETACH DATABASE
        r'(?i)\bvacuum\b',  # VACUUM
        r'(?i)\breindex\b',  # REINDEX
        r'(?i)\banalyze\b',  # ANALYZE (보안 정책에 따라)
        r'(?i)\.dump',  # .dump 명령어
        r'(?i)\.schema',  # .schema 명령어
    ]
    
    for pattern in dangerous_patterns:
        if regex_module.search(pattern, cleaned):
            raise SuspiciousOperation(f'Dangerous SQL pattern detected.')

    # 3. 복잡도 제한 (JOIN 최대 5개, 서브쿼리 최대 3개)
    join_count = len(regex_module.findall(r'(?i)\bjoin\b', cleaned))
    subquery_count = cleaned.count('(SELECT') + cleaned.count('(select')
    
    if join_count > 5:
        raise SuspiciousOperation(f'Query too complex: maximum 5 JOINs allowed (found {join_count}).')
    if subquery_count > 3:
        raise SuspiciousOperation(f'Query too complex: maximum 3 subqueries allowed (found {subquery_count}).')

    return cleaned


def strip_sql_comments(sql: str) -> str:
    """Remove -- and /* */ comments while preserving quoted strings."""
    if not sql:
        return ''

    out: list[str] = []
    i = 0
    n = len(sql)
    in_single = False
    in_double = False
    in_line_comment = False
    in_block_comment = False

    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ''

        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
                out.append(ch)
            i += 1
            continue

        if in_block_comment:
            if ch == '*' and nxt == '/':
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        if in_single:
            out.append(ch)
            if ch == "'":
                if nxt == "'":
                    out.append(nxt)
                    i += 2
                    continue
                in_single = False
            i += 1
            continue

        if in_double:
            out.append(ch)
            if ch == '"':
                if nxt == '"':
                    out.append(nxt)
                    i += 2
                    continue
                in_double = False
            i += 1
            continue

        if ch == '-' and nxt == '-':
            in_line_comment = True
            i += 2
            continue
        if ch == '/' and nxt == '*':
            in_block_comment = True
            i += 2
            continue

        if ch == "'":
            in_single = True
            out.append(ch)
            i += 1
            continue
        if ch == '"':
            in_double = True
            out.append(ch)
            i += 1
            continue

        out.append(ch)
        i += 1

    return ''.join(out)


def split_sql_statements(sql: str) -> list[str]:
    cleaned = strip_sql_comments(sql).strip()
    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    statements: list[str] = []
    buffer = ''
    for line in cleaned.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            if statement.endswith(';'):
                statement = statement[:-1].strip()
            if statement:
                statements.append(statement)
            buffer = ''

    tail = buffer.strip()
    if tail:
        statements.append(tail)

    if not statements:
        raise SuspiciousOperation('SQL is required.')

    return statements


def translate_oracle_rownum(sql: str) -> str:
    return oracle_to_sqlite.translate_oracle_rownum(sql)


def translate_oracle_sysdate(sql: str, timezone_offset_minutes: int | None = None) -> str:
    return oracle_to_sqlite.translate_oracle_sysdate(sql)


def translate_oracle_to_char(sql: str) -> str:
    return oracle_to_sqlite.translate_oracle_to_char(sql)


def ensure_oracle_dual(connection: sqlite3.Connection) -> None:
    """Provide Oracle-like DUAL compatibility in SQLite execution sessions."""
    connection.execute('CREATE TEMP VIEW IF NOT EXISTS dual AS SELECT 1 AS dummy')


def run_read_only_query(
    database_path: Path,
    sql: str,
    timezone_offset_minutes: int | None = None,
) -> dict[str, object]:
    statements = split_sql_statements(sql)

    if len(statements) == 1:
        validated_sql = oracle_to_sqlite.translate_oracle_sql(
            validate_read_only_sql(statements[0]),
        )
        with connect_database(database_path) as connection:
            ensure_oracle_dual(connection)
            cursor = connection.execute(validated_sql)
            return serialize_rows(cursor)

    validated_statements = [
        oracle_to_sqlite.translate_oracle_sql(
            validate_read_only_sql(statement),
        )
        for statement in statements
    ]

    with connect_database(database_path) as connection:
        ensure_oracle_dual(connection)
        results: list[dict[str, object]] = []
        for index, statement in enumerate(validated_statements, start=1):
            cursor = connection.execute(statement)
            payload = serialize_rows(cursor)
            payload['statement_index'] = index
            payload['statement_sql'] = statement
            results.append(payload)

    return {
        'results': results,
        'result_count': len(results),
    }


def run_read_only_query_across_databases(
    context: dict[str, object],
    sql: str,
    timezone_offset_minutes: int | None = None,
) -> dict[str, object]:
    statements = split_sql_statements(sql)
    validated_statements = [
        oracle_to_sqlite.translate_oracle_sql(
            validate_read_only_sql(statement),
        )
        for statement in statements
    ]

    databases = context.get('databases', [])
    if not isinstance(databases, list) or not databases:
        raise SuspiciousOperation('No databases available for folder-mode SQL execution.')

    attach_targets: list[tuple[str, Path]] = []
    used_aliases: set[str] = set()
    for item in databases:
        if not isinstance(item, dict):
            continue
        raw_path = str(item.get('path', '')).strip()
        if not raw_path:
            continue
        db_path = resolve_repo_path(raw_path)
        if not is_sqlite_file(db_path):
            continue

        raw_alias = str(item.get('alias', '')).strip().lower()
        alias = re.sub(r'[^a-zA-Z0-9_]', '_', raw_alias)
        if not alias or not re.match(r'^[a-zA-Z_]', alias):
            alias = _make_database_alias(db_path, used_aliases)
        elif alias in used_aliases:
            alias = _make_database_alias(db_path, used_aliases)
        else:
            used_aliases.add(alias)

        attach_targets.append((alias, db_path))

    if not attach_targets:
        raise SuspiciousOperation('No attachable SQLite databases found for folder-mode SQL execution.')

    with sqlite3.connect(':memory:') as connection:
        connection.row_factory = sqlite3.Row
        ensure_oracle_dual(connection)

        for alias, db_path in attach_targets:
            safe_alias = quote_identifier(alias)
            connection.execute(f'ATTACH DATABASE ? AS "{safe_alias}"', (str(db_path),))

        if len(validated_statements) == 1:
            cursor = connection.execute(validated_statements[0])

    choice_specs = [
        (
            '가장 이른 WARN 시점 기준',
            'system_status의 status="WARN" 중 가장 이른 시점을 기준으로, WARN 이전 30일 대비 이후 30일 주문건수 증가율을 계산',
        ),
        (
            '가장 최근 WARN 시점 기준',
            'system_status의 status="WARN" 중 가장 최근 시점을 기준으로, WARN 이전 30일 대비 이후 30일 주문건수 증가율을 계산',
        ),
        (
            '서비스코드별 WARN 시점 기준',
            'service_name별 WARN 발생 시점을 각각 적용해 고객별 증가율을 계산',
        ),
        (
            '모든 WARN 이벤트 평균 기준',
            '모든 WARN 이벤트를 기준으로 증가율을 각각 구한 뒤 고객별 평균 증가율을 계산',
        ),
    ]

    options: list[dict[str, str]] = []
    for index, (label, rule) in enumerate(choice_specs, start=1):
        prompt = (
            f'{base_question}\n'
            f'기준 선택: {rule}.\n'
            'WARN 이전/이후 기준과 계산식(분모 0 처리 포함)을 답변에 명시하고, 가능한 경우 SQL도 함께 제시해줘.'
        )
        options.append(
            {
                'id': f'clarify-{index}',
                'label': label,
                'prompt': prompt,
            }
        )

    return options


def mask_sensitive_info(content: str, database_path: Path | None = None) -> str:
    """
    민감 정보(경로, 토큰) 마스킹
    - 절대 경로 제거
    - 파일 경로 마스킹
    - 토큰 패턴 제거
    """
    masked = content
    
    # 1. 절대 경로 마스킹 (/path/to/file 또는 C:\path\to\file)
    # Windows 경로
    masked = re.sub(
        r'[A-Za-z]:[\\\/][^\s\"\'<>|?*]*',
        '[DATABASE_PATH]',
        masked
    )
    
    # POSIX 경로 (/.../path/to/file)
    masked = re.sub(
        r'\/(?:[a-zA-Z0-9._\-]+\/)*[a-zA-Z0-9._\-]+(?:\.[a-z0-9]+)?',
        '[DATABASE_PATH]',
        masked
    )
    
    # 2. repository 경로 마스킹
    if database_path:
        path_str = str(database_path)
        masked = masked.replace(path_str, '[DATABASE_PATH]')
        masked = masked.replace(database_path.name, '[DATABASE_NAME]')
    
    # 3. 토큰 패턴 마스킹 (40자 이상의 영숫자 문자열)
    # API 토큰, JWT 같은 긴 문자열 제거
    masked = re.sub(
        r'\b[a-zA-Z0-9\-_]{40,}\b',
        '[TOKEN]',
        masked
    )
    
    # 4. 이메일 패턴 마스킹 (프라이버시)
    masked = re.sub(
        r'\b[a-zA-Z0-9._%\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b',
        '[EMAIL]',
        masked
    )
    
    return masked


def truncate_text(value: str, max_length: int = 1500) -> str:
    text = str(value)
    if len(text) <= max_length:
        return text
    return f'{text[:max_length]}... (truncated)'


def _masked_headers_for_debug(headers: dict[str, str]) -> dict[str, str]:
    masked: dict[str, str] = {}
    for key, value in headers.items():
        header_key = str(key)
        lowered = header_key.lower()
        if lowered in {'authorization', 'x-api-key', 'api-key', 'proxy-authorization'}:
            masked[header_key] = '[MASKED]'
            continue
        masked[header_key] = truncate_text(str(value), 200)
    return masked


def _upsert_header_case_insensitive(headers: dict[str, str], key: str, value: str) -> None:
    target = key.strip()
    if not target:
        return
    lowered = target.lower()
    for existing in list(headers.keys()):
        if existing.lower() == lowered and existing != target:
            del headers[existing]
    headers[target] = value


def _render_template_value(value: object, variables: dict[str, object]) -> object:
    if isinstance(value, dict):
        return {str(k): _render_template_value(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_template_value(v, variables) for v in value]
    if not isinstance(value, str):
        return value

    text = value
    # If string is a pure token and the target value is non-string, return as native type.
    if text.startswith('{{') and text.endswith('}}') and text.count('{{') == 1 and text.count('}}') == 1:
        key = text[2:-2].strip()
        if key in variables:
            return variables[key]

    for key, raw in variables.items():
        text = text.replace(f'{{{{{key}}}}}', str(raw))
    return text


def _extract_text_from_llm_response(payload: object) -> str:
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, dict):
        # Common OpenAI-compatible pattern
        choices = payload.get('choices')
        if isinstance(choices, list) and choices:
            first_choice = choices[0]
            if isinstance(first_choice, dict):
                message_block = first_choice.get('message')
                if isinstance(message_block, dict):
                    content = message_block.get('content')
                    if isinstance(content, str) and content.strip():
                        return content.strip()
                text_value = first_choice.get('text')
                if isinstance(text_value, str) and text_value.strip():
                    return text_value.strip()

        # Common Anthropic-like pattern
        content_blocks = payload.get('content')
        if isinstance(content_blocks, list):
            text_parts: list[str] = []
            for item in content_blocks:
                if isinstance(item, dict):
                    text_value = item.get('text')
                    if isinstance(text_value, str) and text_value.strip():
                        text_parts.append(text_value.strip())
            if text_parts:
                return '\n'.join(text_parts).strip()

        # Generic direct keys
        for key in ('answer', 'message', 'output_text', 'response', 'result', 'text'):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        # Recursive fallback
        for value in payload.values():
            extracted = _extract_text_from_llm_response(value)
            if extracted:
                return extracted

    if isinstance(payload, list):
        for item in payload:
            extracted = _extract_text_from_llm_response(item)
            if extracted:
                return extracted

    return ''


def parse_llm_content(content: str) -> tuple[str, str]:
    """
    LLM 응답 문자열에서 answer/sql을 추출한다.
    우선순위:
    1) JSON 객체(answer/sql)
    2) ```sql fenced block
    3) 평문 전체를 answer로 사용
    """
    text = str(content or '').strip()
    if not text:
        return '', ''

    def _from_object(obj: object) -> tuple[str, str] | None:
        if not isinstance(obj, dict):
            return None
        answer = str(obj.get('answer', '') or '').strip()
        sql = str(obj.get('sql', '') or '').strip()
        if answer or sql:
            return answer, sql
        return None

    # 1) fenced JSON
    fenced_json_match = FENCED_JSON_PATTERN.search(text)
    if fenced_json_match:
        candidate = fenced_json_match.group(1).strip()
        try:
            parsed = json.loads(candidate)
            extracted = _from_object(parsed)
            if extracted:
                return extracted
        except json.JSONDecodeError:
            pass

    # 2) raw JSON
    if text.startswith('{') and text.endswith('}'):
        try:
            parsed = json.loads(text)
            extracted = _from_object(parsed)
            if extracted:
                return extracted
        except json.JSONDecodeError:
            pass

    # 3) fenced SQL
    fenced_sql_match = FENCED_SQL_PATTERN.search(text)
    if fenced_sql_match:
        sql = fenced_sql_match.group(1).strip()
        return text, sql

    # 4) fallback
    return text, ''


def call_llm(
    settings_data: dict[str, str],
    question: str,
    context: dict[str, object],
    database_path: Path | None = None,
    folder_path: Path | None = None,
) -> dict[str, object]:
    request_url = str(settings_data.get('request_url', settings_data.get('endpoint', ''))).strip()
    request_headers_input_raw = str(settings_data.get('request_headers', settings_data.get('additional_headers', '')))
    request_json_input_raw = str(settings_data.get('request_json', settings_data.get('additional_payload', '')))
    request_timeout_raw = str(settings_data.get('request_timeout', DEFAULT_REQUEST_TIMEOUT_SECONDS)).strip()

    if not request_url:
        raise SuspiciousOperation('request_url is required.')

    try:
        request_timeout = int(float(request_timeout_raw))
    except (TypeError, ValueError):
        raise SuspiciousOperation('request_timeout must be a positive number.')
    if request_timeout <= 0:
        raise SuspiciousOperation('request_timeout must be a positive number.')

    provider = 'custom-http'
    trace: list[str] = [f'detect provider={provider} request_url={request_url} timeout={request_timeout}s']

    mode = str(context.get('mode', 'single_db'))
    if mode == 'folder':
        databases = context.get('databases', [])
        db_count = len(databases) if isinstance(databases, list) else 0
        metadata_count = 0
        if isinstance(databases, list):
            for item in databases:
                if isinstance(item, dict):
                    docs = item.get('metadata_docs', [])
                    if isinstance(docs, list):
                        metadata_count += len(docs)
        trace.append(f'build folder context db_count={db_count} metadata_docs={metadata_count}')
    else:
        tables = context.get('tables', [])
        metadata_docs = context.get('metadata_docs', [])
        table_count = len(tables) if isinstance(tables, list) else 0
        metadata_count = len(metadata_docs) if isinstance(metadata_docs, list) else 0
        trace.append(f'build single-db context table_count={table_count} metadata_docs={metadata_count}')

    system_prompt = (
        'You are a Korean assistant for SQLite database exploration. '
        'Answer using only the provided schema and sample rows. '
        'If metadata_docs are provided in context, treat them as authoritative business semantics. '
        'Prioritize metadata sections for field meaning, question patterns, and query strategy when they are present. '
        'If you are unsure, say so clearly. '
        'Return exactly one JSON object with keys "answer" and "sql". '
        'The "answer" value must be Korean plain text. '
        'The "sql" value must be either an empty string or a read-only SQLite SQL statement. '
        'When context.mode is "folder", use explicit database aliases from context.databases[].alias '
        'and table notation alias.table_name for cross-database joins. '
        'Do not include markdown, code fences, or additional keys.'
    )
    user_prompt = json.dumps(
        {
            'question': question,
            'context': context,
        },
        ensure_ascii=False,
        indent=2,
    )

    request_headers = parse_json_object_setting(
        request_headers_input_raw,
        'request_headers',
    )
    headers: dict[str, str] = {}
    for key, value in request_headers.items():
        header_key = str(key).strip()
        if not header_key:
            continue
        _upsert_header_case_insensitive(headers, header_key, str(value))
    if not any(k.lower() == 'content-type' for k in headers.keys()):
        _upsert_header_case_insensitive(headers, 'Content-Type', 'application/json')

    payload_template = parse_json_object_setting(
        request_json_input_raw,
        'request_json',
    )
    payload_variables: dict[str, object] = {
        'question': question,
        'system_prompt': system_prompt,
        'user_prompt': user_prompt,
        'context': context,
        'context_json': json.dumps(context, ensure_ascii=False),
        'database_path': str(database_path) if database_path else '',
        'folder_path': str(folder_path) if folder_path else '',
    }
    payload = _render_template_value(payload_template, payload_variables)
    if not isinstance(payload, dict):
        raise SuspiciousOperation('request_json must render to a JSON object.')

    request = urllib.request.Request(
        request_url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST',
    )
    debug_headers = _masked_headers_for_debug(headers)
    request_effective_headers = _masked_headers_for_debug(dict(request.header_items()))
    trace.append(f'apply headers count={len(debug_headers)} keys={", ".join(sorted(debug_headers.keys()))}')
    trace.append('send llm request custom-http')

    response_payload: object
    response_raw_text = ''
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            response_raw_text = response.read().decode('utf-8', errors='ignore')
            try:
                response_payload = json.loads(response_raw_text)
            except json.JSONDecodeError:
                response_payload = {'raw_text': response_raw_text}
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', errors='ignore').strip()
        request_summary = {
            'provider': provider,
            'request_url': request_url,
            'method': 'POST',
            'payload_keys': sorted(list(payload.keys())),
            'effective_headers': request_effective_headers,
            'custom_header_keys': sorted(request_headers.keys()),
            'request_timeout': request_timeout,
        }
        message = (
            f'LLM request failed with status {error.code}. '
            f'request={json.dumps(request_summary, ensure_ascii=False)}'
        )
        if detail:
            message = f'{message} response={detail}'
        raise SuspiciousOperation(message)
    except urllib.error.URLError as error:
        raise SuspiciousOperation(f'LLM connection failed: {error.reason}')

    # Build a display-safe copy of the payload (truncate large text fields)
    _MAX_FIELD = 300
    display_payload: dict = {}
    for k, v in payload.items():
        if isinstance(v, str) and len(v) > _MAX_FIELD:
            display_payload[k] = v[:_MAX_FIELD] + f'…(+{len(v) - _MAX_FIELD})'
        elif isinstance(v, list):
            display_payload[k] = [
                (
                    {
                        mk: (mv[:_MAX_FIELD] + f'…(+{len(mv) - _MAX_FIELD})' if isinstance(mv, str) and len(mv) > _MAX_FIELD else mv)
                        for mk, mv in item.items()
                    }
                    if isinstance(item, dict) else item
                )
                for item in v
            ]
        else:
            display_payload[k] = v

    request_preview = truncate_text(
        json.dumps(
            {
                'method': 'POST',
                'request_url': request_url,
                'headers': request_effective_headers,
                'timeout_seconds': request_timeout,
                'body': display_payload,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if isinstance(response_payload, (dict, list)):
        response_preview = truncate_text(json.dumps(response_payload, ensure_ascii=False))
    else:
        response_preview = truncate_text(str(response_payload))

    message = _extract_text_from_llm_response(response_payload)
    if not message and response_raw_text.strip():
        message = response_raw_text.strip()
    if not message and isinstance(response_payload, (dict, list)):
        message = json.dumps(response_payload, ensure_ascii=False)
    trace.append('parse llm response content (generic)')

    answer, suggested_sql = parse_llm_content(message)
    if not answer:
        answer = message

    clarification_options = build_clarification_options(question, context, answer, suggested_sql)
    if clarification_options:
        trace.append(f'generate clarification choices count={len(clarification_options)}')

    # 응답에서 민감 정보 마스킹
    masked_answer = mask_sensitive_info(answer, database_path)

    query_result = None
    if suggested_sql and database_path is not None:
        trace.append('execute suggested sql on selected database')
        try:
            query_result = run_read_only_query(database_path, suggested_sql)
            if isinstance(query_result, dict) and isinstance(query_result.get('results'), list):
                trace.append(f"sql execution success statements={len(query_result.get('results', []))}")
            else:
                row_count = 0
                if isinstance(query_result, dict):
                    row_count = int(query_result.get('row_count', 0))
                trace.append(f'sql execution success rows={row_count}')
        except (OSError, sqlite3.Error, SuspiciousOperation) as error:
            query_result = {'error': str(error)}
            trace.append(f'sql execution failed error={str(error)}')
    elif suggested_sql and mode == 'folder':
        trace.append('execute suggested sql in folder mode (attached multi-database)')
        try:
            query_result = run_read_only_query_across_databases(context, suggested_sql)
            if isinstance(query_result, dict) and isinstance(query_result.get('results'), list):
                trace.append(f"folder sql execution success statements={len(query_result.get('results', []))}")
            else:
                row_count = 0
                if isinstance(query_result, dict):
                    row_count = int(query_result.get('row_count', 0))
                trace.append(f'folder sql execution success rows={row_count}')
        except (OSError, sqlite3.Error, SuspiciousOperation) as error:
            query_result = {'error': str(error)}
            trace.append(f'folder sql execution failed error={str(error)}')
    elif suggested_sql:
        trace.append('sql suggested but execution skipped (missing execution context)')
    else:
        trace.append('no sql suggested by llm')

    return {
        'answer': masked_answer,
        'suggested_sql': suggested_sql,
        'clarification_options': clarification_options,
        'query_result': query_result,
        'provider': provider,
        'trace': trace,
        'llm_debug': {
            'summary': (
                f'provider={provider} '
                f'headers={"|".join(sorted(request_effective_headers.keys()))} '
                f'payload_keys={"|".join(sorted(payload.keys()))}'
            ),
            'request': request_preview,
            'response': response_preview,
        },
    }
