"""Count calls to Odoo HttpCase.start_tour, with browser success signals for the first runs."""
import json
import re
from collections import Counter,defaultdict
from pathlib import Path
notes=Path(__file__).resolve().parent
rows=[]
for suite in ('python','extra'):
    resumed_path=notes / ('crm_baseline_'+suite+'_remaining.jsonl')
    resumed=[json.loads(l) for l in resumed_path.read_text().splitlines()] if resumed_path.exists() else []
    resumed_cases={row[1] for row in resumed if row[0]=='collected'}
    events=[json.loads(l) for l in (notes / ('crm_baseline_'+suite+'.jsonl')).read_text().splitlines()]
    log=(notes / ('baseline-'+suite+'.log')).read_text()
    tours=Counter(test for event,test in events if event=='start_tour' and test not in resumed_cases)
    for case,n in tours.items():
        starts=re.findall(re.escape(case)+r''': Evaluate ready code "odoo\.isTourReady\('([^']+)'\)''',log)
        wins=len(re.findall(re.escape(case)+r'\.browser: tour succeeded\s*$',log,re.M))
        rows.append({'method':case,'suite':suite, 'invoked':n,'passed':min(wins,n),'failed':max(0,n-wins),'tour_names':starts})
    for event in resumed:
        if event[0] in ('tour_success','tour_failure'):
            rows.append({'method':event[1],'suite':suite,'invoked':1,'passed':int(event[0]=='tour_success'),'failed':int(event[0]=='tour_failure'),'tour_names':[event[2]]})
print({k:sum(row[k] for row in rows) for k in ('invoked','passed','failed')})
print('tour-bearing methods run',len({r['method'] for r in rows}))
(notes/'baseline-tours.json').write_text(json.dumps(rows,indent=2))
