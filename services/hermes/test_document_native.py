"""Image build gate: exercise the same sandboxed ODT loader as Open WebUI."""
import os
import tempfile
from pathlib import Path

import pypandoc
from unstructured.partition.odt import partition_odt

assert os.environ.get('ALLOW_PANDOC_NO_SANDBOX', '').lower() != 'true'
marker = 'Blak Drive sandboxed document extraction'
with tempfile.TemporaryDirectory() as directory:
    odt = Path(directory) / 'drive-fixture.odt'
    pypandoc.convert_text(marker, 'odt', format='markdown', outputfile=str(odt), sandbox=True)
    text = '\n'.join(str(element) for element in partition_odt(filename=str(odt)))
    assert marker in text, 'ODT content missing from native extraction'
print('Sandboxed ODT extraction passed')
