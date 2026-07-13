rsp two-axis benchmark: 18 fixtures across 7 filters

Production mode uses admission threshold 60%; passthrough filters count as 0% token delta because rsp returns the original command output.
Headroom is the token count of the minimal assertion-derived output; capture ratios are headroom tokens divided by emitted tokens.

Aggregate tokens: raw 64083, brief 12982, terse 12798, RTK 646, headroom 322.
Aggregate headroom capture: brief 2.5%, terse 2.5%, RTK 49.8%.

| Filter | Mode | Fixtures | raw tok | brief tok | terse tok | RTK tok | headroom tok | brief headroom | terse headroom | RTK headroom | brief shipped delta | brief fidelity | brief hyp-active delta | terse shipped delta | terse fidelity | terse hyp-active delta | RTK median/p90 token delta | RTK fidelity |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cargo:test | active | 3 | 478 | 202 | 204 | 132 | 88 | 43.6% | 43.1% | 66.7% | 61.9/84.2% | 100% | 61.9/84.2% | 57.7/84.2% | 100% | 57.7/84.2% | 67.8/82.4% | 100% |
| git:commit | passthrough | 1 | 33 | 33 | 33 | 59 | 6 | 18.2% | 18.2% | 10.2% | 0/0% | 100% | 42.4/42.4% | 0/0% | 100% | 42.4/42.4% | -78.8/-78.8% | 100% |
| git:diff | passthrough | 2 | 7526 | 7526 | 7526 | 62 | 28 | 0.4% | 0.4% | 45.2% | 0/0% | 100% | -6.2/99.1% | 0/0% | 100% | -21.6/99.1% | 38.3/99.6% | 100% |
| git:log | passthrough | 2 | 4467 | 4467 | 4467 | 68 | 52 | 1.2% | 1.2% | 76.5% | 0/0% | 100% | 16.3/98.4% | 0/0% | 100% | 13.7/98.4% | 52.3/99.3% | 100% |
| git:push | active | 2 | 58 | 21 | 21 | 63 | 6 | 28.6% | 28.6% | 9.5% | 31.9/63.8% | 100% | 31.9/63.8% | 31.9/63.8% | 100% | 31.9/63.8% | 13.8/27.6% | 100% |
| git:status | active | 2 | 153 | 79 | 79 | 54 | 11 | 13.9% | 13.9% | 20.4% | 60.5/75% | 100% | 60.5/75% | 60.5/75% | 50% | 60.5/75% | 23.7/72.3% | 100% |
| vitest:run | active | 6 | 51368 | 654 | 468 | 208 | 131 | 20% | 28% | 63% | 58.8/100% | 100% | 58.8/100% | 70/100% | 100% | 70/100% | 86.3/100% | 100% |

Large-output filters: git:diff, git:log, vitest:run.

| Parity domain | Filter | Gate | rsp fidelity | RTK fidelity |
| --- | --- | --- | ---: | ---: |
| cargo-test | cargo:test | fail | 100% | 100% |
| git-commit | git:commit | pass | 100% | 100% |

RTK baseline is replayed from checked-in recorded fixtures only; RTK is not executed by this command.
External context-optimization claims are cited literature only and were not locally reproduced.
