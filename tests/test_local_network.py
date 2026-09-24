import copy
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/deploy'))
import local_network as network
import local_tls as tls


class LocalNetworkTests(unittest.TestCase):
    def settings(self, **changes):
        args = dict(domain='workspace.internal', address='192.168.50.10', mode='bundled',
                    clients=['192.168.50.0/24'], node='appliance')
        args.update(changes)
        return network.configuration(**args)

    def test_bundled_zone_and_manifest_preserve_local_only_boundary(self):
        settings = self.settings()
        data = network.manifests(settings)
        self.assertEqual([d['kind'] for d in data], ['ConfigMap', 'Deployment'])
        core = data[0]['data']['Corefile']
        self.assertEqual(core.count('bind 192.168.50.10'), 2)
        self.assertEqual(core.count('allow net 192.168.50.0/24'), 2)
        self.assertNotIn('forward', core)
        self.assertIn('rcode REFUSED', core)
        self.assertNotIn('fallthrough', core)
        self.assertNotIn('log', core)
        spec = data[1]['spec']['template']['spec']
        self.assertTrue(spec['hostNetwork'])
        self.assertFalse(spec['automountServiceAccountToken'])
        self.assertEqual(spec['nodeName'], 'appliance')
        self.assertEqual(spec['containers'][0]['imagePullPolicy'], 'IfNotPresent')
        self.assertIn('@sha256:', spec['containers'][0]['image'])
        self.assertTrue(spec['containers'][0]['securityContext']['readOnlyRootFilesystem'])
        self.assertEqual(len(network.records(settings)), len(network.APPS) + 1)

    def test_invalid_domains_networks_and_self_forwarding_fail_before_output(self):
        invalid = [dict(domain='workspace.local'), dict(domain='work.example.com'),
                   dict(domain='https://work.internal'), dict(domain='a.\ninternal'),
                   dict(listen='0.0.0.0'), dict(listen='8.8.8.8'), dict(listen='127.0.0.1'),
                   dict(address='224.0.0.1'), dict(clients=[]), dict(clients=['0.0.0.0/0']),
                   dict(clients=['192.168.60.0/24']), dict(clients=['192.168.50.7/24']),
                   dict(upstreams=['192.168.50.10']), dict(upstreams=['localhost']), dict(node='')]
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.settings(**change)

    def test_external_mode_exports_no_workload_or_listener(self):
        settings = network.configuration('work.internal', '192.168.1.20', 'external')
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / 'dns'
            network.write_bundle(output, settings)
            self.assertFalse((output / 'dns.yaml').exists())
            self.assertFalse((output / 'Corefile').exists())
            self.assertEqual(json.loads((output / 'records.json').read_text())[0]['value'], '192.168.1.20')
            with self.assertRaises(FileExistsError):
                network.write_bundle(output, settings)
        with self.assertRaises(ValueError):
            network.configuration('work.internal', '192.168.1.20', 'external', upstreams=['192.168.1.1'])

    def test_explicit_forwarding_does_not_leak_local_unknown_names(self):
        core = network.corefile(self.settings(upstreams=['192.168.50.1']))
        local, outside = core.split('.:53 {')
        self.assertNotIn('forward', local)
        self.assertNotIn('fallthrough', local)
        self.assertIn('forward . 192.168.50.1', outside)

    def test_ipv6_and_existing_single_hostname(self):
        settings = self.settings(address='fd12::10', clients=['fd12::/64'], apex_only=True)
        self.assertEqual(network.records(settings), [dict(name='workspace.internal', type='AAAA', value='fd12::10', ttl=60)])
        self.assertIn('bind fd12::10', network.corefile(settings))

    def test_preflight_binds_udp_and_tcp_without_reuse(self):
        with patch.object(network.socket, 'socket') as factory:
            network.check_host(self.settings())
            self.assertEqual(factory.call_count, 2)
            self.assertEqual(factory.call_args_list[0].args, (socket.AF_INET, socket.SOCK_STREAM))
            self.assertEqual(factory.call_args_list[1].args, (socket.AF_INET, socket.SOCK_DGRAM))
            self.assertEqual(factory.return_value.__enter__.return_value.bind.call_count, 2)

    def test_install_rejects_wrong_node_and_unowned_resource(self):
        settings = self.settings()
        with patch.object(network, 'kube', return_value=json.dumps({'status': {'addresses': []}})) as kube:
            with self.assertRaisesRegex(ValueError, 'reported address'):
                network.install(settings, '/explicit/config')
            self.assertEqual(kube.call_count, 1)
        node = {'status': {'addresses': [{'address': settings['listen']}]}}
        with patch.object(network, 'kube', side_effect=[json.dumps(node), json.dumps({'metadata': {}})]) as kube:
            with self.assertRaisesRegex(ValueError, 'unrelated'):
                network.install(settings, '/explicit/config')
            self.assertEqual(kube.call_count, 2)


