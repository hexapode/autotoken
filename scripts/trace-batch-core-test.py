"""Run fixtures; optionally compare every file in a downloaded manifest."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from trace_batch_core import normalize, load_record, usage_fields

spec = importlib.util.spec_from_file_location('reference', Path(__file__).with_name('estimate-recorded-usage.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


def assistant(ids=('a',)):
    return {'role': 'assistant', 'tool_calls': [
        {'id': key, 'function': {'name': 'bash', 'arguments': '{"command":"echo ok"}'}} for key in ids],
        'extra': {'response': {'usage': {'prompt_tokens': 100, 'completion_tokens': 10}}, 'cost': .1}}


class CoreTests(unittest.TestCase):
    def test_out_of_order_duplicate_and_dual_ids_match_reference(self):
        record = {'messages': [assistant(('a', 'a', 'b')),
            {'role': 'tool', 'call_id': 'b', 'tool_call_id': 'a', 'content': 'both'},
            {'role': 'tool', 'call_id': 'a', 'tool_call_id': 'a', 'content': 'once'},
            {'role': 'tool', 'tool_call_id': 'b', 'content': 'b'}]}
        self.assertEqual(normalize(record), reference.normalize(record))
        self.assertEqual(normalize(record)[0]['actions'][0]['results'], ['both', 'once'])

    def test_next_model_call_resets_result_scope_even_if_no_actions(self):
        record = {'messages': [assistant(), {'role': 'assistant'}, {'role': 'tool', 'tool_call_id': 'a', 'content': 'late'}]}
        self.assertEqual(normalize(record), reference.normalize(record))
        self.assertEqual(normalize(record)[0]['actions'][0]['results'], [])

    def test_responses_multitool_is_one_call_and_aligns_exactly(self):
        record = {'messages': [{'object': 'response', 'usage': {'input_tokens': 120, 'output_tokens': 12}, 'output': [
            {'type': 'reasoning'}, {'type': 'function_call', 'call_id': 'a', 'name': 'bash', 'arguments': '{"command":"true"}'},
            {'type': 'function_call', 'call_id': 'b', 'name': 'bash', 'arguments': '{}'}]},
            {'type': 'function_call_output', 'call_id': 'b', 'output': 'b'},
            {'type': 'function_call_output', 'call_id': 'a', 'output': 'a'}]}
        self.assertEqual(normalize(record), reference.normalize(record))
        self.assertEqual(len(normalize(record)), 1)

    def test_unknown_arguments_and_nontext_results_match_reference(self):
        call = assistant();call['tool_calls'][0]['function']['arguments'] = 'bad-json'
        record = {'messages': [call, {'tool_call_id': 'a', 'content': [{'type': 'text', 'text': 'ignored'}]}]}
        self.assertEqual(normalize(record), reference.normalize(record))
        self.assertIsNone(normalize(record)[0]['actions'][0]['command'])

    def test_usage_no_cache_doublecount_and_native_anthropic_rejected(self):
        usage = {'prompt_tokens': 100, 'completion_tokens': 10, 'cache_read_input_tokens': 80, 'cache_creation_input_tokens': 15}
        self.assertEqual(usage_fields(usage), reference.usage_fields(usage))
        self.assertEqual(usage_fields(usage)['totalTokens'], 110)
        with self.assertRaises(ValueError):usage_fields({'input_tokens': 5, 'output_tokens': 3, 'cache_read_input_tokens': 80})
        self.assertIsNone(usage_fields({'prompt_tokens': True, 'completion_tokens': 3}))
        self.assertIsNone(usage_fields(None))

    def test_malformed_structure_fails_not_empty_trace(self):
        for record in [{}, {'messages': None}, {'messages': [None]}, {'messages': [{'role': 'assistant', 'tool_calls': None}]}, {'messages': [{'object': 'response', 'output': ['bad']}]}]:
            with self.assertRaises(ValueError):normalize(record)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'record.json';path.write_text('{}')
            with self.assertRaises(ValueError):load_record(path)

    def test_large_fixture_keeps_one_pass_results(self):
        messages = []
        for i in range(5000):messages.extend([assistant((str(i),)), {'tool_call_id': str(i), 'content': str(i)}])
        turns = normalize({'messages': messages})
        self.assertEqual(len(turns), 5000)
        self.assertEqual(turns[-1]['actions'][0]['results'], ['4999'])


def verify_manifest(manifest_path):
    manifest_path = Path(manifest_path);manifest = json.loads(manifest_path.read_text())
    count = calls = 0;old_seconds = new_seconds = 0
    for file in manifest['files']:
        filename = file.get('local') or str(manifest_path.parent / file.get('path', ''))
        if not filename.endswith('.traj.json'):continue
        record = load_record(filename)
        start = time.perf_counter();expected = reference.normalize(record);old_seconds += time.perf_counter() - start
        start = time.perf_counter();actual = normalize(record);new_seconds += time.perf_counter() - start
        if actual != expected:raise AssertionError(f'Normalization differs for trajectory {count}')
        count += 1;calls += len(actual)
    print(json.dumps({'exactComparisonFiles': count, 'modelCalls': calls, 'referenceSeconds': old_seconds, 'linearSeconds': new_seconds}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--manifest');args, unittest_args = parser.parse_known_args()
    result = unittest.main(argv=[sys.argv[0], *unittest_args], exit=False)
    if not result.result.wasSuccessful():raise SystemExit(1)
    if args.manifest:verify_manifest(args.manifest)
