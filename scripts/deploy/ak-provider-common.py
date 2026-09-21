"""Shared provider reconciliation; prepend before executing an ak-*.py module."""
from django.db import transaction
from authentik.core.models import Application
from authentik.providers.oauth2.models import OAuth2Provider


def reconcile_provider(*, name, slug, defaults):
    with transaction.atomic():
        application = Application.objects.select_related('provider').filter(slug=slug).first()
        if application and application.provider_id:
            # Application binding is authoritative, even after a provider rename.
            return application.provider.oauth2provider, False
        existing = OAuth2Provider.objects.filter(name=name).first()
        if existing:
            return existing, False
        defaults = dict(defaults)
        defaults['sub_mode'] = 'user_uuid'
        return OAuth2Provider.objects.create(name=name, **defaults), True
