"""Local HTTP tests seed a real server-side record before starting the portal.

OIDC protocol validation is covered separately by integration.test.js and live
browser tests. A signed cookie by itself no longer creates an authenticated user.
"""
import subprocess
import tempfile
from pathlib import Path
from repo import ROOT


def portal_session(env):
    directory = tempfile.TemporaryDirectory(prefix='blak-portal-test-')
    env['SESSION_STORE'] = str(Path(directory.name) / 'sessions.enc')
    source = """
const {createSessionStore}=require('./apps/portal/session-store');
const {sign}=require('./apps/portal/session');
const user={sub:'ada',identity:'test-identity',name:'Ada Example',email:'ada@example.test',apps:['flow','storage'],exp:Date.now()+3600000,checkedAt:Date.now()};
const sid=createSessionStore(process.env.SESSION_STORE,process.env.SESSION_SECRET).create(user);
process.stdout.write(sign({sub:user.sub,exp:user.exp,sid}));
"""
    token = subprocess.check_output(['node', '-e', source], cwd=ROOT, env=env, text=True)
    return directory, token
