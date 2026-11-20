from collections import Counter
from pathlib import Path
import json
import re
notes=Path('/workspace/run-notes')
for name in ['python','extra','desktop','mobile']:
    path = notes / ('crm_baseline_' + name + '.jsonl')
    events = Counter()
    if path.exists():
        for line in path.read_text().splitlines():
            event,test=json.loads(line)
            events[event]+=1
    log=(notes / ('baseline-' + name + '.log')).read_text(errors='replace')
    if name in ('desktop','mobile'):
        js_started = re.findall(r'\[HOOT\] Running test "(.*)"',log)
        js_failed = re.findall(r'\[HOOT\] Test "(.*)" failed',log)
        print(name,'JS started',len(js_started),'failure IDs seen',len(set(js_failed)), 'summary', re.findall(r'\[HOOT\] (?:Passed|Failed) .*?tests \([^\n]+',log)[-1:])
    else:
        print(name,dict(events),'last module', re.findall(r'Loading module (\w+ \(\d+/\d+\))',log)[-1:])
