"""Compare independently logged tests by ID. Incomplete suites remain marked incomplete."""
from collections import Counter
import json
from pathlib import Path
import re

notes = Path(__file__).parent
base = json.loads((notes/'baseline-evidence.json').read_text())
data = {}
for suite in ('python', 'extra'):
    cases = {}
    tours = {}
    subfail = set()
    for f in sorted(notes.glob('crm_final_'+suite+'*.jsonl')):
        for line in f.read_text().splitlines():
            event, case, *extra = json.loads(line)
            if event == 'collected':
                cases.setdefault(case,'collected')
            elif event.startswith('add'):
                result = {'addSuccess':'pass','addSkip':'skip','addError':'error','addFailure':'fail'}[event]
                cases[case.split(' ',1)[0]] = result
                if result in ('error','fail'): subfail.add(case)
            elif event in ('tour_success','tour_failure'):
                tour = extra[0]
                tours[case+'#'+tour] = event.removeprefix('tour_')
    data[suite] = {'totals': dict(Counter(cases.values())), 'missing':sorted(set(base[suite])-cases.keys()),
                   'new_failed_or_skipped':[k for k,v in cases.items() if v in ('fail','error','skip') and base[suite].get(k) not in ('fail','error','skip')],
                   'new_subfailures':sorted(subfail-set(base['python_failed_ids'])),
                   'added':sorted(cases.keys()-base[suite].keys()), 'states':cases, 'tours':tours}
for suite in ('desktop','mobile','embed'):
    f = notes/('final-'+suite+'.log')
    quiet=notes/('quiet-'+suite+'.log')
    if quiet.exists() and 'odoo.tests.result:' in quiet.read_text(errors='replace'):
        f=quiet
    files = sorted(notes.glob('head-desktop-*.log')) if suite == 'desktop' else [f]
    raw = '\n'.join(f.read_text(errors='replace') for f in files if f.exists())
    log_before = (notes/('baseline-'+suite+'.log')).read_text()
    def seen(log):
        return set(re.findall(r'\[HOOT\] Running test "(.*?)"\s*$',log,re.M))
    failed = set(re.findall(r'\[HOOT\] Test "(.*?)" failed:',raw))
    old = seen(log_before)
    current = seen(raw)
    data[suite] = {'seen': len(current),'missing':sorted(old-current),'added':sorted(current-old),
                   'failed':sorted(failed),'new_failed':sorted(failed-set(base[suite]['failed_ids'])),
                   'summary':re.findall(r'\[HOOT\] (?:Failed|Passed) \d+ tests \([^\n]+',raw)}
(notes/'final-evidence.json').write_text(json.dumps(data,indent=2))
for suite, result in data.items():
    print(suite, result.get('totals') or result.get('summary') or 'incomplete', 'missing',len(result['missing']),
          'new failures',result.get('new_failed',result.get('new_failed_or_skipped')))
