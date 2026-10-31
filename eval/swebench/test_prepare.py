import unittest
from prepare import public_task


class PrepareTest(unittest.TestCase):
    def test_only_public_fields_reach_task(self):
        row = dict(instance_id='a__b-1', repo='a/b', base_commit='abc', problem_statement='bug', image='image', patch='gold', test_patch='tests', eval_script='secret', hints_text='hint', FAIL_TO_PASS=['test'])
        self.assertEqual(set(public_task(row)), {'instance_id', 'repo', 'base_commit', 'problem_statement', 'image'})


if __name__ == '__main__':
    unittest.main()
