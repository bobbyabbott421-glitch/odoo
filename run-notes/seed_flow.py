from pathlib import Path
lead = env['crm.lead'].with_user(env.ref('base.user_admin')).create({
    'name':'Client site follow-up', 'type':'opportunity', 'expected_revenue':4200,
    'description':'Meet the purchasing team on Friday.', 'user_id':env.ref('base.user_admin').id,
})
lead.message_post(body='Client prefers an afternoon visit.', subtype_xmlid='mail.mt_note')
lead.activity_schedule('mail.mail_activity_data_todo', summary='Confirm site visit')
env.cr.commit()
Path('/workspace/run-notes/flow-lead-id').write_text(str(lead.id))
