from pathlib import Path
n=Path(__file__).parent
s=(n/'draft-final.md').read_text()
s=s.replace('The branch starts at `ee8c13eaa57`. HEAD is `e21b8020e0b`, and the PR is open and unmerged.',
            'The nine commits run from base `ee8c13eaa57` to head `e21b8020e0b`. The PR is open and unmerged. Every baseline test ID was accounted for, with no new failing IDs.')
s=s.replace('Every baseline test ID appeared in the final comparison. Every final failure also failed at baseline. No existing test was removed, skipped or weakened.', 'Existing test assertions and skips were preserved.')
s=s.replace('The test assertions and timeouts were unchanged. ', 'All runs used the original timeouts. ')
s=s.replace('with a device passphrase and install', 'with a device passphrase of at least 12 characters and install')
s=s.replace('PERF','''## Performance

The original shared-host baseline measured 3,350 ms and 14 server requests for the pipeline, and 1,523 ms and 15 requests for the lead form. A later matched run while other suites were active measured base/branch medians of 3,425/5,107 ms and 15/16 requests for the pipeline, and 3,371/3,483 ms and 17/17 requests for the form.

| Warm online navigation | Pipeline, base → branch | Lead form, base → branch |
| --- | ---: | ---: |
| Idle host, base run first, five samples each | 719 → 866 ms | 736 → 873 ms |
| Idle host, branch run first, five samples each | 822 → 753 ms | 755 → 787 ms |
| Alternating base and branch, ten samples each | 1,185 → 1,293 ms | 1,148 → 1,173 ms |
| Median server requests in the alternating run | 14 → 14 | 16.5 → 16 |
| Median business POSTs in the alternating run | 8 → 8 | 7 → 7 |

The alternating run measured a median difference within each pair of +25 ms for the pipeline and +70 ms for the form. HTTP counts varied with Chromium's service-worker update checks. The samples do not establish identical online speed. Reproduce with `bash paired-timing.sh`, `bash quiet-timing.sh`, `bash reverse-timing.sh` and `python interleaved-timing.py` on the prepared databases.

**10,000-lead pipeline.** With the Odoo process stopped and Chromium offline, the idle-host base rendered 320 cards in 2,287 ms. The branch restored the selected sales team and rendered 320 in 2,357 ms. Under load the branch took 18,815 ms. Earlier single measurements were 4,947 ms on the original base and 3,726 ms in phase 2. Run `scale_offline.py` on the base and `scale_offline_phase2.py` on the branch to reproduce. The 10,000 leads were on the server. The device reopened its previously loaded cards.''')
s=s.replace('**Reproduction.** From','## Commands and limits\n\nFrom')
s=s.replace('The task','The task')
assert not any(flag in s for flag in ['HEADSHA','PERF','MOBILE','RECONCILED','SUITES','LIFECYCLE'])
(n/'REPORT.md').write_text(s)
