# Suite chrome (Google Workspace / Microsoft 365 layout, Blak mapping)

Layout and information architecture only. Not feature parity with Gmail, Outlook, Copilot, or thousands of connectors.

## What those suites share

**Google Workspace (2025–2026 admin and app shells)**

- Sticky top bar on every app.
- 3×3 waffle (App Launcher) opens a grid of apps the admin has allowed. Admin console is a waffle target (`admin.google.com`), not a tile on Gmail itself.
- Product mark and name sit in the top bar.
- Search is first-class (Drive search, Admin search, Google Search on consumer surfaces).
- Account chip (avatar) at the far end of the top bar, with sign-out.
- Admin console has a grouped left nav (Directory, Security, and so on).

**Microsoft 365 (`microsoft365.com` / office.com and app shells)**

- Waffle (App launcher) at the **top left**.
- Microsoft 365 wordmark, Microsoft Search in the centre, account chip on the right.
- Home is a dashboard of app cards plus recents.
- Admin is a separate live surface (`admin.microsoft.com`).
- Power Automate left nav: Home, Create, My flows, Monitor/Activity. A cloud flow is a trigger (starter) plus ordered actions against connectors. Run history is a first-class page.

## Blak Workspace mapping

| Pattern | Blak |
| --- | --- |
| Waffle / app launcher | 9-dot button, top left, `aria-label="App launcher"` |
| Product mark | Blak wordmark in the sticky top bar |
| Search | Centre search; Enter goes to Blak Search |
| Account chip | Name + avatar + Sign out (`data-testid="userchip"`) |
| Grouped left nav | Workspace / Organise / Platform, plus Blak Home |
| Home dashboard | Live app cards only |
| Admin | Blak Admin (Authentik) as its own live waffle/nav target |
| Automation | Blak Flow live: My flows, Create, Activity |
| Identity | One Blak ID OIDC issuer; SP-initiated `/login` |

Chat (Mattermost Team) and Projects (OpenProject CE) stay **Soon**: upstream OIDC is Enterprise-licenced, so they are not advertised as live.

Portal-owned surfaces (Home, Search, Cloud, Flow) share the portal session (`blak-portal` client). Drive and Docs use OpenCloud client `web` (Docs via WOPI). Knowledge uses Outline. Hermes uses its own client. Admin is the IdP.
