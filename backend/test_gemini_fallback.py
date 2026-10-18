"""Gemini outages route to local inference without real model calls."""
import asyncio
import base64
import io
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from backend import providers


class GeminiFallbackCheck(unittest.TestCase):
    def test_missing_key_preserves_schema_and_usage(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': '', 'OLLAMA_MODEL': 'local-test'}), \
                patch.object(providers, 'ask_local', AsyncMock(return_value={'answers': [1], '_total_tokens': 20})) as local:
            result = asyncio.run(providers.ask('question', 'instruction', provider='gemini', model='gemini-test', with_usage=True, schema={'type': 'object'}))
        self.assertEqual(result['_total_tokens'], 20)
        local.assert_awaited_once_with('question', 'instruction', 'local-test', True, {'type': 'object'}, images=None, max_tokens=8192, timeout=90)

    def test_conversion_limits_reach_local_fallback(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), patch.object(providers, 'ask_local', AsyncMock(return_value={})) as local:
            asyncio.run(providers.ask('worksheet', 'extract', provider='gemini', max_tokens=32768, timeout=280))
        self.assertEqual(local.call_args.kwargs['max_tokens'], 32768)
        self.assertEqual(local.call_args.kwargs['timeout'], 280)

    def test_only_rate_limits_fall_back(self):
        real_client = httpx.AsyncClient
        for status in (429, 401, 500):
            with self.subTest(status=status), patch.dict(os.environ, {'GEMINI_API_KEY': 'test'}), \
                    patch.object(providers.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(lambda req: httpx.Response(status)), **kw)), \
                    patch.object(providers, 'ask_local', AsyncMock(return_value={'grades': []})) as local:
                if status == 429:
                    self.assertEqual(asyncio.run(providers.ask('q', 'grade', provider='gemini')), {'grades': []})
                    local.assert_awaited_once()
                else:
                    with self.assertRaises(httpx.HTTPStatusError):
                        asyncio.run(providers.ask('q', 'grade', provider='gemini'))
                    local.assert_not_called()

    def test_image_sent_to_local_model(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), patch.object(providers, 'ask_local', AsyncMock(return_value={})) as local:
            asyncio.run(providers.ask('read', 'extract', provider='gemini', attachment={'mime_type': 'image/png', 'data': 'base64image'}))
        self.assertEqual(local.call_args.kwargs['images'], ['base64image'])

    def test_pdf_text_and_scanned_pdf(self):
        from pypdf import PdfWriter
        # A minimal PDF containing a text stream, with no remote fixtures.
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 10 100 Td (Question one) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
        output = io.BytesIO()
        writer.write(output)
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), patch.object(providers, 'ask_local', AsyncMock(return_value={})) as local:
            asyncio.run(providers.ask('read', 'extract', provider='gemini', attachment={'mime_type': 'application/pdf', 'data': base64.b64encode(output.getvalue()).decode()}))
            self.assertIn('Question one', local.call_args.args[0])
            writer = PdfWriter()
            writer.add_blank_page(width=300, height=300)
            output = io.BytesIO()
            writer.write(output)
            with self.assertRaisesRegex(ValueError, 'no readable text'):
                asyncio.run(providers.ask('read', 'extract', provider='gemini', attachment={'mime_type': 'application/pdf', 'data': base64.b64encode(output.getvalue()).decode()}))
