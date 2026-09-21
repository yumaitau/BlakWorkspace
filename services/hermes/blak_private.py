"""App administration never grants access to another owner's private content."""
import os


def blak_content_admin(user):
    controller = os.environ.get('BLAK_ROLE_CONTROLLER_ID')
    return bool(controller and getattr(user, 'id', None) == controller
                and getattr(user, 'role', None) == 'admin')
