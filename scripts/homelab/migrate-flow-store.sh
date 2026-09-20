#!/usr/bin/env bash
# One-time emptyDir -> PVC migration. Pause writes only while taking/copying the snapshot.
# Run on the homelab host immediately before deploying the persistent portal manifest.
set -euo pipefail
NS="${NS:-blak-micro}"
IMAGE="${PORTAL_IMAGE:?set PORTAL_IMAGE to the imported portal image}"
if kubectl -n "$NS" get deploy portal -o jsonpath='{.spec.template.spec.volumes[?(@.name=="flow-store")].persistentVolumeClaim.claimName}' | grep -q portal-flow-data; then
  echo 'Flow storage already persistent'
  exit 0
fi
WORKDIR=$(mktemp -d)
chmod 700 "$WORKDIR"
HELPER="portal-flow-migration-$(date +%s)"
PAUSED=false
cleanup() {
  if "$PAUSED"; then
    kubectl -n "$NS" exec deploy/portal -- node -e 'process.kill(1,"SIGCONT")' >/dev/null 2>&1 || true
  fi
  kubectl -n "$NS" delete pod "$HELPER" --ignore-not-found --wait=false >/dev/null
  rm -rf "$WORKDIR"
}
trap cleanup EXIT
cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: portal-flow-data, namespace: $NS }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Pod
metadata: { name: $HELPER, namespace: $NS }
spec:
  restartPolicy: Never
  containers:
    - name: copy
      image: $IMAGE
      command: [node, -e, 'setInterval(()=>{},1000)']
      volumeMounts: [{ name: data, mountPath: /data }]
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: portal-flow-data }
YAML
kubectl -n "$NS" wait --for=condition=Ready "pod/$HELPER" --timeout=120s
kubectl -n "$NS" exec deploy/portal -- node -e 'process.kill(1,"SIGSTOP")'
PAUSED=true
kubectl -n "$NS" exec deploy/portal -- node -e 'const fs=require("fs");const p=process.env.FLOW_STORE;process.stdout.write(p&&fs.existsSync(p)?fs.readFileSync(p):JSON.stringify({flows:{},runs:[]}))' > "$WORKDIR/store.json"
# Copy into the PVC; the snapshot remains untouched in the existing pod until replacement.
kubectl -n "$NS" cp "$WORKDIR/store.json" "$HELPER:/data/blak-flow.json"
kubectl -n "$NS" exec "$HELPER" -- node -e 'const fs=require("fs");const p="/data/blak-flow.json";const data=JSON.parse(fs.readFileSync(p));if(!data.flows||!Array.isArray(data.runs))process.exit(1);fs.chmodSync(p,0o600);console.log("Preserved",Object.keys(data.flows).length,"flows and",data.runs.length,"runs")'
# Keep writes paused until deployment replaces this pod. On failure the EXIT trap resumes it.
PATCH=$(kubectl -n "$NS" get deploy portal -o json | python3 -c '
import json, os, sys
spec=json.load(sys.stdin)["spec"]["template"]["spec"]
volumes=[{"name":"flow-store","persistentVolumeClaim":{"claimName":"portal-flow-data"}} if item["name"]=="flow-store" else item for item in spec["volumes"]]
index=next(i for i,item in enumerate(spec["containers"]) if item["name"]=="portal")
print(json.dumps([
 {"op":"replace","path":"/spec/template/spec/volumes","value":volumes},
 {"op":"replace","path":"/spec/strategy","value":{"type":"Recreate"}},
 {"op":"replace","path":f"/spec/template/spec/containers/{index}/image","value":os.environ["PORTAL_IMAGE"]}
]))')
kubectl -n "$NS" patch deployment portal --type=json -p "$PATCH"
PAUSED=false
kubectl -n "$NS" rollout status deploy/portal --timeout=180s
