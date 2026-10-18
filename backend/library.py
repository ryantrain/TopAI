"""Saved worksheets: converting uploaded documents into benchmark data and merging selected worksheets into one dataset."""
import base64
import csv
import hashlib
import html
import io
import json
import math
import mimetypes
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree

MAX_UPLOAD = 10 * 1024 * 1024
MAX_FILES = 50
MAX_EXAMPLES = 2000
# Gemini reads these directly; Office files are reduced to their text first, anything else must be text.
INLINE_TYPES = {'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'}
CONVERT_INSTRUCTION = (
    'Convert the supplied worksheet or document into benchmark examples. '
    'Include every question or task that has one clear, short correct answer: a number, a word, a label or a short phrase. '
    'Rewrite each question so it is fully self-contained, copying any context it needs such as passages, tables or given values, '
    'but never its answer or worked solution. Skip anything that depends on a picture you cannot describe in words. '
    'When the document has an answer key or worked solutions, take the answer from it and set "answer_source" to "document"; '
    'otherwise solve the question carefully and set "answer_source" to "model". Give numeric answers as plain numbers. '
    'Write "instructions" as one or two sentences telling a model how to format its answers, without revealing any answer. '
    'Return {"name": "short benchmark title", "instructions": "...", '
    '"examples": [{"question": "...", "answer": "number or short text", "answer_source": "document|model"}]}.')


def office_text(data, suffix):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = sorted(archive.namelist())
        if suffix == '.xlsx':
            ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            shared = []
            if 'xl/sharedStrings.xml' in names:
                shared = [''.join(t.text or '' for t in si.iter(ns + 't')) for si in ElementTree.fromstring(archive.read('xl/sharedStrings.xml')).iter(ns + 'si')]
            lines = []
            for name in (n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)):
                lines.append(f'# {name.rsplit("/", 1)[-1][:-4]}')
                for row in ElementTree.fromstring(archive.read(name)).iter(ns + 'row'):
                    cells = []
                    for cell in row.iter(ns + 'c'):
                        value = cell.find(ns + 'v')
                        text = ''.join(t.text or '' for t in cell.iter(ns + 't')) if cell.get('t') == 'inlineStr' else value.text or '' if value is not None else ''
                        cells.append(shared[int(text)] if cell.get('t') == 's' and text.isdigit() and int(text) < len(shared) else text)
                    lines.append('\t'.join(cells))
            return '\n'.join(lines)
        prefix = 'word/document' if suffix == '.docx' else 'ppt/slides/slide'
        xml = '\n'.join(archive.read(n).decode('utf-8', 'ignore') for n in names if n.startswith(prefix) and n.endswith('.xml'))
    # Paragraph ends become line breaks and tabs stay tabs; every other tag is dropped.
    xml = re.sub(r'</(?:w|a):p>', '\n', xml)
    xml = re.sub(r'<w:tab/>', '\t', xml)
    return html.unescape(re.sub(r'<[^>]+>', '', xml))


def document_input(filename, mime_type, data):
    """Return (text, attachment) for Gemini: a readable text rendering or an inline file."""
    suffix = Path(filename).suffix.lower()
    mime = mimetypes.guess_type(filename)[0] or mime_type
    if mime in INLINE_TYPES:
        return None, dict(mime_type=mime, data=base64.b64encode(data).decode('ascii'))
    if suffix in ('.docx', '.pptx', '.xlsx'):
        try:
            text = office_text(data, suffix)
        except (zipfile.BadZipFile, ElementTree.ParseError, KeyError):
            raise ValueError(f'Could not read this {suffix} file.') from None
    else:
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise ValueError('Unsupported file type. Use a PDF, image, Word, Excel or PowerPoint file, or a text file such as CSV or Markdown.') from None
    if not text.strip():
        raise ValueError('No readable text was found in this file.')
    return text[:500_000], None


def is_number(value):
    from backend.main import number
    try:
        number(value)
        return True
    except ValueError:
        return False


def as_text(answer):
    # Numbers become text without a trailing .0 so exact matching accepts "27".
    if isinstance(answer, float) and answer.is_integer():
        return str(int(answer))
    return str(answer).strip()


def question_key(question):
    return ' '.join(question.casefold().split())


def make_entry(name, source, origin, scoring, problems, instructions='', tolerance=1e-6):
    return dict(id=uuid4().hex[:12], name=name[:120], source=source[:200], origin=origin, scoring=scoring,
                count=len(problems), model_answers=sum(p.get('answer_source') == 'model' for p in problems),
                instructions=instructions, tolerance=tolerance, created_at=datetime.now(timezone.utc).isoformat(), problems=problems)


