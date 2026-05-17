import json
import os
import re
import shutil
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.utils.html import escape

SQLITE_SUFFIXES = {'.db', '.sqlite', '.sqlite3'}
READ_ONLY_PREFIXES = ('select', 'with', 'pragma', 'explain')
DEFAULT_ROW_LIMIT = 100
DEFAULT_SAMPLE_LIMIT = 3
SETTINGS_FILENAME = '.websqlitebrowser-settings.json'
DEFAULT_LLM_ENDPOINT = 'https://api.anthropic.com/v1/messages'
DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001'
METADATA_MAX_DOCS = 12
METADATA_MAX_CHARS_PER_DOC = 5000
FOLDER_CHAT_MAX_DATABASES = 8
FOLDER_CHAT_PREVIEW_TABLES_PER_DB = 2
LEGACY_DEFAULT_LLM_ENDPOINTS = {
    'http://127.0.0.1:11434/v1',
    'http://localhost:11434/v1',
}
ORACLE_ROWNUM_PATTERN = re.compile(r'(?is)\s+(where|and)\s+rownum\s*(<|<=)\s*(\d+)\s*$')
FENCED_SQL_PATTERN = re.compile(r'```(?:sql)?\s*(.*?)```', re.IGNORECASE | re.DOTALL)
FENCED_JSON_PATTERN = re.compile(r'```(?:json)?\s*(\{.*?\})\s*```', re.IGNORECASE | re.DOTALL)


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
    return path.is_file() and path.suffix.lower() in SQLITE_SUFFIXES


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
            'endpoint': DEFAULT_LLM_ENDPOINT,
            'token': '',
            'model': DEFAULT_LLM_MODEL,
        }

    with path.open('r', encoding='utf-8') as handle:
        data = json.load(handle)

    endpoint = str(data.get('endpoint', DEFAULT_LLM_ENDPOINT)).strip() or DEFAULT_LLM_ENDPOINT
    model = str(data.get('model', DEFAULT_LLM_MODEL)).strip() or DEFAULT_LLM_MODEL

    # One-time migration for previous local Ollama defaults.
    if endpoint in LEGACY_DEFAULT_LLM_ENDPOINTS:
        endpoint = DEFAULT_LLM_ENDPOINT
    if model in {
        'llama3.1',
        'llama3',
        'qwen2.5',
        'tinyllama:latest',
        'claude-3-5-haiku-20241022',
    }:
        model = DEFAULT_LLM_MODEL

    return {
        'endpoint': endpoint,
        'token': _decrypt_token(str(data.get('token', ''))),
        'model': model,
    }