class LocalTlsTests(unittest.TestCase):
    def route(self, match='Host(`portal.workspace.internal`)'):
        return {'metadata': {'name': 'portal', 'resourceVersion': '17'},
                'spec': {'entryPoints': ['web', 'websecure'], 'routes': [{'match': match}]}}

    def test_tls_patch_is_optimistic_scoped_and_https_only(self):
        route = self.route()
        original = copy.deepcopy(route)
        patches = tls.route_patches([route, self.route('Host(`other.internal`)')], 'workspace.internal')
        self.assertEqual(len(patches), 1)
        self.assertEqual(route, original)
        self.assertEqual(patches[0][1][0], {'op': 'test', 'path': '/metadata/resourceVersion', 'value': '17'})
        self.assertEqual(patches[0][1][-1]['value'], ['websecure'])

    def test_uncovered_routes_and_existing_certificates_fail_closed(self):
        for match in ('Host(`other.internal`)', 'HostRegexp(`.*`)',
                      'Host(`portal.workspace.internal`) || PathPrefix(`/`)',
                      '!Host(`portal.workspace.internal`)', 'Host(`deep.portal.workspace.internal`)'):
            with self.subTest(match=match), self.assertRaisesRegex(ValueError, 'No exact-domain'):
                tls.route_patches([self.route(match)], 'workspace.internal')
        route = self.route()
        route['spec']['routes'].append({'match': 'PathPrefix(`/`)'})
        with self.assertRaises(ValueError):
            tls.route_patches([route], 'workspace.internal')
        route = self.route()
        route['spec']['tls'] = {'secretName': 'operator-certificate'}
        with self.assertRaisesRegex(ValueError, 'different certificate'):
            tls.route_patches([route], 'workspace.internal')

    def test_real_certificate_chain_renewal_and_key_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'authority'
            tls.create('workspace.internal', state)
            self.assertEqual(state.stat().st_mode & 0o777, 0o700)
            for key in ('ca.key', 'tls.key'):
                self.assertEqual((state / key).stat().st_mode & 0o777, 0o600)
            authority = (state / 'ca.crt').read_bytes()
            with self.assertRaises(FileExistsError):
                tls.create('workspace.internal', state)
            renewed = Path(tmp) / 'renewed'
            tls.renewal(state, renewed)
            self.assertEqual((renewed / 'ca.crt').read_bytes(), authority)
            self.assertFalse((renewed / 'ca.key').exists())
            self.assertNotEqual((state / 'tls.key').read_bytes(), (renewed / 'tls.key').read_bytes())
            with self.assertRaises(Exception):
                tls.validate('wrong.internal', renewed)

    def test_private_material_cannot_be_created_in_checkout(self):
        with self.assertRaisesRegex(ValueError, 'outside every Git'):
            tls.outside_checkout(ROOT / 'do-not-create-private-ca')


if __name__ == '__main__':
    unittest.main()
