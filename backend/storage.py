"""SQLite by default; DATABASE_URL switches benchmark sessions to TigerData/Postgres."""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def connection(path):
    url = os.getenv('DATABASE_URL', '')
    if url:
        import psycopg
        with psycopg.connect(url, connect_timeout=10) as db:
            db.execute('CREATE TABLE IF NOT EXISTS benchmark_session (id INTEGER PRIMARY KEY CHECK(id=1), state JSONB NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS benchmark_quizzes (session_id TEXT NOT NULL, round INTEGER NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL, PRIMARY KEY(session_id, round))')
            db.execute('ALTER TABLE benchmark_quizzes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ')
            db.execute('CREATE INDEX IF NOT EXISTS benchmark_quizzes_time ON benchmark_quizzes (recorded_at DESC)')
            yield db, '%s', True
    else:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        try:
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS benchmark_session (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)')
                db.execute('CREATE TABLE IF NOT EXISTS benchmark_quizzes (session_id TEXT NOT NULL, round INTEGER NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, data TEXT NOT NULL, PRIMARY KEY(session_id, round))')
                if 'deleted_at' not in {row[1] for row in db.execute('PRAGMA table_info(benchmark_quizzes)')}:
                    db.execute('ALTER TABLE benchmark_quizzes ADD COLUMN deleted_at TEXT')
                if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_market'").fetchone():
                    db.execute('INSERT OR IGNORE INTO benchmark_session SELECT id, state FROM exchange_market')
                if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_rounds'").fetchone():
                    db.execute('INSERT OR IGNORE INTO benchmark_quizzes (session_id, round, recorded_at, data) SELECT session_id, round, recorded_at, data FROM exchange_rounds')
                yield db, '?', False
        finally:
            db.close()


def save(path, state):
    encoded = json.dumps(state, allow_nan=False)
    with connection(path) as (db, param, postgres):
        document = f'{param}::jsonb' if postgres else param
        db.execute(f'INSERT INTO benchmark_session VALUES (1, {document}) ON CONFLICT(id) DO UPDATE SET state=excluded.state', (encoded,))
        if state['phase'] == 'complete':
            db.execute(f'INSERT INTO benchmark_quizzes (session_id, round, data) VALUES ({param}, {param}, {document}) ON CONFLICT(session_id, round) DO UPDATE SET data=excluded.data WHERE benchmark_quizzes.deleted_at IS NULL',
                       (state['session_id'], state['round'], encoded))


def load(path):
    with connection(path) as (db, _, postgres):
        row = db.execute('SELECT state FROM benchmark_session WHERE id=1').fetchone()
        if not row and not postgres:
            # Preserve the earliest MVP database shape.
            legacy = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market'").fetchone()
            if legacy:
                row = db.execute('SELECT state FROM market WHERE id=1').fetchone()
    if not row:
        return None
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def history(path, offset=0, limit=30):
    with connection(path) as (db, param, _):
        rows = db.execute(f'SELECT session_id, round, recorded_at, data FROM benchmark_quizzes WHERE deleted_at IS NULL ORDER BY recorded_at DESC, session_id, round DESC LIMIT {param} OFFSET {param}', (limit, offset)).fetchall()
    results = []
    for session_id, round_number, recorded_at, data in rows:
        state = data if isinstance(data, dict) else json.loads(data)
        results.append(dict(session_id=session_id, round=round_number, recorded_at=str(recorded_at),
                            mode=state.get('mode'), dataset=(state.get('dataset') or {}).get('name'),
                            workers=[{key: w.get(key) for key in ('id', 'name', 'model', 'score')} for w in state.get('workers', [])]))
    return results


def history_entry(path, session_id, round_number):
    with connection(path) as (db, param, _):
        row = db.execute(f'SELECT data FROM benchmark_quizzes WHERE session_id={param} AND round={param} AND deleted_at IS NULL', (session_id, round_number)).fetchone()
    if not row:
        return None
    state = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    state.pop('library', None)
    if state.get('dataset'):
        state['dataset'].pop('problems', None)
    return state


def delete_history(path, session_id, round_number):
    # Keep a deletion marker so saving the current class cannot revive a removed quiz.
    with connection(path) as (db, param, _):
        result = db.execute(f"UPDATE benchmark_quizzes SET deleted_at=CURRENT_TIMESTAMP, data='{{}}' WHERE session_id={param} AND round={param} AND deleted_at IS NULL", (session_id, round_number))
        return result.rowcount > 0
