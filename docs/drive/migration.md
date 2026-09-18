# Drive migration approach (BW-029)

Approach is **copy-then-cutover**. Do not delete source shares until checksum verification. `drive_migration` reads the overlay.
