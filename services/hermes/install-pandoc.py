"""Install upstream Pandoc with embedded data, required for sandboxed ODT extraction."""
import hashlib
import io
import platform
import tarfile
import urllib.request
from pathlib import Path

VERSION = '3.11'
RELEASES = {
    'x86_64': ('amd64', '37edb3bbcf722f921a009941bf5874e2e0c09263226c9b4a2d980788cb062ab6'),
    'aarch64': ('arm64', '56ed5566ec41d22ec9ee0704e6ac0b98ba102e92384efd5306173a22d314c79a'),
}
architecture, expected = RELEASES[platform.machine()]
url = f'https://github.com/jgm/pandoc/releases/download/{VERSION}/pandoc-{VERSION}-linux-{architecture}.tar.gz'
with urllib.request.urlopen(url, timeout=120) as response:
    archive = response.read()
if hashlib.sha256(archive).hexdigest() != expected:
    raise RuntimeError('Pandoc release checksum mismatch')
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as bundle:
    binary = bundle.extractfile(f'pandoc-{VERSION}/bin/pandoc')
    if binary is None:
        raise RuntimeError('Pandoc release binary missing')
    destination = Path('/usr/local/bin/pandoc')
    destination.write_bytes(binary.read())
    destination.chmod(0o755)
