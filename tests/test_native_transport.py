"""Native controller transport must keep hostname and certificate verification."""
from pathlib import Path
import ssl
import sys
import unittest
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
from http_client import API


class NativeTransportTests(unittest.TestCase):
    def test_https_controller_context_verifies_certificates_and_hostname(self):
        api = API('https://native.example', 'fixture')
        handler = next(handler for handler in api.opener.handlers if isinstance(handler, urllib.request.HTTPSHandler))
        self.assertEqual(handler._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(handler._context.check_hostname)

    def test_invalid_private_ca_never_falls_back_to_insecure_transport(self):
        with self.assertRaises(ssl.SSLError):
            API('https://native.example', 'fixture', ca_data='invalid fixture certificate')
