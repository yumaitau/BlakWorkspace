ARG BASE_IMAGE=blak-frappe:crm1.84.0-frappe15.121.0
FROM ${BASE_IMAGE}
# Small upgrade-safe adapter: shared theme is mounted from the generated ConfigMap.
RUN python -c 'from pathlib import Path; p=Path("apps/crm/crm/www/crm.html"); s=p.read_text(); assert "</head>" in s; p.write_text(s.replace("</head>", "<link rel=\"stylesheet\" href=\"/files/blak-crm.css\"></head>"))'
