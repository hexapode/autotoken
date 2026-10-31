"""Linear-time adapters for recorded mini-SWE chat and Responses trajectories.

Only parses inert JSON. An assistant message or native Responses object is one
model call; its tool outputs align by ID only until the next model call. Native
Anthropic cache-exclusive usage requires a separate adapter and is rejected.
"""
import json
from pathlib import Path


def _mapping(value, where):
    if not isinstance(value, dict):
        raise ValueError(f'{where} must be an object')
    return value


def _sequence(value, where):
    if not isinstance(value, list):
        raise ValueError(f'{where} must be an array')
    return value


def load_record(path):
    """Load one JSON trajectory; structural errors never become empty traces."""
    try:
        with Path(path).open(encoding='utf-8') as source:
            record = json.load(source)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Invalid trajectory JSON') from exc
    _mapping(record, 'trajectory')
    _sequence(record.get('messages'), 'trajectory.messages')
    return record


def usage_fields(usage):
    """Same normalized fields as estimate-recorded-usage.py; cache is a subset.

Missing/invalid integer totals produce None, preserving unknown usage rather
than inventing zero. Malformed detail objects fail explicitly.
"""
    if not isinstance(usage, dict):
        return None
    if ('input_tokens' in usage and 'prompt_tokens' not in usage
            and ('cache_read_input_tokens' in usage or 'cache_creation_input_tokens' in usage)):
        raise ValueError('Native Anthropic input excludes cache: explicit adapter required')
    inp = usage.get('input_tokens', usage.get('prompt_tokens'))
    out = usage.get('output_tokens', usage.get('completion_tokens'))
    if any(type(value) is not int or value < 0 for value in (inp, out)):
        return None
    details = usage.get('input_tokens_details') or usage.get('prompt_tokens_details') or {}
    output_details = usage.get('output_tokens_details') or usage.get('completion_tokens_details') or {}
    _mapping(details, 'usage input details')
    _mapping(output_details, 'usage output details')
    return {
        'inputTokens': inp, 'outputTokens': out, 'totalTokens': inp + out,
        'cachedInputTokens': usage.get('cache_read_input_tokens', details.get('cached_tokens')),
        'cacheCreationInputTokens': usage.get('cache_creation_input_tokens', details.get('cache_creation_tokens')),
        'reasoningOutputTokens': output_details.get('reasoning_tokens'),
    }


def _call_id(value):
    if value is not None and not isinstance(value, (str, int, float, bool)):
        raise ValueError('Tool-call ID must be a scalar or null')
    return value


def normalize(record):
    """Return turns compatible with estimate-recorded-usage.normalize.

Visits each message and action once, plus each emitted result association.
Duplicate call IDs preserve the old adapter's associations without rescanning
message suffixes. Message boundaries reset the current result-alignment scope.
    """
    _mapping(record, 'trajectory')
    messages = _sequence(record.get('messages'), 'trajectory.messages')
    turns = []
    current_actions = {}
    for index, message in enumerate(messages):
        _mapping(message, f'messages[{index}]')
        is_response = message.get('object') == 'response'
        if not is_response and message.get('role') != 'assistant':
            content = message.get('output', message.get('content', ''))
            if not isinstance(content, str):
                continue
            ids = {_call_id(message.get('call_id')), _call_id(message.get('tool_call_id'))}
            for call_id in ids:
                if call_id is not None:
                    for action in current_actions.get(call_id, ()):
                        action['results'].append(content)
            continue

        current_actions = {}
        extra = _mapping(message.get('extra', {}), f'messages[{index}].extra')
        response = message if is_response else _mapping(extra.get('response', {}), 'extra.response')
        raw_usage = response.get('usage')
        usage = usage_fields(raw_usage)
        if is_response:
            output = _sequence(message.get('output', []), 'response.output')
            raw_calls = []
            for item in output:
                _mapping(item, 'response.output item')
                if item.get('type') == 'function_call':
                    raw_calls.append(item)
        else:
            raw_calls = _sequence(message.get('tool_calls', []), 'assistant.tool_calls')
        actions = []
        for raw in raw_calls:
            _mapping(raw, 'tool call')
            function = raw if is_response else _mapping(raw.get('function', {}), 'tool call.function')
            arguments = function.get('arguments', {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except ValueError:
                    arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            action = {'name': function.get('name'), 'command': arguments.get('command'), 'results': []}
            actions.append(action)
            call_id = _call_id(raw.get('call_id') if is_response else raw.get('id'))
            if call_id is not None:
                current_actions.setdefault(call_id, []).append(action)
        cost = extra.get('cost')
        turns.append({
            'ordinal': len(turns), 'actions': actions, 'usage': usage,
            'reportedCost': cost if type(cost) in (int, float) and cost >= 0 else None,
            'sourceMessageIndex': index,
            'usageFormat': 'responses_input_output' if is_response else
                'chat_prompt_completion' if isinstance(raw_usage, dict) and 'prompt_tokens' in raw_usage else 'unknown',
        })
    return turns
