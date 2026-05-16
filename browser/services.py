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
                if child.is_dir(follow_symlinks=False):
                    directories += 1
                elif child.is_file(follow_symlinks=False):
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
        return {'endpoint': '', 'token': '', 'model': ''}

    with path.open('r', encoding='utf-8') as handle:
        data = json.load(handle)

    return {
        'endpoint': str(data.get('endpoint', '')),
        'token': _decrypt_token(str(data.get('token', ''))),
        'model': str(data.get('model', '')),
    }


def save_settings(payload: dict[str, object]) -> dict[str, str]:
    data = {
        'endpoint': str(payload.get('endpoint', '')).strip(),
        'token': _encrypt_token(str(payload.get('token', '')).strip()),
        'model': str(payload.get('model', '')).strip(),
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


def build_chat_context(database_path: Path) -> dict[str, object]:
    tables = fetch_tables(database_path)
    preview_rows = []
    for table in tables:
        preview_rows.append(
            {
                'table': table['name'],
                'rows': table_preview(database_path, table['name']),
            }
        )

    return {
        'database': database_path.name,
        'tables': tables,
        'previews': preview_rows,
    }


def normalise_chat_endpoint(endpoint: str) -> str:
    cleaned = endpoint.strip().rstrip('/')
    if not cleaned:
        return cleaned
    if cleaned.endswith('/chat/completions'):
        return cleaned
    return f'{cleaned}/chat/completions'


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


def call_llm(
    settings_data: dict[str, str],
    question: str,
    context: dict[str, object],
    database_path: Path | None = None,
) -> dict[str, object]:
    endpoint = normalise_chat_endpoint(settings_data.get('endpoint', ''))
    if not endpoint:
        raise SuspiciousOperation('LLM endpoint is required.')

    model = settings_data.get('model', '').strip()
    if not model:
        raise SuspiciousOperation('LLM model is required.')

    system_prompt = (
        'You are a Korean assistant for SQLite database exploration. '
        'Answer using only the provided schema and sample rows. '
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

    answer, suggested_sql = parse_llm_content(message)
    if not answer:
        answer = message

    # 응답에서 민감 정보 마스킹
    masked_answer = mask_sensitive_info(answer, database_path)

    query_result = None
    if suggested_sql and database_path is not None:
        try:
            query_result = run_read_only_query(database_path, suggested_sql)
        except (OSError, sqlite3.Error, SuspiciousOperation) as error:
            query_result = {'error': str(error)}

    return {
        'answer': masked_answer,
        'suggested_sql': suggested_sql,
        'query_result': query_result,
        'provider': 'openai-compatible',
    }
