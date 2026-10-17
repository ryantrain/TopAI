"""Bounded, dependency-free imports for user-curated benchmarks."""
import csv
import hashlib
import io
import json
import math
from pathlib import Path

MAX_BYTES = 2 * 1024 * 1024


def parse_dataset(raw, filename, scoring):
    if scoring not in ('exact', 'numeric'):
        raise ValueError('Choose exact or numeric scoring.')
    if len(raw) > MAX_BYTES:
        raise ValueError('Dataset must be 2 MB or smaller.')
    try:
        text = raw.decode('utf-8-sig')
        suffix = Path(filename).suffix.lower()
        if suffix == '.csv':
            rows = list(csv.DictReader(io.StringIO(text)))
        elif suffix == '.json':
            rows = json.loads(text)
        elif suffix == '.jsonl':
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            raise ValueError('Upload a CSV, JSON, or JSONL file.')
    except (UnicodeError, json.JSONDecodeError, csv.Error, RecursionError):
        raise ValueError('Could not read the file. Check its UTF-8 encoding and format.') from None
    instructions, tolerance = '', 1e-6
    if suffix == '.json' and isinstance(rows, dict):
        instructions = rows.get('instructions', '')
        tolerance = rows.get('tolerance', 1e-6)
        if not isinstance(instructions, str) or len(instructions) > 30000:
            raise ValueError('Instructions must be text up to 30,000 characters.')
        if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or tolerance < 0:
            raise ValueError('Tolerance must be a finite nonnegative number.')
        rows = rows.get('examples')
    if not isinstance(rows, list) or not 20 <= len(rows) <= 2000:
        raise ValueError('Include 20–2,000 examples (20 distinct examples per round).')
    problems, seen = [], set()
    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f'Row {i}: expected question and answer fields.')
        question, answer = row.get('question'), row.get('answer')
        if not isinstance(question, str) or not question.strip() or len(question) > 10000:
            raise ValueError(f'Row {i}: question must contain 1–10,000 characters.')
        if isinstance(answer, bool) or not isinstance(answer, (str, int, float)) or not str(answer).strip() or len(str(answer)) > 2000:
            raise ValueError(f'Row {i}: answer must be text or a number, up to 2,000 characters.')
        if isinstance(answer, float) and not math.isfinite(answer):
            raise ValueError(f'Row {i}: answer must be finite.')
        question = question.strip()
        key = ' '.join(question.casefold().split())
        if key in seen:
            raise ValueError(f'Row {i}: duplicate question. Use distinct questions to avoid holdout leakage.')
        seen.add(key)
        if scoring == 'numeric':
            from backend.main import number
            try:
                answer = number(answer)
            except ValueError:
                raise ValueError(f'Row {i}: numeric scoring requires a numeric answer.') from None
        problems.append(dict(question=question, answer=answer))
    return dict(name=Path(filename).name[:120], scoring=scoring, count=len(problems),
                instructions=instructions, tolerance=tolerance, digest=hashlib.sha256(raw).hexdigest(), problems=problems)


def matches(actual, expected, scoring, tolerance=1e-6):
    if scoring == 'numeric':
        from backend.main import number
        try:
            return math.isclose(number(actual), expected, rel_tol=0, abs_tol=tolerance)
        except ValueError:
            return False
    return type(actual) in (str, int, float) and str(actual).strip() == str(expected).strip()
