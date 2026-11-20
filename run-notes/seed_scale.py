lead = env['crm.lead'].with_context(tracking_disable=True, mail_create_nosubscribe=True)
rep = env.ref('base.user_admin')
team = env['crm.team'].search([('company_id','in',[False,rep.company_id.id])],limit=1)
stages = env['crm.stage'].search(['|',('team_ids','=',False),('team_ids','in',[team.id])], order='sequence,id')
assert team and stages
scope = [('type','=','opportunity'),('user_id','=',rep.id),('team_id','=',team.id)]
count = lead.search_count(scope)
for start in range(count,10000,250):
    batch = [{
        'name': 'Offline volume opportunity %05d' % i,
        'type': 'opportunity', 'user_id': rep.id, 'team_id':team.id,
        'stage_id':stages[i % len(stages)].id, 'expected_revenue':100 + i % 8000,
    } for i in range(start,min(10000,start+250))]
    lead.create(batch)
    env.flush_all()
    env.invalidate_all()
assert lead.search_count(scope) == 10000
env.cr.commit()
print('SCALE_FIXTURE_READY',team.id,rep.id,lead.search_count(scope),flush=True)
