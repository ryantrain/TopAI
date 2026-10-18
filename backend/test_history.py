"""Saved quiz history stays available after resets and uses bound SQL parameters."""
import copy
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import storage


class HistoryCheck(unittest.TestCase):
    def test_history_api_validation_and_read_only_detail(self):
        from fastapi.testclient import TestClient
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'DATABASE_URL': '', 'EVALUATION_DB': str(Path(folder) / 'api.sqlite3')}):
            from backend import main
            with patch.object(main, 'DB', Path(folder) / 'api.sqlite3'), TestClient(main.app) as client:
                state = main.initial_state()
                state.update(round=1, phase='complete')
                storage.save(main.DB, state)
                before = copy.deepcopy(main.session)
                self.assertEqual(client.get('/api/history?offset=-1').status_code, 422)
                self.assertEqual(client.get('/api/history?limit=101').status_code, 422)
                self.assertEqual(len(client.get('/api/history').json()), 1)
                response = client.get(f'/api/history/{state["session_id"]}/1')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['session_id'], state['session_id'])
                self.assertEqual(client.get('/api/history/missing/1').status_code, 404)
                self.assertEqual(main.session, before)
                self.assertEqual(client.delete(f'/api/history/{state["session_id"]}/1').status_code, 200)
                self.assertEqual(client.get(f'/api/history/{state["session_id"]}/1').status_code, 404)
                self.assertEqual(client.get('/api/history').json(), [])
                self.assertEqual(client.delete(f'/api/history/{state["session_id"]}/1').status_code, 404)
                self.assertEqual(main.session, before)

    def test_delete_only_hides_selected_quiz_and_does_not_revive(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'DATABASE_URL': ''}):
            path = Path(folder) / 'history.sqlite3'
            # Upgrade an archive created before deletion was supported.
            with closing(sqlite3.connect(path)) as db:
                db.execute('CREATE TABLE benchmark_quizzes (session_id TEXT, round INTEGER, recorded_at TEXT DEFAULT CURRENT_TIMESTAMP, data TEXT, PRIMARY KEY(session_id, round))')
            state = dict(session_id='one', round=1, phase='complete', workers=[])
            storage.save(path, state)
            state['round'] = 2
            storage.save(path, state)
            current = storage.load(path)
            self.assertFalse(storage.delete_history(path, "' OR 1=1 --", 1))
            self.assertTrue(storage.delete_history(path, 'one', 1))
            self.assertEqual([r['round'] for r in storage.history(path)], [2])
            self.assertIsNone(storage.history_entry(path, 'one', 1))
            self.assertEqual(storage.load(path), current)
            state['round'] = 1
            storage.save(path, state)
            self.assertEqual([r['round'] for r in storage.history(path)], [2])
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('SELECT data FROM benchmark_quizzes WHERE session_id=? AND round=?', ('one', 1)).fetchone()[0], '{}')

    def test_archive_details_and_pagination_survive_reset(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'DATABASE_URL': ''}):
            path = Path(folder) / 'history.sqlite3'
            state = dict(session_id='class-one', round=1, phase='complete', mode='demo',
                         library=[{'private': 'source file'}], dataset={'name': 'Math', 'problems': [1]},
                         workers=[{'id': 'atlas', 'name': 'Atlas', 'model': 'Demo', 'score': 80,
                                   'answers': [{'question': '2+2', 'answer': 4, 'correct': True}],
                                   'scores': [{'round': 1, 'total_tokens': 100}]}])
            storage.save(path, state)
            storage.save(path, state)
            state['round'] = 2
            storage.save(path, state)
            storage.save(path, dict(session_id='class-two', round=0, phase='ready'))
            rows = storage.history(path, limit=1)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['round'], 2)
            self.assertEqual(rows[0]['dataset'], 'Math')
            self.assertEqual(rows[0]['workers'][0]['score'], 80)
            self.assertNotIn('answers', rows[0]['workers'][0])
            self.assertEqual(storage.history(path, offset=1)[0]['round'], 1)
            self.assertEqual(storage.history(path, offset=2), [])
            saved = storage.history_entry(path, 'class-one', 1)
            self.assertEqual(saved['workers'][0]['answers'][0]['answer'], 4)
            self.assertNotIn('library', saved)
            self.assertNotIn('problems', saved['dataset'])
            self.assertIsNone(storage.history_entry(path, "' OR 1=1 --", 1))
            self.assertIsNone(storage.history_entry(path, 'class-one', 99))
            self.assertEqual(storage.load(path)['session_id'], 'class-two')

    def test_postgres_history_uses_parameters_and_decodes_jsonb(self):
        import psycopg
        db = MagicMock()
        context = MagicMock()
        context.__enter__.return_value = db
        state = {'workers': [], 'dataset': {'name': 'Math', 'problems': [1]}, 'library': []}
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://test/history'}), patch.object(psycopg, 'connect', return_value=context):
            db.execute.return_value.fetchall.return_value = [('one', 1, '2026-10-17', copy.deepcopy(state))]
            self.assertEqual(storage.history('unused', offset=30, limit=10)[0]['dataset'], 'Math')
            self.assertEqual(db.execute.call_args.args[1], (10, 30))
            db.execute.return_value.fetchone.return_value = (copy.deepcopy(state),)
            self.assertEqual(storage.history_entry('unused', 'one', 1)['dataset'], {'name': 'Math'})
            self.assertEqual(db.execute.call_args.args[1], ('one', 1))
            db.execute.return_value.rowcount = 1
            self.assertTrue(storage.delete_history('unused', 'one', 1))
            self.assertIn('deleted_at=CURRENT_TIMESTAMP', db.execute.call_args.args[0])
            self.assertEqual(db.execute.call_args.args[1], ('one', 1))


if __name__ == '__main__':
    unittest.main()