def from_conversion(result, filename, origin='converted'):
    """Turn Gemini's reply (or an already structured file) into a library entry, dropping malformed or duplicate rows."""
    from backend.main import number
    rows = result.get('examples')
    if not isinstance(rows, list):
        raise ValueError('No questions were found in this worksheet.')
    problems, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        question, answer = row.get('question'), row.get('answer')
        if not isinstance(question, str) or not question.strip() or len(question) > 10000:
            continue
        if isinstance(answer, bool) or not isinstance(answer, (str, int, float)) or not str(answer).strip() or len(str(answer)) > 2000:
            continue
        if isinstance(answer, float) and not math.isfinite(answer):
            continue
        if question_key(question) in seen:
            continue
        seen.add(question_key(question))
        problems.append(dict(question=question.strip(), answer=answer, answer_source='model' if row.get('answer_source') == 'model' else 'document'))
    if not problems:
        raise ValueError('No questions with a clear answer were found in this worksheet.')
    problems = problems[:MAX_EXAMPLES]
    scoring = 'numeric' if all(is_number(p['answer']) for p in problems) else 'exact'
    for p in problems:
        p['answer'] = number(p['answer']) if scoring == 'numeric' else as_text(p['answer'])
    instructions = result.get('instructions') if isinstance(result.get('instructions'), str) else ''
    name = str(result.get('name') or '').strip() or Path(filename).stem
    tolerance = result.get('tolerance')
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or tolerance < 0:
        tolerance = 1e-6
    return make_entry(name, filename, origin, scoring, problems, instructions[:30000], tolerance)


def from_structured(filename, data):
    """Import explicit question/answer data without inference; None means it needs parsing."""
    suffix = Path(filename).suffix.lower()
    if suffix in ('.txt', '.md'):
        try:
            text = data.decode('utf-8-sig').strip()
        except UnicodeError:
            return None
        # Require every nonblank line to belong to a labeled pair; prose still needs inference.
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines or len(lines) % 2:
            return None
        examples = []
        for i in range(0, len(lines), 2):
            question = re.fullmatch(r'(?:Q|Question):[ \t]*(.+)', lines[i], re.IGNORECASE)
            answer = re.fullmatch(r'(?:A|Answer):[ \t]*(.+)', lines[i + 1], re.IGNORECASE)
            if not question or not answer:
                return None
            examples.append(dict(question=question[1], answer=answer[1], answer_source='document'))
        return from_conversion(dict(examples=examples), filename, origin='uploaded')
    if suffix not in ('.json', '.jsonl', '.csv'):
        return None
    try:
        text = data.decode('utf-8-sig')
        if suffix == '.csv':
            rows = list(csv.DictReader(io.StringIO(text)))
        elif suffix == '.jsonl':
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            rows = json.loads(text)
    except (UnicodeError, ValueError, csv.Error, RecursionError):
        return None
    result = dict(rows) if isinstance(rows, dict) else dict(examples=rows)
    rows = result.get('examples', result.get('problems'))
    if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
        return None
    # Field names are matched case-insensitively, so "Question,Answer" CSV headers work too.
    rows = [{str(k).strip().lower(): v for k, v in r.items()} for r in rows]
    if not all('question' in r and 'answer' in r for r in rows):
        return None
    result['examples'] = rows
    return from_conversion(result, filename, origin='uploaded')


def from_dataset(dataset):
    return make_entry(dataset['name'], dataset['name'], 'uploaded', dataset['scoring'], dataset['problems'],
                      dataset.get('instructions', ''), dataset.get('tolerance', 1e-6))


def summary(entry):
    return {key: value for key, value in entry.items() if key != 'problems'}


def export(entry):
    """The same JSON shape the dataset uploader accepts."""
    return dict(name=entry['name'], instructions=entry['instructions'], tolerance=entry['tolerance'],
                examples=[dict(question=p['question'], answer=p['answer']) for p in entry['problems']])


def combine(entries):
    """Merge selected files into one dataset, alternating between files so every round mixes them."""
    scoring = 'numeric' if all(e['scoring'] == 'numeric' for e in entries) else 'exact'
    problems, seen = [], set()
    queues = [list(e['problems']) for e in entries]
    while any(queues) and len(problems) < MAX_EXAMPLES:
        for queue in queues:
            if not queue:
                continue
            p = queue.pop(0)
            if question_key(p['question']) in seen:
                continue
            seen.add(question_key(p['question']))
            problems.append(dict(question=p['question'], answer=p['answer'] if scoring == 'numeric' else as_text(p['answer'])))
    problems = problems[:MAX_EXAMPLES]
    instructions = '\n\n'.join(dict.fromkeys(e['instructions'].strip() for e in entries if e['instructions'].strip()))
    name = entries[0]['name'] if len(entries) == 1 else f'{entries[0]["name"]} + {len(entries) - 1} more'
    return dict(name=name[:120], scoring=scoring, count=len(problems), instructions=instructions[:30000],
                tolerance=min(e['tolerance'] for e in entries), files=[e['id'] for e in entries],
                digest=hashlib.sha256(','.join(e['id'] for e in entries).encode()).hexdigest(), problems=problems)
