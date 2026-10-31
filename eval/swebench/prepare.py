"""Pin and prepare a task. Evaluation-only data stays on the host."""
import argparse
import json
from pathlib import Path
from datasets import load_dataset
from huggingface_hub import HfApi


def public_task(row):
    return {key: row[key] for key in ("instance_id", "repo", "base_commit", "problem_statement", "image", "version") if key in row}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', default='SWE-bench/SWE-bench_Lite')
    parser.add_argument('--split', default='dev')
    parser.add_argument('--instance', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--public-only', action='store_true')
    parser.add_argument('--revision')
    args = parser.parse_args()
    revision = args.revision or HfApi().dataset_info(args.dataset).sha
    rows = load_dataset(args.dataset, split=args.split, revision=revision)
    row = next((dict(row) for row in rows if row['instance_id'] == args.instance), None)
    if row is None:
        raise ValueError(f'{args.instance} not found in {args.dataset}/{args.split}')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # Never pass hints, gold patch, evaluation script, test patch or test IDs to Pi.
    task = public_task(row)
    task.update(dataset=args.dataset, split=args.split, revision=revision)
    (out / 'task.json').write_text(json.dumps(task, indent=2))
    row.pop('patch', None)
    row.pop('hints_text', None)
    if not args.public_only:
        (out / 'evaluator-dataset.json').write_text(json.dumps([row], indent=2))
    print(json.dumps(task))


if __name__ == '__main__':
    main()
