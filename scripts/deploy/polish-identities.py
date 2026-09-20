"""Replace only bootstrap display labels; login names, subjects and roles stay stable."""
import json, subprocess
source="""from authentik.core.models import User
u=User.objects.get(username='akadmin')
if u.name == 'authentik Default Admin':
 u.name='Workspace Admin';u.save(update_fields=['name'])
print('Bootstrap display name verified')
"""
result=subprocess.run(['kubectl','-n','blak-micro','exec','-i','deploy/authentik-server','--','ak','shell'],input=('exec('+repr(source)+')\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode:raise RuntimeError('Identity label update failed')
print('Workspace admin display label configured')
# Outline persists its initial OIDC display name instead of refreshing it at login.
# Restrict the migration to the known bootstrap identity and uncustomized team icon.
outline_sql = """BEGIN;
UPDATE users SET name='Workspace Admin' WHERE email='admin@blak.local' AND name='authentik Default Admin';
UPDATE teams SET "avatarUrl"='https://sites.workspace.example.com/_blak/logo.svg'
 WHERE name='Blak Knowledge' AND ("avatarUrl" IS NULL OR "avatarUrl"='');
COMMIT;
"""
result=subprocess.run(['kubectl','-n','blak-micro','exec','-i','deploy/postgres','--','sh','-c','psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d outline'],input=outline_sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode:raise RuntimeError('Knowledge bootstrap label update failed')
print('Knowledge default display name and icon configured')
forms_js = 'db.getSiblingDB("heyform").usermodels.updateOne({email:"admin@blak.local",name:"authentik Default Admin"},{$set:{name:"Workspace Admin"}});'
result=subprocess.run(['kubectl','-n','blak-micro','exec','deploy/mongo','--','mongosh','--quiet','--eval',forms_js],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode:raise RuntimeError('Forms bootstrap label update failed')
print('Forms default display name configured')
