"""Patch the pinned CRM sidebar for this SSO-only workspace; fail on upstream drift."""
from pathlib import Path
p = Path("apps/crm/frontend/src/components/Layouts/AppSidebar.vue")
s = p.read_text()
start = s.index("            <GettingStartedBanner")
end = s.index("            />", start) + len("            />")
s = s[:start] + '''            <a href="https://portal.homelab.local/welcome" class="rounded-md p-2 text-ink-gray-8 hover:bg-surface-gray-2">Getting started with Blak</a>''' + s[end:]
start = s.index('    <HelpModal')
end = s.index('    />', start) + len('    />')
s = s[:start] + '<!-- Blak ID accounts use workspace onboarding. -->' + s[end:]
# Keep the native documentation link accessible without the password checklist.
s = s.replace('@click="toggleHelpModal"', '@click="openWorkspaceHelp"', 1)
s = s.replace("<script setup>", "<script setup>\nconst openWorkspaceHelp = () => window.open('https://docs.frappe.io/crm', '_blank', 'noopener')", 1)
p.write_text(s)
