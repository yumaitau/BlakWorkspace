# Join / move / leave identity lifecycle (BW-022)

Pilot joiner, mover, and leaver steps stay **join, move, leave** in `deploy/overlays/blak/identity.yaml`. `lifecycle_failures` is empty only when all three are listed. Disable accounts on leave; do not leave Nubus groups dangling.
