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
