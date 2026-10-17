"""SQLite by default; DATABASE_URL switches the market to TigerData/Postgres."""
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
            db.execute('CREATE TABLE IF NOT EXISTS exchange_market (id INTEGER PRIMARY KEY CHECK(id=1), state JSONB NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS exchange_rounds (session_id TEXT NOT NULL, round INTEGER NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL, PRIMARY KEY(session_id, round))')
            db.execute('CREATE INDEX IF NOT EXISTS exchange_rounds_time ON exchange_rounds (recorded_at DESC)')
            yield db, '%s', True
    else:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        try:
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS exchange_market (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)')
                db.execute('CREATE TABLE IF NOT EXISTS exchange_rounds (session_id TEXT NOT NULL, round INTEGER NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, data TEXT NOT NULL, PRIMARY KEY(session_id, round))')
                yield db, '?', False
        finally:
            db.close()


def save(path, state):
    encoded = json.dumps(state, allow_nan=False)
    with connection(path) as (db, param, postgres):
        document = f'{param}::jsonb' if postgres else param
        db.execute(f'INSERT INTO exchange_market VALUES (1, {document}) ON CONFLICT(id) DO UPDATE SET state=excluded.state', (encoded,))
        if state['phase'] == 'complete':
            # Full snapshots archive all answers and portfolios. A reset only replaces the active market.
            db.execute(f'INSERT INTO exchange_rounds (session_id, round, data) VALUES ({param}, {param}, {document}) ON CONFLICT(session_id, round) DO UPDATE SET data=excluded.data',
                       (state['session_id'], state['round'], encoded))


def load(path):
    with connection(path) as (db, _, postgres):
        row = db.execute('SELECT state FROM exchange_market WHERE id=1').fetchone()
        if not row and not postgres:
            # Preserve pre-provider MVP databases; do not silently discard their current market.
            legacy = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market'").fetchone()
            if legacy:
                row = db.execute('SELECT state FROM market WHERE id=1').fetchone()
    if not row:
        return None
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def read_local(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        return None


def write_local(path, data):
    """Write a JSON file readable only by this user, replacing it atomically so a crash never leaves half a file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w', encoding='utf-8') as file:
        json.dump(data, file, allow_nan=False)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def history(path):
    with connection(path) as (db, _, postgres):
        rows = db.execute('SELECT session_id, round, recorded_at FROM exchange_rounds ORDER BY recorded_at DESC, round DESC LIMIT 30').fetchall()
    return [dict(session_id=r[0], round=r[1], recorded_at=str(r[2])) for r in rows]
