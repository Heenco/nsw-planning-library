"""The precinct pipeline, one command (docs/precinct-sepp-pipeline.md).

    python -I scripts/precinct/run.py                      # the quick stages: resolve, coverage, claims
    python -I scripts/precinct/run.py --only resolve        # one stage
    python -I scripts/precinct/run.py --lots --lga CAMDEN --lga BLACKTOWN   # also rebuild named councils' lot bindings first
    python -I scripts/precinct/run.py --lots --all          # ... or the whole state (~50 min), swapped in at the end
    python -I scripts/precinct/run.py --units               # also re-propose the instrument unit map first (new rows are 'proposed')

Stages, in order, each a script of its own that can be run alone:
    units      scripts/build-instrument-unit-map.ts   which map polygon names which unit of an instrument -> nsw.instrument_unit_map   (--units)
    lots       scripts/build-lot-instrument.ts        which instrument and unit governs each lot           -> derived.lot_instrument    (--lots)
    resolve    scripts/precinct/resolve-lut.py        every table of every unit, as written and resolved   -> precinct.lut_*
    coverage   scripts/precinct/lut-coverage.py       the gate: lot-zone coverage, 171 leaves per table    -> docs/precinct-lut-coverage.csv (exit 1 on a gap, the run goes on)
    claims     scripts/rag/run.ts --only claims,bindings   the rag engine reads the resolved rows            -> rag.claim / rag.claim_binding
Everything reads the shared database; a run reaches prod as soon as it is written. The page (/precinct) resolves nothing
itself: it reads precinct.lut_* through /api/lep-permissibility?unit= and derived.lot_instrument through /api/report/standards.
"""
import sys, os, subprocess, time, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[1:]
def flag(name): return name in argv
def values(name): return [argv[i + 1] for i, a in enumerate(argv) if a == name and i + 1 < len(argv)]
only = set(sum([v.split(',') for v in values('--only')], []))
stages = []
if flag('--units') or 'units' in only: stages.append(('units', ['npx', 'tsx', 'scripts/build-instrument-unit-map.ts']))
if flag('--lots') or 'lots' in only:
    lgas = sum([['--lga', l] for l in values('--lga')], [])
    stages.append(('lots', ['npx', 'tsx', 'scripts/build-lot-instrument.ts'] + (['--all', '--swap'] if flag('--all') else lgas + ['--apply'])))
for name, cmd in [('resolve', [sys.executable, '-I', 'scripts/precinct/resolve-lut.py']),
                  ('coverage', [sys.executable, '-I', 'scripts/precinct/lut-coverage.py']),
                  ('claims', ['npx', 'tsx', 'scripts/rag/run.ts', '--only', 'claims,bindings'])]:
    if not only or name in only: stages.append((name, cmd))
if only: stages = [s for s in stages if s[0] in only]

print(f"precinct pipeline {datetime.datetime.now():%Y-%m-%d %H:%M}: {' -> '.join(n for n, _ in stages)}")
t_all = time.time(); results = []
for name, cmd in stages:
    t = time.time(); print(f"\n=== {name}: {' '.join(cmd)}"); sys.stdout.flush()
    r = subprocess.run(cmd, cwd=ROOT, shell=(os.name == 'nt' and cmd[0] == 'npx'), env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    results.append((name, r.returncode, time.time() - t))
    print(f"=== {name} {'ok' if r.returncode == 0 else f'exit {r.returncode}'} in {time.time() - t:.0f} s")
    if r.returncode and name != 'coverage': print('stopped: a stage failed'); break
print(f"\nall done in {(time.time() - t_all) / 60:.1f} min: " + ', '.join(f"{n} {'ok' if c == 0 else f'exit {c}'} ({s:.0f} s)" for n, c, s in results))
sys.exit(max((c for n, c, _ in results if n != 'coverage'), default=0))   # a coverage gap is reported, not a failed run
