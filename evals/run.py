#!/usr/bin/env python3
"""Run fixed router evals through authenticated gateway RPC, never execute prompts."""
import argparse, concurrent.futures, datetime, json, subprocess, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--cases', default=str(Path(__file__).with_name('cases.json')))
parser.add_argument('--output', required=True)
parser.add_argument('--repeats', type=int, default=3)
parser.add_argument('--workers', type=int, default=2)
args = parser.parse_args()
cases = json.loads(Path(args.cases).read_text())

def run(item):
    case, repeat = item
    params = {key: case[key] for key in ['prompt', 'recent', 'facts'] if key in case}
    started = time.monotonic()
    p = subprocess.run(['openclaw', 'gateway', 'call', 'model-router.evaluate', '--params', json.dumps(params), '--json', '--timeout', '20000'], capture_output=True, text=True, timeout=35)
    try:
        result = json.loads(p.stdout)
    except ValueError:
        result = {'ok': False, 'error': 'RPC_ERROR', 'exitCode': p.returncode}
    failures = []
    if not result.get('ok'):
        failures.append(result.get('error', 'CLASSIFIER_ERROR'))
    else:
        if result['route']['profile'] not in case['profiles']:
            failures.append('profile:' + result['route']['profile'])
        for key, expected in case.get('checks', {}).items():
            if result['assessment'].get(key) != expected:
                failures.append(f'{key}:{result["assessment"].get(key)}')
        for key, (low, high) in case.get('ranges', {}).items():
            value = result['assessment'].get(key)
            if not isinstance(value, (int, float)) or not low <= value <= high:
                failures.append(f'{key}:{value}')
    return {'id': case['id'], 'group': case['group'], 'repeat': repeat, 'expected': {k:case[k] for k in ['profiles','checks','ranges'] if k in case}, 'passed': not failures, 'failures': failures, 'wallMs': round((time.monotonic()-started)*1000), 'result': result}

jobs = [(case, repeat) for repeat in range(1, args.repeats+1) for case in cases]
with Path(args.output).open('w') as out, concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
    for result in pool.map(run, jobs):
        out.write(json.dumps(result)+'\n');out.flush()
        print(json.dumps({k:result[k] for k in ['id','repeat','passed','failures']}), flush=True)
