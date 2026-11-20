from pathlib import Path
from collections import Counter
import json,re
n=Path(__file__).parent
before=Counter()
after=Counter()
for suite in ['python','extra']:
    resumed=[json.loads(line) for line in (n/('crm_baseline_'+suite+'_remaining.jsonl')).read_text().splitlines()]
    replaced={r[1] for r in resumed if r[0]=='collected'}
    oldrows=[row for row in json.loads((n/'baseline-tours.json').read_text()) if row['suite']==suite and row['method'] not in replaced]
    tracker={}
    for line in (n/('baseline-'+suite+'.log')).read_text().splitlines():
        if start:=re.search(r''' (odoo\.addons\.\S+?): Evaluate ready code "odoo\.isTourReady\('([^']+)'\)''',line):
            case,name=start.groups()
            if case not in replaced:
                tracker[case]=name
                before[case,name,'failure']+=1
        if stop:=re.search(r' (odoo\.addons\.\S+)\.browser: tour succeeded\s*$',line):
            case=stop.group(1)
            if name:=tracker.pop(case,None):
                before[case,name,'failure']-=1
                before[case,name,'success']+=1
    for dest,rows in [(before,resumed),(after,[json.loads(line) for line in (n/('crm_final_'+suite+'.jsonl')).read_text().splitlines()])]:
        for event,case,*args in rows:
            if event in ('tour_failure','tour_success'):
                dest[case,args[0],event.removeprefix('tour_')]+=1
def tot(counter):
    ret=Counter()
    for (case,name,state),v in counter.items():
        ret[state]+=v
    return dict(ret)
def byname(counter):
    out=Counter()
    for (case,name,state),v in counter.items():
        out[(case,name)]+=v
    return out
report={'baseline':tot(before),'head':tot(after),'missing':[list(k)+[v] for k,v in (byname(before)-byname(after)).items()],
        'added':[list(k)+[v] for k,v in (byname(after)-byname(before)).items()],
        'new_failures':[list(k)+[v] for k,v in (after-before).items() if k[2]=='failure']}
(n/'tour-comparison.json').write_text(json.dumps(report,indent=2))
print(report)
