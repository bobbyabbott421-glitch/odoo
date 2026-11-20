"""Capture persisted IDs of installed auto models and exact values of CRM demo business records."""
import json
import sys
from pathlib import Path
import psycopg2
from psycopg2 import sql

out = Path('/workspace/run-notes')
with psycopg2.connect(host='/workspace/odoo-env/run', user='odoo', dbname='crm_upgrade_control') as conn, conn.cursor() as cur:
    cur.execute("""
      SELECT DISTINCT c.relname
        FROM ir_model m JOIN pg_class c ON c.relname = replace(m.model, '.', '_')
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname='public'
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='id' AND a.attnum>0
       WHERE c.relkind='r' AND NOT m.transient ORDER BY 1
    """)
    tables = [r[0] for r in cur.fetchall()]
    contents = {}
    for table in tables:
        cur.execute(sql.SQL('SELECT id FROM {} ORDER BY id').format(sql.Identifier(table)))
        contents[table] = [r[0] for r in cur]
    cur.execute("SELECT id, name, active, type, team_id, user_id, stage_id, expected_revenue, probability FROM crm_lead ORDER BY id")
    contents['@crm_lead_values'] = cur.fetchall()
    cur.execute("SELECT module,name,model,res_id FROM ir_model_data WHERE model IN ('crm.lead','crm.stage','crm.team','mail.activity','mail.message') ORDER BY module,name")
    contents['@external_ids'] = cur.fetchall()
    (out / ('base-records-' + sys.argv[1] + '.json')).write_text(json.dumps(contents, default=str))
    print(len(tables), 'tables', len(contents['@crm_lead_values']), 'leads')
