"""Alternate the base and branch on the same machine for ten paired renders of each page."""
from pathlib import Path
import os, subprocess, time, sys, tempfile
from contextlib import ExitStack
notes=Path(__file__).parent
signals=Path(tempfile.mkdtemp(prefix='interleave-', dir=notes))
def wait_for(path,children):
    deadline=time.monotonic()+160
    while not path.exists():
        if time.monotonic()>=deadline or any(p.poll() not in (None,0) for p in children):
            raise RuntimeError(f'Missing timing signal {path.name}')
        time.sleep(.04)
with ExitStack() as stack:
    children=[]
    for name,database,port,repo,conf in [
        ('base','crm_upgrade_control','17863','/workspace/run-notes/base-control','/workspace/run-notes/control.conf'),
        ('head','crm_final_measure','17864','/workspace/odoo','/workspace/odoo-env/odoo.conf')]:
        env=dict(os.environ,LD_LIBRARY_PATH='/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu',
                MEASUREMENT='interleaved-'+name,MEASURE_SYNC_NAME=name,MEASURE_SYNC_DIR=str(signals),MEASURE_SAMPLES='10',TEST_DATABASE=database,
                TEST_PORT=port,TEST_REPO=repo,TEST_ODOO_CONF=conf,BENCHMARK_LOG='interleaved-'+name+'-server.log')
        log=stack.enter_context((notes/('interleaved-'+name+'.log')).open('w'))
        children.append(subprocess.Popen([sys.executable,'reap_children.py','/workspace/odoo-env/venv/bin/python','measure.py'],cwd=notes,env=env,stdout=log,stderr=subprocess.STDOUT))
    for index in range(10):
        for kind in ['pipeline','lead']:
            names=['base','head'] if (index+(kind=='lead'))%2==0 else ['head','base']
            for name in names: wait_for(signals/f'{index}-{kind}-{name}.ready',children)
            for name in names:
                (signals/f'{index}-{kind}-{name}.go').touch()
                wait_for(signals/f'{index}-{kind}-{name}.done',children)
    assert all(p.wait(timeout=60)==0 for p in children)
