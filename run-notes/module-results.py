from collections import Counter,defaultdict
from pathlib import Path
import json,re
n=Path(__file__).parent
base=json.loads((n/'baseline-evidence.json').read_text())
head=json.loads((n/'final-evidence.json').read_text())
modules=(n/'modules.txt').read_text().strip().split(',')
def addon(case):
    return case.split('.')[2]
def cases(states):
    result=defaultdict(Counter)
    for case,state in states.items():
        result[addon(case)][state]+=1
    return result
def javascript(files):
    result=defaultdict(Counter)
    for path in files:
        if not path.exists():continue
        for module,total in re.findall(r'\[HOOT\] "@([a-z_]+)" ended \(([^)]+)\)',path.read_text()):
            for kind,count in re.findall(r'(passed|failed): (\d+)',total):
                result[module]['pass' if kind=='passed' else 'fail']+=int(count)
    return result
def tours(before):
    result=defaultdict(Counter)
    if before:
        for row in json.loads((n/'baseline-tours.json').read_text()):
            result[addon(row['method'])].update({'pass':row['passed'],'fail':row['failed']})
    else:
        for name in ['python','extra']:
            for p in n.glob('crm_final_'+name+'*.jsonl'):
                for line in p.read_text().splitlines():
                    event,case,*extras=json.loads(line)
                    if event in ('tour_success','tour_failure'):
                        result[addon(case)]['pass' if event=='tour_success' else 'fail']+=1
    return result
def cell(count):
    if not sum(count.values()):return '—'
    return f"{sum(count.values())}/{count['pass']}/{count['fail']+count['error']}/{count['skip']}"
def section(label, groups):
    text=['## '+label,'','| Module | Standard Python | Nonstandard Python | Desktop HOOT | Mobile HOOT | Tour invocations |',
          '| --- | ---: | ---: | ---: | ---: | ---: |']
    for module in modules:
        text.append('| '+' | '.join([module]+[cell(group[module]) for group in groups])+' |')
    return '\n'.join(text)
mobile = n/('quiet-mobile.log' if (n/'quiet-mobile.log').exists() and 'odoo.tests.result:' in (n/'quiet-mobile.log').read_text() else 'final-mobile.log')
doc=['# CRM verification by installed module','',
    'Each cell gives collected / passed / failed or errored / skipped. A dash means the preset reported no case owned by that module. The module was installed and included in discovery. Cross-module tests appear under their declaring module. Browser tours also count in their enclosing Python method. The separately selected embedded livechat suite and HOOT self-tests are in the main report.','',
    section('Unchanged base',[cases(base['python']),cases(base['extra']),javascript([n/'baseline-desktop.log']),javascript([n/'baseline-mobile.log']),tours(True)]),'',
    section('Branch suites',[cases(head['python']['states']),cases(head['extra']['states']),javascript(sorted(n.glob('head-desktop-*.log'))),javascript([mobile]),tours(False)]),'']
(n/'module-results.md').write_text('\n'.join(doc))
