from odoo.tools.convert import convert_file
convert_file(env, 'web', 'views/webclient_templates.xml', {}, 'update')
env.cr.commit()
