from pathlib import Path
import json,re
from collections import Counter
n=Path(__file__).parent
for suite in ('python','extra'):
    records=[json.loads(row) for row in (n/('crm_final_'+suite+'.jsonl')).read_text().splitlines()]
    statuses={}
    for event,case,*extra in records:
        name=case.split(' ',1)[0]
        if event.startswith('add'):statuses[name]=event
    starts=[r[1] for r in records if r[0]=='startTest']
    print(suite, len(statuses), 'started', len(starts),starts[-1].split('.')[-1])
for file in ['head-desktop-apps','head-desktop-core','head-desktop-views','quiet-embed','quiet-calendar','quiet-mobile','quiet-scale-base','quiet-scale-head']:
    p=n/(file+'.log')
    if p.exists():
        log=p.read_text(errors='replace')
        print(file, log.count('[HOOT] Running test'), re.findall(r'\[HOOT\] (?:Passed|Failed) \d+ tests[^\n]+',log)[-1:] or log.splitlines()[-1][-52:])
