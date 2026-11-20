from pathlib import Path
from collections import Counter
import json,re
n=Path(__file__).parent
baseline=json.loads((n/'baseline-evidence.json').read_text())
evidence=json.loads((n/'final-evidence.json').read_text())
out={}
for suite in ('desktop','mobile','embed'):
    files=sorted(n.glob('head-desktop-*.log')) if suite=='desktop' else [n/('final-'+suite+'.log')]
    quiet=n/('quiet-'+suite+'.log')
    if quiet.exists() and 'odoo.tests.result:' in quiet.read_text(errors='replace'):
        files=[quiet]
    raw='\n'.join(f.read_text(errors='replace') for f in files)
    prev=(n/('baseline-'+suite+'.log')).read_text()
    def cases(log):
        return Counter(re.findall(r'\[HOOT\] Running test "(.*)"\s*$',log,re.M))
    bc = cases(prev)
    fc = cases(raw)
    wins=re.findall(r'\[HOOT\] Passed (\d+) tests',raw)
    mix=re.findall(r'\[HOOT\] Failed (\d+) tests \((\d+) passed',raw)
    passed = sum(map(int,wins)) + sum(int(ok) for _,ok in mix)
    failed = sum(int(ko) for ko,_ in mix)
    out[suite]={'started':sum(fc.values()),'passed':passed,'failed':failed,
                'missing_with_multiplicities':dict(bc-fc),'added_with_multiplicities':dict(fc-bc),
                'failed_ids':evidence[suite]['failed'],'new_failed_ids':evidence[suite]['new_failed']}
all_tours=[]
for suite in ('python','extra'):
    rows=[]
    for path in sorted(n.glob('crm_final_'+suite+'*.jsonl')):
        rows.extend(json.loads(line) for line in path.read_text().splitlines())
    tours=[r for r in rows if r[0] in ('tour_success','tour_failure')]
    all_tours+=tours
    out[suite]={'totals':evidence[suite]['totals'],'total_collected':len(evidence[suite]['states']),
                'missing':evidence[suite]['missing'],'new_failures_or_skips':evidence[suite]['new_failed_or_skipped'],
                'new_subfailures':evidence[suite]['new_subfailures'],'tours':dict(Counter(r[0] for r in tours))}
out['tours']={'actual':dict(Counter(r[0] for r in all_tours)),
              'failures':[[r[1],r[2]] for r in all_tours if r[0]=='tour_failure']}
previous=json.loads((n/'baseline-tours.json').read_text())
out['tours']['new_failure_methods']=sorted({r[1] for r in all_tours if r[0]=='tour_failure'} - {r['method'] for r in previous if r['failed']})
(n/'acceptance-counts.json').write_text(json.dumps(out,indent=2))
for k,r in out.items():
 print(k, {f:v for f,v in r.items() if f in ('started','passed','failed','totals','total_collected','actual','new_failure_methods')}, 'missing',len(r.get('missing',r.get('missing_with_multiplicities',{}))))
