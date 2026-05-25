"""Oracle SQL compatibility helpers for SQLite.

This module is intentionally framework-agnostic so it can be reused in
other Python projects without Django dependencies.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re

ORACLE_ROWNUM_PATTERN = re.compile(r'(?is)\s+(where|and)\s+rownum\s*(<|<=)\s*(\d+)\s*$')
ORACLE_SYSDATE_FRACTION_PATTERN = re.compile(
    r'(?i)\bsysdate\b\s*([+-])\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)'
)
ORACLE_SYSDATE_DAYS_PATTERN = re.compile(r'(?i)\bsysdate\b\s*([+-])\s*(\d+(?:\.\d+)?)')
ORACLE_SYSDATE_WORD_PATTERN = re.compile(r'(?i)\bsysdate\b')
ORACLE_TO_CHAR_PATTERN = re.compile(
    r"(?is)\bto_char\s*\(\s*(?P<expr>.*?)\s*,\s*'(?P<fmt>[^']+)'\s*\)"
)
ORACLE_DECODE_CALL_PATTERN = re.compile(r'(?i)\bdecode\s*\(')
ORACLE_NVL2_CALL_PATTERN = re.compile(r'(?i)\bnvl2\s*\(')
ORACLE_NVL_CALL_PATTERN = re.compile(r'(?i)\bnvl\s*\(')


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


def _format_decimal(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f'{value:.6f}'.rstrip('0').rstrip('.')


def _escape_sql_literal(value: str) -> str:
    return value.replace("'", "''")


def _resolve_python_now(
    timezone_offset_minutes: int | None,
    python_now: datetime | None,
) -> datetime:
    if python_now is not None:
        return python_now

    if timezone_offset_minutes is None:
        return datetime.now()

    base_utc = datetime.now(timezone.utc)
    return (base_utc - timedelta(minutes=int(timezone_offset_minutes))).replace(tzinfo=None)


def _build_python_now_expression(
    timezone_offset_minutes: int | None,
    python_now: datetime | None,
    extra_modifier: str | None = None,
) -> str:
    now_dt = _resolve_python_now(timezone_offset_minutes, python_now)
    now_text = _escape_sql_literal(now_dt.strftime('%Y-%m-%d %H:%M:%S'))
    if extra_modifier:
        return f"DATETIME('{now_text}', '{extra_modifier}')"
    return f"DATETIME('{now_text}')"


def translate_oracle_sysdate(
    sql: str,
    timezone_offset_minutes: int | None = None,
    python_now: datetime | None = None,
) -> str:
    """Translate Oracle-style SYSDATE expressions using Python current time."""
    translated = sql.strip()

    def _replace_fraction(match: re.Match[str]) -> str:
        sign = match.group(1)
        numerator = float(match.group(2))
        denominator = float(match.group(3))
        if denominator == 0:
            return match.group(0)
        seconds = (numerator / denominator) * 86400.0
        return _build_python_now_expression(
            timezone_offset_minutes,
            python_now,
            f"{sign}{_format_decimal(seconds)} seconds",
        )

    translated = ORACLE_SYSDATE_FRACTION_PATTERN.sub(_replace_fraction, translated)

    def _replace_days(match: re.Match[str]) -> str:
        sign = match.group(1)
        days = float(match.group(2))
        return _build_python_now_expression(
            timezone_offset_minutes,
            python_now,
            f"{sign}{_format_decimal(days)} days",
        )

    translated = ORACLE_SYSDATE_DAYS_PATTERN.sub(_replace_days, translated)
    translated = ORACLE_SYSDATE_WORD_PATTERN.sub(
        _build_python_now_expression(timezone_offset_minutes, python_now),
        translated,
    )
    return translated


def _oracle_to_char_format_to_sqlite(fmt: str) -> str:
    normalized = fmt.strip()

    upper_normalized = normalized.upper()
    if upper_normalized == 'YYYY-MM-DD HH24:MI:SS':
        return '%Y-%m-%d %H:%M:%S'
    if upper_normalized == 'YYMMDD':
        return '%y%m%d'

    converted = normalized
    token_map = [
        ('HH24', '%H'),
        ('HH', '%H'),
        ('YYYY', '%Y'),
        ('YY', '%y'),
        ('MM', '%m'),
        ('DD', '%d'),
        ('MI', '%M'),
        ('SS', '%S'),
    ]
    for oracle_token, sqlite_token in token_map:
        converted = re.sub(oracle_token, sqlite_token, converted, flags=re.IGNORECASE)
    return converted


def translate_oracle_to_char(sql: str) -> str:
    """Translate Oracle TO_CHAR(datetime, format) to SQLite STRFTIME(format, datetime)."""

    def _replace(match: re.Match[str]) -> str:
        expr = match.group('expr').strip()
        fmt = match.group('fmt').strip()
        if not expr:
            return match.group(0)
        sqlite_fmt = _oracle_to_char_format_to_sqlite(fmt)
        return f"STRFTIME('{sqlite_fmt}', {expr})"

    return ORACLE_TO_CHAR_PATTERN.sub(_replace, sql)


def _find_matching_parenthesis(sql: str, opening_index: int) -> int:
    depth = 0
    in_single = False
    in_double = False
    index = opening_index
    length = len(sql)

    while index < length:
        ch = sql[index]
        nxt = sql[index + 1] if index + 1 < length else ''

        if in_single:
            if ch == "'":
                if nxt == "'":
                    index += 2
                    continue
                in_single = False
            index += 1
            continue

        if in_double:
            if ch == '"':
                if nxt == '"':
                    index += 2
                    continue
                in_double = False
            index += 1
            continue

        if ch == "'":
            in_single = True
            index += 1
            continue
        if ch == '"':
            in_double = True
            index += 1
            continue

        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return index

        index += 1

    return -1


def _split_sql_arguments(arguments_text: str) -> list[str]:
    args: list[str] = []
    start = 0
    depth = 0
    in_single = False
    in_double = False
    index = 0
    length = len(arguments_text)

    while index < length:
        ch = arguments_text[index]
        nxt = arguments_text[index + 1] if index + 1 < length else ''

        if in_single:
            if ch == "'":
                if nxt == "'":
                    index += 2
                    continue
                in_single = False
            index += 1
            continue

        if in_double:
            if ch == '"':
                if nxt == '"':
                    index += 2
                    continue
                in_double = False
            index += 1
            continue

        if ch == "'":
            in_single = True
            index += 1
            continue
        if ch == '"':
            in_double = True
            index += 1
            continue

        if ch == '(':
            depth += 1
        elif ch == ')':
            if depth > 0:
                depth -= 1
        elif ch == ',' and depth == 0:
            args.append(arguments_text[start:index].strip())
            start = index + 1

        index += 1

    args.append(arguments_text[start:].strip())
    return args


def _translate_oracle_nvl_once(sql: str) -> str:
    result_parts: list[str] = []
    cursor = 0
    length = len(sql)

    while cursor < length:
        match = ORACLE_NVL_CALL_PATTERN.search(sql, cursor)
        if not match:
            result_parts.append(sql[cursor:])
            break

        call_start = match.start()
        opening_index = match.end() - 1
        closing_index = _find_matching_parenthesis(sql, opening_index)
        if closing_index < 0:
            result_parts.append(sql[cursor:])
            break

        inner = sql[opening_index + 1:closing_index]
        args = _split_sql_arguments(inner)
        if len(args) != 2:
            # Ambiguous signature; keep original text untouched.
            result_parts.append(sql[cursor:closing_index + 1])
            cursor = closing_index + 1
            continue

        replacement = f'IFNULL({args[0]}, {args[1]})'
        result_parts.append(sql[cursor:call_start])
        result_parts.append(replacement)
        cursor = closing_index + 1

    return ''.join(result_parts)


def _build_decode_condition(expr: str, search: str) -> str:
    # Oracle DECODE treats NULL = NULL as true; emulate it explicitly.
    return f'(({expr}) = ({search}) OR (({expr}) IS NULL AND ({search}) IS NULL))'


def _translate_oracle_decode_once(sql: str) -> str:
    result_parts: list[str] = []
    cursor = 0
    length = len(sql)

    while cursor < length:
        match = ORACLE_DECODE_CALL_PATTERN.search(sql, cursor)
        if not match:
            result_parts.append(sql[cursor:])
            break

        call_start = match.start()
        opening_index = match.end() - 1
        closing_index = _find_matching_parenthesis(sql, opening_index)
        if closing_index < 0:
            result_parts.append(sql[cursor:])
            break

        inner = sql[opening_index + 1:closing_index]
        args = _split_sql_arguments(inner)

        # Valid Oracle DECODE signatures have at least expr, search, result.
        if len(args) < 3:
            result_parts.append(sql[cursor:closing_index + 1])
            cursor = closing_index + 1
            continue

        expr = args[0]
        remaining = len(args) - 1
        has_default = (remaining % 2) == 1
        pair_count = (remaining - 1) // 2 if has_default else remaining // 2

        if pair_count <= 0:
            result_parts.append(sql[cursor:closing_index + 1])
            cursor = closing_index + 1
            continue

        default_expr = args[-1] if has_default else 'NULL'
        when_parts: list[str] = []
        for index in range(pair_count):
            search = args[1 + index * 2]
            value = args[2 + index * 2]
            when_parts.append(f'WHEN {_build_decode_condition(expr, search)} THEN {value}')

        replacement = f"CASE {' '.join(when_parts)} ELSE {default_expr} END"
        result_parts.append(sql[cursor:call_start])
        result_parts.append(replacement)
        cursor = closing_index + 1

    return ''.join(result_parts)


def _translate_oracle_nvl2_once(sql: str) -> str:
    result_parts: list[str] = []
    cursor = 0
    length = len(sql)

    while cursor < length:
        match = ORACLE_NVL2_CALL_PATTERN.search(sql, cursor)
        if not match:
            result_parts.append(sql[cursor:])
            break

        call_start = match.start()
        opening_index = match.end() - 1
        closing_index = _find_matching_parenthesis(sql, opening_index)
        if closing_index < 0:
            result_parts.append(sql[cursor:])
            break

        inner = sql[opening_index + 1:closing_index]
        args = _split_sql_arguments(inner)
        if len(args) != 3:
            # Ambiguous signature; keep original text untouched.
            result_parts.append(sql[cursor:closing_index + 1])
            cursor = closing_index + 1
            continue

        replacement = f'CASE WHEN {args[0]} IS NOT NULL THEN {args[1]} ELSE {args[2]} END'
        result_parts.append(sql[cursor:call_start])
        result_parts.append(replacement)
        cursor = closing_index + 1

    return ''.join(result_parts)


def translate_oracle_nvl(sql: str) -> str:
    """Translate Oracle NVL(expr, fallback) to SQLite IFNULL(expr, fallback)."""
    translated = sql
    while True:
        next_translated = _translate_oracle_nvl_once(translated)
        if next_translated == translated:
            return translated
        translated = next_translated


def translate_oracle_decode(sql: str) -> str:
    """Translate Oracle DECODE(...) to SQLite CASE expression with NULL=NULL semantics."""
    translated = sql
    while True:
        next_translated = _translate_oracle_decode_once(translated)
        if next_translated == translated:
            return translated
        translated = next_translated


def translate_oracle_nvl2(sql: str) -> str:
    """Translate Oracle NVL2(expr, not_null_value, null_value) to SQLite CASE expression."""
    translated = sql
    while True:
        next_translated = _translate_oracle_nvl2_once(translated)
        if next_translated == translated:
            return translated
        translated = next_translated


def translate_oracle_sql(
    sql: str,
    timezone_offset_minutes: int | None = None,
    python_now: datetime | None = None,
) -> str:
    """Apply Oracle compatibility transforms in a safe order for SQLite execution."""
    return translate_oracle_sysdate(
        translate_oracle_to_char(
            translate_oracle_nvl(
                translate_oracle_nvl2(
                    translate_oracle_decode(translate_oracle_rownum(sql))
                )
            )
        ),
        timezone_offset_minutes=timezone_offset_minutes,
        python_now=python_now,
    )


__all__ = [
    'translate_oracle_rownum',
    'translate_oracle_sysdate',
    'translate_oracle_to_char',
    'translate_oracle_decode',
    'translate_oracle_nvl2',
    'translate_oracle_nvl',
    'translate_oracle_sql',
]
