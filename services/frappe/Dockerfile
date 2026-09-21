ARG BASE_IMAGE=blak-frappe:crm1.84.0-frappe15.121.0
FROM ${BASE_IMAGE}
USER root
# Preserve the public port when Frappe builds redirects and socket origins.
RUN sed -i 's/Host $host;/Host $http_host;/g; s@Origin $proxy_x_forwarded_proto://${FRAPPE_SITE_NAME_HEADER};@Origin $proxy_x_forwarded_proto://$http_host;@g' /templates/nginx/frappe.conf.template
USER frappe
COPY --chown=frappe:frappe role_policy.py /home/frappe/frappe-bench/apps/crm/crm/blak_role_policy.py
COPY --chown=frappe:frappe blak_roles.py /home/frappe/frappe-bench/apps/crm/crm/blak_roles.py
COPY --chown=frappe:frappe patch-roles.py /tmp/blak-patch-roles.py
COPY --chown=frappe:frappe test-native-roles.py /tmp/blak-test-native-roles.py
COPY --chown=frappe:frappe test-realtime-roles.cjs /tmp/blak-test-realtime-roles.cjs
COPY --chown=frappe:frappe enroll-roles.py /tmp/blak-enroll-roles.py
RUN python /tmp/blak-patch-roles.py && python /tmp/blak-test-native-roles.py && node --check apps/frappe/realtime/index.js && node --test /tmp/blak-test-realtime-roles.cjs
COPY --chown=frappe:frappe polish.py /tmp/blak-polish.py
RUN python /tmp/blak-polish.py && cd apps/crm/frontend && yarn build
# Small upgrade-safe adapter: shared theme is mounted from the generated ConfigMap.
RUN python -c 'from pathlib import Path; p=Path("apps/crm/crm/www/crm.html"); s=p.read_text(); assert "</head>" in s; p.write_text(s.replace("</head>", "<link rel=\"stylesheet\" href=\"/files/blak-crm.css\"></head>"))'
