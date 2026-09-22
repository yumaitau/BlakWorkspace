"""App administration never grants access to another owner's private content."""
import os


def blak_content_admin(user):
    controller = os.environ.get('BLAK_ROLE_CONTROLLER_ID')
    return bool(controller and getattr(user, 'id', None) == controller
                and getattr(user, 'role', None) == 'admin')


async def blak_knowledge_admin(user, knowledge, db=None):
    if blak_content_admin(user):
        return True
    if getattr(user, 'role', None) != 'user':
        return False
    from open_webui.models.groups import Groups
    groups = await Groups.get_groups_by_member_id(user.id, db=db)
    if not any((group.data or {}).get('blak_id_app') == 'hermes'
               and (group.data or {}).get('blak_id_role') == 'admin' for group in groups):
        return False
    from open_webui.models.access_grants import AccessGrants
    return await AccessGrants.has_access(user_id=user.id, resource_type='knowledge',
                                        resource_id=knowledge.id, permission='write', db=db)
