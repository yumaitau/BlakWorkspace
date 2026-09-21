"""File ownership cannot override revoked write access to shared knowledge."""
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '478fd5812dda907835537e250371daab9fa9a6c6bbe1788885f01a030fbed071':
    raise SystemExit('Unexpected upstream file access helper; review shared file permissions')
marker = '    # Direct ownership\n'
if source.count(marker) != 1:
    raise SystemExit('Missing native file ownership guard')
source = source.replace(marker, """    # A personal upload attached to shared knowledge also mutates that workspace.
    # Revoked editors must not retain that capability through file ownership.
    if access_type == 'write' and user.role != 'admin':
        shared = await Knowledges.get_knowledges_by_file_id(file_id, db=db)
        if user_group_ids is None:
            user_group_ids = {group.id for group in await Groups.get_groups_by_member_id(user.id, db=db)}
        for knowledge in shared:
            if knowledge.user_id != user.id and not await AccessGrants.has_access(
                user_id=user.id, resource_type='knowledge', resource_id=knowledge.id,
                permission='write', db=db, user_group_ids=user_group_ids,
            ):
                return False

""" + marker)
compile(source, str(file), 'exec')
file.write_text(source)
print('Native file ownership now respects shared knowledge write access')
