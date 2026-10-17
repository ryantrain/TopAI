"""Devnet proof of a simulated round, never token trading or custody."""
import hashlib
import json

import httpx

DEVNET = 'https://api.devnet.solana.com'
MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def statement(state):
    return dict(version=1, session_id=state['session_id'], round=state['round'], mode=state['mode'],
                configuration=state['configuration'],
                scores=[dict(id=w['id'], scores=[s for s in w['scores'] if s['round'] == state['round']]) for w in state['workers']],
                trades=[t for t in state['trades'] if t['round'] == state['round']],
                settlement=state['settlements'][-1],
                portfolios=[{k: t[k] for k in ('id', 'cash', 'pnl')} for t in state['traders']])


def prepare(state):
    data = statement(state)
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False)
    digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return dict(statement=data, canonical=canonical, digest=digest,
                memo=f'agent-exchange:v1:{state["session_id"]}:{state["round"]}:{digest}',
                cluster='devnet', rpc=DEVNET, program=MEMO_PROGRAM)


def decode_base58(text):
    value = 0
    for char in text:
        value = value * 58 + ALPHABET.index(char)
    return b'\0' * (len(text) - len(text.lstrip('1'))) + value.to_bytes((value.bit_length() + 7) // 8, 'big')


def verify_transaction(result, memo):
    if not isinstance(result, dict) or not isinstance(result.get('meta'), dict) or result['meta'].get('err') is not None:
        raise ValueError('Transaction was not confirmed successfully')
    message = result['transaction']['message']
    keys = message['accountKeys']
    for instruction in message['instructions']:
        if keys[instruction['programIdIndex']] == MEMO_PROGRAM and decode_base58(instruction['data']) == memo.encode():
            return keys[0]
    raise ValueError('Transaction does not contain the expected round receipt')


async def verify(signature, memo):
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(DEVNET, json={'jsonrpc': '2.0', 'id': 1, 'method': 'getTransaction',
            'params': [signature, {'encoding': 'json', 'commitment': 'confirmed', 'maxSupportedTransactionVersion': 0}]})
        response.raise_for_status()
        result = response.json()
    if result.get('error') or not result.get('result'):
        raise ValueError('Devnet confirmation is not available yet. Retry verification without signing again.')
    payer = verify_transaction(result['result'], memo)
    return dict(signature=signature, wallet=payer, cluster='devnet',
                explorer=f'https://explorer.solana.com/tx/{signature}?cluster=devnet')
