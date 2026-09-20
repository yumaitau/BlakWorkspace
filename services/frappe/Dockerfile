ARG BASE_IMAGE=blak-frappe:crm1.84.0-frappe15.121.0
FROM ${BASE_IMAGE}
COPY --chown=frappe:frappe polish.py /tmp/blak-polish.py
RUN python /tmp/blak-polish.py && cd apps/crm/frontend && yarn build
# Small upgrade-safe adapter: shared theme is mounted from the generated ConfigMap.
RUN python -c 'from pathlib import Path; p=Path("apps/crm/crm/www/crm.html"); s=p.read_text(); assert "</head>" in s; p.write_text(s.replace("</head>", "<link rel=\"stylesheet\" href=\"/files/blak-crm.css\"></head>"))'
