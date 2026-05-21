"""Oracle SQL compatibility helpers for SQLite.

This module is intentionally framework-agnostic so it can be reused in
other Python projects without Django dependencies.
"""

from __future__ import annotations

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


def translate_oracle_sysdate(sql: str) -> str:
    """Translate Oracle-style SYSDATE expressions to SQLite DATETIME forms."""
    translated = sql.strip()

    def _replace_fraction(match: re.Match[str]) -> str:
        sign = match.group(1)
        numerator = float(match.group(2))
        denominator = float(match.group(3))
        if denominator == 0:
            return match.group(0)
        seconds = (numerator / denominator) * 86400.0
        return f"DATETIME('now', '{sign}{_format_decimal(seconds)} seconds')"

    translated = ORACLE_SYSDATE_FRACTION_PATTERN.sub(_replace_fraction, translated)

    def _replace_days(match: re.Match[str]) -> str:
        sign = match.group(1)
        days = float(match.group(2))
        return f"DATETIME('now', '{sign}{_format_decimal(days)} days')"

    translated = ORACLE_SYSDATE_DAYS_PATTERN.sub(_replace_days, translated)
    translated = ORACLE_SYSDATE_WORD_PATTERN.sub("DATETIME('now')", translated)
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


def translate_oracle_sql(sql: str) -> str:
    """Apply Oracle compatibility transforms in a safe order for SQLite execution."""
    return translate_oracle_sysdate(translate_oracle_to_char(translate_oracle_rownum(sql)))


__all__ = [
    'translate_oracle_rownum',
    'translate_oracle_sysdate',
    'translate_oracle_to_char',
    'translate_oracle_sql',
]
