import json
from pathlib import Path
from lxml import etree
lead = env['crm.lead'].with_user(env.ref('base.user_admin'))
out = {}
for kind,xid in [('form','crm.crm_lead_view_form'),('kanban','crm.crm_case_kanban_view_leads')]:
    view = env.ref(xid,raise_if_not_found=False)
    arch = etree.fromstring(lead.get_view(view_id=view.id if view else None,view_type=kind)['arch'])
    out[kind] = {
        'buttons':[dict(node.attrib) for node in arch.xpath('//button')],
        'fields':sorted({node.get('name') for node in arch.xpath('//field[@name]')}),
        'widgets':sorted({node.get('name') for node in arch.xpath('//widget[@name]')}),
    }
Path('/workspace/run-notes/crm-view-inventory.json').write_text(json.dumps(out,indent=2))
for kind in out:
    print(kind, sorted({(n.get('name',''),n.get('string') or n.get('title') or '') for n in out[kind]['buttons']}))
