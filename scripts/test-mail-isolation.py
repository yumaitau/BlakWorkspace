#!/usr/bin/env python3
"""Run actual PostgreSQL RLS tests in a task-owned remote Docker container."""
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    context = os.environ.get('DOCKER_CONTEXT', 'm3-max')
    docker = ['docker', '--context', context]
    subprocess.run(docker + ['info', '--format', '{{.ServerVersion}}'], check=True)
    name = 'blak-mail-isolation-' + secrets.token_hex(6)
    # No published ports, bind mounts or host credentials. Trust auth is isolated
    # inside this disposable synthetic-data container, never a production default.
    subprocess.run(docker + ['run', '-d', '--name', name, '--network', 'none',
                            '--label', 'blak.task=mail-isolation',
                            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                            'postgres:16-alpine'], check=True, stdout=subprocess.DEVNULL)
    try:
        for _ in range(60):
            ready = subprocess.run(docker + ['exec', name, 'pg_isready', '-U', 'postgres'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('Temporary PostgreSQL did not become ready')
        for file in ['schema.sql', 'test-isolation.sql']:
            subprocess.run(docker + ['exec', '-i', name, 'psql', '-X', '-U', 'postgres',
                                    '-v', 'ON_ERROR_STOP=1'], check=True,
                           input=(ROOT / 'services/mail' / file).read_bytes())
    finally:
        subprocess.run(docker + ['rm', '-f', '-v', name], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
