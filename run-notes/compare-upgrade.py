from pathlib import Path
import json
n=Path(__file__).parent
b=json.loads((n/'base-records-before.json').read_text())
a=json.loads((n/'base-records-after.json').read_text())
def rows(values):
    return {tuple(x) if isinstance(x,list) else x for x in values}
removed={k:sorted(rows(v)-rows(a.get(k,[])),key=str) for k,v in b.items() if rows(v)-rows(a.get(k,[]))}
summary={'before_tables':len(b)-2,'after_tables':len(a)-2,'new_tables':sorted(a.keys()-b.keys()),
         'changed_ids_or_values':removed,
         'crm_leads_identical':a['@crm_lead_values']==b['@crm_lead_values'],
         'crm_external_ids_preserved':not (rows(b['@external_ids'])-rows(a['@external_ids']))}
(n/'upgrade-comparison.json').write_text(json.dumps(summary,indent=2))
print({k:v for k,v in summary.items() if k!='changed_ids_or_values'})
print('Missing initial IDs or values', {k:len(v) for k,v in removed.items()})
