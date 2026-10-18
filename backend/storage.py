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
            db.execute('CREATE INDEX IF NOT EXISTS benchmark_quizzes_time ON benchmark_quizzes (recorded_at DESC)')
            yield db, '%s', True
    else:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        try:
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS benchmark_session (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)')
                db.execute('CREATE TABLE IF NOT EXISTS benchmark_quizzes (session_id TEXT NOT NULL, round INTEGER NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, data TEXT NOT NULL, PRIMARY KEY(session_id, round))')
                if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_market'").fetchone():
                    db.execute('INSERT OR IGNORE INTO benchmark_session SELECT id, state FROM exchange_market')
                if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_rounds'").fetchone():
                    db.execute('INSERT OR IGNORE INTO benchmark_quizzes SELECT session_id, round, recorded_at, data FROM exchange_rounds')
                yield db, '?', False
        finally:
            db.close()


def save(path, state):
    encoded = json.dumps(state, allow_nan=False)
    with connection(path) as (db, param, postgres):
        document = f'{param}::jsonb' if postgres else param
        db.execute(f'INSERT INTO benchmark_session VALUES (1, {document}) ON CONFLICT(id) DO UPDATE SET state=excluded.state', (encoded,))
        if state['phase'] == 'complete':
            db.execute(f'INSERT INTO benchmark_quizzes (session_id, round, data) VALUES ({param}, {param}, {document}) ON CONFLICT(session_id, round) DO UPDATE SET data=excluded.data',
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


def history(path):
    with connection(path) as (db, _, postgres):
        rows = db.execute('SELECT session_id, round, recorded_at FROM benchmark_quizzes ORDER BY recorded_at DESC, round DESC LIMIT 30').fetchall()
    return [dict(session_id=r[0], round=r[1], recorded_at=str(r[2])) for r in rows]
