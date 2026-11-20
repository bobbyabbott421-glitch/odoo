"""Log test collection and result events alongside the unchanged Odoo test runner."""
import os
import json
from pathlib import Path
import sys
from functools import wraps
sys.path.insert(0, '/workspace/odoo')
import odoo.cli
from odoo.tests import loader
from odoo.tests.common import HttpCase
from odoo.tests.result import OdooTestResult

database = sys.argv[sys.argv.index('-d') + 1]
events = Path('/workspace/run-notes', os.environ.get('RUN_ID', database) + '.jsonl').open('a', buffering=1)
def record(event, test):
    events.write(json.dumps([event, test.id()]) + '\n')

original_make_suite = loader.make_suite
@wraps(original_make_suite)
def make_suite(*args, **kwargs):
    suite = original_make_suite(*args, **kwargs)
    if ids_file := os.environ.get('REMAINING_IDS'):
        selected = set(Path(ids_file).read_text().splitlines())
        suite = type(suite)(test for test in suite if test.id() in selected)
    for test in suite:
        record('collected', test)
    return suite
loader.make_suite = make_suite

def observe(cls, name):
    original = getattr(cls, name)
    @wraps(original)
    def wrapped(self, *args, **kwargs):
        record(name, self if name == 'start_tour' else args[0])
        return original(self, *args, **kwargs)
    setattr(cls, name, wrapped)

for name in ['startTest', 'addSuccess', 'addFailure', 'addError', 'addSkip']:
    observe(OdooTestResult, name)
original_start_tour = HttpCase.start_tour
@wraps(original_start_tour)
def start_tour(self, url_path, tour_name, *args, **kwargs):
    events.write(json.dumps(['tour_start', self.id(), tour_name]) + '\n')
    try:
        outcome = original_start_tour(self, url_path, tour_name, *args, **kwargs)
    except BaseException:
        events.write(json.dumps(['tour_failure', self.id(), tour_name]) + '\n')
        raise
    events.write(json.dumps(['tour_success', self.id(), tour_name]) + '\n')
    return outcome
HttpCase.start_tour = start_tour
odoo.cli.main()
