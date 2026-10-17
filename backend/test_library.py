"""Run with: python -m unittest backend.test_library -v (no API calls)."""
import base64
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

scratch = tempfile.TemporaryDirectory()
os.environ['EXCHANGE_DB'] = str(Path(scratch.name) / 'test.sqlite3')
os.environ['DATABASE_URL'] = ''
from backend import library
from backend import main as exchange
from fastapi.testclient import TestClient


def examples(prefix, count, answer=lambda i: i * 2):
    return [dict(question=f'{prefix} question {i}?', answer=answer(i)) for i in range(count)]


def office_file(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


class LibraryCheck(unittest.TestCase):
    def setUp(self):
        exchange.worksheets.clear()
        exchange.market.clear()
        exchange.market.update(exchange.initial_state())

    def convert(self, client, reply, filename='sheet.pdf'):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch.object(exchange, 'ask', AsyncMock(return_value=reply)) as gemini:
            response = client.post('/api/library/convert', json=dict(filename=filename, data=base64.b64encode(b'%PDF-1.7').decode()))
        return response, gemini

    def test_conversion_scoring_and_cleanup(self):
        entry = library.from_conversion(dict(name='Maths', examples=examples('A', 3) + [dict(question='A question 1?', answer=9), dict(question='', answer=1)]), 'w.pdf')
        self.assertEqual((entry['count'], entry['scoring'], entry['problems'][0]['answer']), (3, 'numeric', 0.0))
        words = library.from_conversion(dict(examples=[dict(question='Capital of France?', answer='Paris'), dict(question='2+2?', answer=4, answer_source='model')]), 'quiz.docx')
        self.assertEqual((words['name'], words['scoring'], words['problems'][1]['answer'], words['model_answers']), ('quiz', 'exact', '4', 1))
        with self.assertRaises(ValueError):
            library.from_conversion(dict(examples=[]), 'empty.pdf')

    def test_office_and_inline_inputs(self):
        docx = office_file({'word/document.xml': '<w:document><w:p><w:t>1. 3 + 4 = ?</w:t></w:p><w:p><w:t>Key &amp; answers</w:t></w:p></w:document>'})
        self.assertEqual(library.document_input('sheet.docx', '', docx)[0].split(), '1. 3 + 4 = ? Key & answers'.split())
        ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        xlsx = office_file({
            'xl/sharedStrings.xml': f'<sst {ns}><si><t>Question</t></si><si><t>Answer</t></si></sst>',
            'xl/worksheets/sheet1.xml': f'<worksheet {ns}><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="inlineStr"><is><t>2 x 6</t></is></c><c><v>12</v></c></row></sheetData></worksheet>',
        })
        self.assertIn('Question\tAnswer\n2 x 6\t12', library.document_input('sheet.xlsx', '', xlsx)[0])
        text, attachment = library.document_input('scan.pdf', '', b'%PDF-1.7')
        self.assertEqual((text, attachment['mime_type']), (None, 'application/pdf'))
        with self.assertRaises(ValueError):
            library.document_input('blob.bin', 'application/octet-stream', b'\xff\xfe\x00\x81')

    def test_converted_file_is_selected_and_ready_to_run(self):
        with TestClient(exchange.app) as client:
            response, gemini = self.convert(client, dict(name='Fractions', instructions='Reply with a number.', examples=examples('F', 24)))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['selected'])
            self.assertEqual(gemini.call_args.kwargs['attachment']['mime_type'], 'application/pdf')
            market = client.get('/api/market').json()
            self.assertEqual(market['dataset']['name'], 'Fractions')
            self.assertEqual(market['dataset']['remaining_rounds'], 1)
            self.assertNotIn('problems', market['library'][0])
            self.assertNotIn('F question 0?', json.dumps(market))
            with patch.object(exchange, 'run_rounds', AsyncMock()):
                self.assertEqual(client.post('/api/rounds', json={'mode': 'demo'}).status_code, 202)

    def test_multiple_small_files_combine_into_one_benchmark(self):
        with TestClient(exchange.app) as client:
            first = self.convert(client, dict(name='Numbers', examples=examples('N', 12)))[0].json()['entry']['id']
            self.assertIsNone(exchange.market['dataset'])
            self.assertEqual(client.post('/api/rounds', json={'mode': 'demo'}).status_code, 400)
            second = self.convert(client, dict(name='Words', examples=examples('W', 12, lambda i: f'word {i}')))[0].json()['entry']['id']
            self.assertEqual(exchange.market['selection'], [second])
            chosen = client.put('/api/library/selection', json={'ids': [first, second]}).json()
            self.assertEqual((chosen['count'], chosen['ready']), (24, True))
            dataset = exchange.market['dataset']
            self.assertEqual((dataset['scoring'], dataset['name']), ('exact', 'Numbers + 1 more'))
            # Files alternate so the first round mixes both, and numbers become exact-match text.
            self.assertEqual([p['question'][0] for p in dataset['problems'][:4]], ['N', 'W', 'N', 'W'])
            self.assertEqual(dataset['problems'][2]['answer'], '2')
            download = client.get(f'/api/library/{first}')
            self.assertIn('attachment', download.headers['content-disposition'])
            self.assertEqual(len(download.json()['examples']), 12)
            self.assertEqual(client.delete(f'/api/library/{second}').status_code, 200)
            self.assertEqual((exchange.market['selection'], exchange.market['dataset']), ([first], None))

    def test_library_survives_new_session_and_locks_during_a_session(self):
        with TestClient(exchange.app) as client:
            uploaded = client.post('/api/dataset?filename=niche.json', content=json.dumps(examples('U', 40)))
            self.assertEqual(uploaded.status_code, 200)
            file_id = exchange.market['selection'][0]
            self.assertEqual(exchange.worksheets[0]['origin'], 'uploaded')
            exchange.market['round'] = 1
            self.assertEqual(client.put('/api/library/selection', json={'ids': []}).status_code, 409)
            self.assertEqual(client.delete(f'/api/library/{file_id}').status_code, 409)
            response, _ = self.convert(client, dict(examples=examples('L', 20)))
            self.assertFalse(response.json()['selected'])
            self.assertEqual(exchange.market['selection'], [file_id])
            self.assertEqual(client.post('/api/reset').status_code, 200)
            self.assertEqual((len(exchange.worksheets), exchange.market['selection'], exchange.market['dataset']), (2, [], None))
            self.assertEqual(exchange.storage.read_local(exchange.WORKSHEETS)[1]['id'], file_id)

    def test_quota_errors_explain_when_to_retry(self):
        import httpx
        body = {'error': {'status': 'RESOURCE_EXHAUSTED', 'details': [{'retryDelay': '17500s'}]}}
        error = httpx.HTTPStatusError('quota', request=httpx.Request('POST', 'https://example.test'), response=httpx.Response(429, json=body))
        with TestClient(exchange.app) as client, patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key', 'GEMINI_CONVERT_MODEL': 'gemini-test'}), \
             patch.object(exchange, 'ask', AsyncMock(side_effect=error)) as gemini:
            response = client.post('/api/library/convert', json=dict(filename='w.pdf', data=base64.b64encode(b'%PDF').decode()))
        self.assertEqual(response.status_code, 429)
        self.assertNotIn('Gemini', response.json()['detail'])
        self.assertIn('4 h 52 min', response.json()['detail'])
        self.assertEqual(gemini.call_args.kwargs['model'], 'gemini-test')

    def test_structured_files_skip_parsing_and_text_files_are_parsed(self):
        def send(client, filename, content, reply=None):
            with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch.object(exchange, 'ask', AsyncMock(return_value=reply)) as gemini:
                response = client.post('/api/library/convert', json=dict(filename=filename, data=base64.b64encode(content.encode()).decode()))
            return response, gemini

        with TestClient(exchange.app) as client:
            response, gemini = send(client, 'set.json', json.dumps(dict(name='Kept', tolerance=0.5, examples=examples('J', 20))))
            self.assertEqual(response.status_code, 200)
            gemini.assert_not_called()
            entry = exchange.worksheets[0]
            self.assertEqual((entry['name'], entry['count'], entry['scoring'], entry['tolerance']), ('Kept', 20, 'numeric', 0.5))
            response, gemini = send(client, 'rows.jsonl', '\n'.join(json.dumps(r) for r in examples('L', 3, lambda i: f'word {i}')))
            gemini.assert_not_called()
            self.assertEqual(response.json()['entry']['scoring'], 'exact')
            response, gemini = send(client, 'sheet.csv', 'Question,Answer\nWhat is 2 + 2?,4\nWhat is 3 + 3?,6\n')
            gemini.assert_not_called()
            self.assertEqual(response.json()['entry']['count'], 2)
            reply = dict(name='Notes', examples=examples('M', 2))
            response, gemini = send(client, 'notes.md', '# Quiz\n1. What is 2 + 2?', reply)
            self.assertIn('# Quiz', gemini.call_args.args[0])
            self.assertIsNone(gemini.call_args.kwargs['attachment'])
            response, gemini = send(client, 'other.json', json.dumps({'items': [{'prompt': 'Name a prime', 'solution': 7}]}), reply)
            gemini.assert_called_once()
            self.assertEqual(send(client, 'empty.json', json.dumps([{'question': '', 'answer': ''}]))[0].status_code, 422)

    def test_worksheet_content_never_reaches_the_database(self):
        async def no_wait(_):
            pass

        async def no_operation(state):
            pass

        with TestClient(exchange.app) as client:
            self.convert(client, dict(name='Private', examples=examples('Secret', 24)))
            with patch.object(exchange.asyncio, 'sleep', no_wait), patch.object(exchange, 'trading', no_operation), patch.object(exchange, 'analyze', no_operation):
                import asyncio
                async def run():
                    await exchange.start_round(exchange.StartRequest(mode='demo', rounds=1))
                    await exchange.task
                asyncio.run(run())
        self.assertEqual(exchange.market['phase'], 'complete')
        self.assertIn('Secret question', json.dumps(exchange.market))
        # Both the active market row and the completed-round archive are free of worksheet text.
        with exchange.storage.connection(exchange.DB) as (db, _, _postgres):
            stored = [row[0] for row in db.execute('SELECT state FROM exchange_market').fetchall()] + \
                     [row[0] for row in db.execute('SELECT data FROM exchange_rounds').fetchall()]
        self.assertTrue(stored)
        self.assertTrue(all('Secret question' not in row for row in stored))
        self.assertTrue(all('library' not in json.loads(row) for row in stored))
        # The local files keep everything, so a restart restores questions and answers.
        self.assertEqual(oct(os.stat(exchange.WORKSHEETS).st_mode & 0o777), '0o600')
        restored = exchange.restore()
        self.assertEqual(len(restored['dataset']['problems']), 24)
        self.assertIn('Secret question', restored['workers'][0]['answers'][0]['question'])
        # Without the local market copy, questions are rebuilt from the saved worksheets.
        os.remove(exchange.LOCAL_MARKET)
        self.assertEqual(len(exchange.restore()['dataset']['problems']), 24)


if __name__ == '__main__':
    unittest.main()
