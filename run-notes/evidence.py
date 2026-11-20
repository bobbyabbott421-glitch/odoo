"""Summarize baseline executions without counting retries or framework wrappers as additional cases."""
import json, re
from collections import Counter, defaultdict
from pathlib import Path

notes = Path(__file__).resolve().parent
rows = []
states = {}
all_failed = set()
def read_events(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
for group in ('python', 'extra'):
    cases = {}
    attempts = Counter()
    for suffix in ('', '_remaining'):
        run = 'crm_baseline_' + group + suffix
        for op,test,*args in read_events(notes / (run + '.jsonl')):
            if op == 'collected':
                cases.setdefault(test, 'collected')
            elif op == 'startTest':
                cases[test] = 'running'
                attempts[test] += 1
            elif op in ('addSuccess','addSkip','addFailure','addError'):
                # Subtest failures include a description after the parent test ID.
                parent = test.split(' ',1)[0] if test not in cases else test
                if op in ('addFailure','addError'):
                    all_failed.add(test)
                cases[parent] = {'addSuccess':'pass','addSkip':'skip','addFailure':'fail','addError':'error'}[op]
    print(group, len(cases), 'collected;', sum(attempts.values()), 'starts incl. retries;',dict(Counter(cases.values())))
    states[group] = cases
for group in ('desktop','mobile','embed'):
    log = (notes / ('baseline-'+group+'.log')).read_text()
    summary = re.findall(r'\[HOOT\] (?:Failed \d+ tests \(\d+ passed|Passed \d+ tests \(\d+ assertions), total time: [^\n]+',log)
    failure_ids = re.findall(r'\[HOOT\] Test "(.*?)" failed:',log)
    root_counts = {}
    for module,result in re.findall(r'\[HOOT\] "(@[^/"]+)" ended \(([^)]+)\)',log):
        root_counts[module] = {k:int(v) for k,v in re.findall(r'(passed|failed|skipped): (\d+)',result)}
    print(group,summary[-1:] or 'in progress',root_counts)
    states[group] = {'modules':root_counts,'summary':summary[-1:], 'failed_ids':sorted(set(failure_ids))}
states['python_failed_ids'] = sorted(all_failed)
(notes/'baseline-evidence.json').write_text(json.dumps(states,indent=2))
