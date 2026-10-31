"""Public discovery task inventory; never exports gold/test patches or hints."""
import json
from pathlib import Path
from datasets import load_dataset
from huggingface_hub import HfApi
from prepare import public_task

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    args = p.parse_args()
    dataset = 'princeton-nlp/SWE-bench'
    revision = HfApi().dataset_info(dataset).sha
    rows = load_dataset(dataset, split='dev', revision=revision)
    groups = {}
    for row in rows:
        if row['repo'] in ['marshmallow-code/marshmallow', 'pydicom/pydicom', 'pylint-dev/astroid']:
            groups.setdefault(row['repo'], []).append(public_task(row))
    # Interleave repositories; one rollout per issue, never pad with duplicates.
    tasks = []
    for group in groups.values():
        group.sort(key=lambda t: t['instance_id'])
    while any(groups.values()):
        for group in groups.values():
            if group:
                tasks.append(group.pop(0))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x') as f:
        json.dump(dict(dataset=dataset, revision=revision, split='dev', purpose='discovery-only', tasks=tasks), f, indent=2)
    print(json.dumps(dict(tasks=len(tasks), repositories=len(groups), path=str(out))))
