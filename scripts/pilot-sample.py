"""Sample the pilot's Hornsby rows so the importer maps them correctly."""
import sqlite3

SQLITE = r"C:\Users\manni.kheradmandi\OneDrive - COSOL GLOBAL\Notebooks\Data\lep_part4\lep_store.sqlite"
EPI = "epi-2013-0569"

con = sqlite3.connect(SQLITE)
con.row_factory = sqlite3.Row


def dump(table, cols="*", where="epi_id=?", limit=4):
    print(f"\n-- {table} " + "-" * (60 - len(table)))
    try:
        rows = con.execute(
            f"SELECT {cols} FROM {table} WHERE {where} LIMIT {limit}", (EPI,)).fetchall()
    except sqlite3.Error as e:
        print(f"  ({e})")
        return
    if not rows:
        print("  (no rows)")
        return
    for r in rows:
        for k in r.keys():
            v = r[k]
            if v is None or v == "":
                continue
            s = str(v).replace("\n", " ")
            print(f"    {k:22} {s[:96]}")
        print("    " + "-" * 40)


dump("land_application")
dump("rule", limit=2)
dump("rule_effect", limit=3)
dump("rule_applicability", limit=5)
dump("rule_edge", limit=4)
dump("spatial_ref", limit=3)
dump("objective", limit=2)
dump("proposition", limit=2)

# Distinct vocab actually used by Hornsby — the importer must accept these.
print("\n-- vocab used by Hornsby " + "-" * 40)
for tbl, col in [("rule", "kind"), ("rule", "role"), ("rule", "src"),
                 ("rule_effect", "effect_type"), ("rule_applicability", "dimension"),
                 ("rule_applicability", "polarity"), ("rule_edge", "edge_type"),
                 ("spatial_ref", "ref_type"), ("spatial_ref", "owner_kind"),
                 ("proposition", "kind")]:
    try:
        vals = [str(r[0]) for r in con.execute(
            f"SELECT DISTINCT {col} FROM {tbl} WHERE epi_id=? AND {col} IS NOT NULL", (EPI,))]
        print(f"  {tbl}.{col:16} {', '.join(sorted(vals))[:100]}")
    except sqlite3.Error as e:
        print(f"  {tbl}.{col:16} ({e})")

con.close()