def save_settings(payload: dict[str, object]) -> dict[str, str]:
    endpoint = str(payload.get('endpoint', '')).strip() or DEFAULT_LLM_ENDPOINT
    model = str(payload.get('model', '')).strip() or DEFAULT_LLM_MODEL
    data = {
        'endpoint': endpoint,
        'token': _encrypt_token(str(payload.get('token', '')).strip()),
        'model': model,
    }
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + '.tmp')
    with temporary_path.open('w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temporary_path.replace(path)
    
    # 저장 후 반환할 때는 토큰 마스킹
    return {
        'endpoint': data['endpoint'],
        'token': '***' if data['token'] else '',
        'model': data['model'],
    }


def connect_database(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f'file:{database_path}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    return connection


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


def serialize_rows(cursor: sqlite3.Cursor, limit: int | None = 100) -> dict[str, object]:
    columns = [description[0] for description in cursor.description or []]

    if limit is None:
        rows = [dict(row) for row in cursor.fetchall()]
        return {
            'columns': columns,
            'rows': rows,
            'row_count': len(rows),
            'limit': None,
            'truncated': False,
        }

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


def table_preview(database_path: Path, table_name: str, limit: int = DEFAULT_SAMPLE_LIMIT) -> list[dict[str, object]]:
    with connect_database(database_path) as connection:
        escaped_table_name = quote_identifier(table_name)
        cursor = connection.execute(f'SELECT * FROM "{escaped_table_name}" LIMIT {limit}')
        return [dict(row) for row in cursor.fetchall()]


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


def list_sqlite_files_in_directory(folder_path: Path, max_files: int = FOLDER_CHAT_MAX_DATABASES) -> tuple[list[Path], bool]:
    try:
        files = [
            child
            for child in sorted(folder_path.iterdir(), key=lambda p: p.name.lower())
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

    for db_path in sqlite_files:
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
            'note': 'When multiple databases are provided, identify target database explicitly before generating SQL.',
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
    if 'api.anthropic.com' in lower or lower.endswith('/messages'):
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
    cleaned = sql.strip()
    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    # 1. 주석 제거 (-- 및 /* */ 스타일)
    # 단, 문자열 리터럴 내 주석 문자는 보존
    lines = []
    for line in cleaned.split('\n'):
        # -- 주석 제거 (SQL 문자열 내 --는 보존하기 위해 간단한 처리)
        if '--' in line:
            parts = line.split('--')
            line = parts[0]
        lines.append(line)
    cleaned = '\n'.join(lines)
    
    # /* */ 주석 제거
    import re as regex_module
    cleaned = regex_module.sub(r'/\*.*?\*/', '', cleaned, flags=regex_module.DOTALL)
    cleaned = cleaned.strip()

    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    # 2. 읽기 전용 여부 확인
    normalized = cleaned.lower()
    if not normalized.startswith(READ_ONLY_PREFIXES):
        raise SuspiciousOperation('Only read-only SQL statements are allowed.')

    # 3. 위험한 패턴 차단
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

    # 4. 복잡도 제한 (JOIN 최대 5개, 서브쿼리 최대 3개)
    join_count = len(regex_module.findall(r'(?i)\bjoin\b', cleaned))
    subquery_count = cleaned.count('(SELECT') + cleaned.count('(select')
    
    if join_count > 5:
        raise SuspiciousOperation(f'Query too complex: maximum 5 JOINs allowed (found {join_count}).')
    if subquery_count > 3:
        raise SuspiciousOperation(f'Query too complex: maximum 3 subqueries allowed (found {subquery_count}).')

    return cleaned


def split_sql_statements(sql: str) -> list[str]:
    cleaned = sql.strip()
    if not cleaned:
        raise SuspiciousOperation('SQL is required.')

    statements: list[str] = []
    buffer = ''
    for line in sql.splitlines(keepends=True):
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


def run_read_only_query(database_path: Path, sql: str) -> dict[str, object]:
    statements = split_sql_statements(sql)

    if len(statements) == 1:
        validated_sql = translate_oracle_rownum(validate_read_only_sql(statements[0]))
        with connect_database(database_path) as connection:
            cursor = connection.execute(validated_sql)
            return serialize_rows(cursor)

    validated_statements = [
        translate_oracle_rownum(validate_read_only_sql(statement))
        for statement in statements
    ]

    with connect_database(database_path) as connection:
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


def extract_sql_from_text(text: str) -> str:
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


def parse_llm_content(content: str) -> tuple[str, str]:
    cleaned = content.strip()
    if not cleaned:
        return '', ''

    # 1) Try fenced JSON first.
    fenced_match = FENCED_JSON_PATTERN.search(cleaned)
    if fenced_match:
        try:
            payload = json.loads(fenced_match.group(1))
            answer = str(payload.get('answer', '')).strip()
            sql = str(payload.get('sql', '')).strip()
            return answer, sql
        except json.JSONDecodeError:
            pass

    # 2) Try bare JSON object.
    json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if json_match:
        try:
            payload = json.loads(json_match.group(0))
            answer = str(payload.get('answer', '')).strip()
            sql = str(payload.get('sql', '')).strip()
            if answer or sql:
                return answer, sql
        except json.JSONDecodeError:
            pass

    # 3) Fallback: treat content as answer and extract SQL heuristically.
    return cleaned, extract_sql_from_text(cleaned)


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


def call_llm(
    settings_data: dict[str, str],
    question: str,
    context: dict[str, object],
    database_path: Path | None = None,
) -> dict[str, object]:
    endpoint = normalise_chat_endpoint(settings_data.get('endpoint', ''))
    if not endpoint:
        raise SuspiciousOperation('LLM endpoint is required.')
    provider = detect_llm_provider(endpoint)
    trace: list[str] = [f'detect provider={provider} endpoint={endpoint}']

    model = settings_data.get('model', '').strip()
    if not model:
        raise SuspiciousOperation('LLM model is required.')

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
    headers = {
        'Content-Type': 'application/json',
    }
    token = settings_data.get('token', '').strip()
    if provider == 'anthropic':
        if not token:
            raise SuspiciousOperation('Anthropic API key is required.')
        headers['x-api-key'] = token
        headers['anthropic-version'] = '2023-06-01'
        payload = {
            'model': model,
            'max_tokens': 1024,
            'temperature': 0.2,
            'system': system_prompt,
            'messages': [
                {'role': 'user', 'content': user_prompt},
            ],
        }
    else:
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'temperature': 0.2,
        }
        if token:
            headers['Authorization'] = f'Bearer {token}'

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST',
    )
    trace.append(f'send llm request model={model}')

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', errors='ignore').strip()
        request_summary = {
            'provider': provider,
            'endpoint': endpoint,
            'method': 'POST',
            'model': model,
            'payload_keys': sorted(list(payload.keys())),
        }
        message = (
            f'LLM request failed with status {error.code}. '
            f'request={json.dumps(request_summary, ensure_ascii=False)}'
        )
        if detail:
            message = f'{message} response={detail}'

        # Anthropic model-not-found diagnostics: include currently available model IDs.
        if provider == 'anthropic' and error.code == 404 and detail:
            try:
                detail_payload = json.loads(detail)
            except json.JSONDecodeError:
                detail_payload = {}

            if isinstance(detail_payload, dict):
                error_block = detail_payload.get('error')
                if isinstance(error_block, dict):
                    error_type = str(error_block.get('type', '')).strip()
                    error_message = str(error_block.get('message', '')).strip().lower()
                    if error_type == 'not_found_error' and error_message.startswith('model:'):
                        available_models = fetch_anthropic_available_models(endpoint, token)
                        if available_models:
                            preview = ', '.join(available_models[:10])
                            message = f'{message} available_models={preview}'
                        else:
                            message = f'{message} available_models=(unable to fetch)'
        raise SuspiciousOperation(message)
    except urllib.error.URLError as error:
        raise SuspiciousOperation(f'LLM connection failed: {error.reason}')

    request_preview = truncate_text(
        json.dumps(
            {
                'provider': provider,
                'endpoint': endpoint,
                'model': model,
                'method': 'POST',
                'payload': payload,
            },
            ensure_ascii=False,
        )
    )

    response_preview = truncate_text(json.dumps(response_payload, ensure_ascii=False))

    message = ''
    if provider == 'anthropic':
        content_blocks = response_payload.get('content') or []
        text_parts: list[str] = []
        if isinstance(content_blocks, list):
            for block in content_blocks:
                if isinstance(block, dict) and block.get('type') == 'text':
                    text_value = str(block.get('text', '')).strip()
                    if text_value:
                        text_parts.append(text_value)
        message = '\n'.join(text_parts).strip()
    else:
        choices = response_payload.get('choices') or []
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
    trace.append('parse llm response content')

    answer, suggested_sql = parse_llm_content(message)
    if not answer:
        answer = message

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
    elif suggested_sql:
        trace.append('sql suggested but execution skipped (folder mode)')
    else:
        trace.append('no sql suggested by llm')

    return {
        'answer': masked_answer,
        'suggested_sql': suggested_sql,
        'query_result': query_result,
        'provider': provider,
        'trace': trace,
        'llm_debug': {
            'request': request_preview,
            'response': response_preview,
        },
    }
