"""
Summarise the LEP Part 4 pilot store (Notebooks/Data/lep_part4/lep_store.sqlite).

That store models the three things the production KG cannot express —
applicability, precedence and spatial binding — so the vocabulary it settled
on is the useful artefact. Read-only.

Usage: python scripts/lep-part4-store-summary.py [path-to-sqlite]
"""
import sys
import sqlite3
from collections import Counter

DEFAULT = r"C:\Users\manni.kheradmandi\OneDrive - COSOL GLOBAL\Notebooks\Data\lep_part4\lep_store.sqlite"
path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT

con = sqlite3.connect(path)
con.row_factory = sqlite3.Row


def show(title, sql, fmt=lambda r: "  " + " | ".join(str(x) for x in r), limit=25):
    print(f"\n{title}")
    try:
        rows = con.execute(sql).fetchall()
    except Exception as e:                       # table/column may not exist
        print(f"  (unavailable: {e})")
        return
    if not rows:
        print("  (none)")
        return
    for r in rows[:limit]:
        print(fmt(tuple(r)))
    if len(rows) > limit:
        print(f"  … {len(rows) - limit} more")


print("=" * 72)
print("LEP Part 4 pilot store")
print("=" * 72)

show("documents covered:",
     "SELECT epi_id, epi_name, lga, commenced, repealed FROM land_application ORDER BY epi_id",
     lambda r: f"  {r[0]:16} {str(r[1])[:40]:41} {str(r[2])[:16]:17} {r[3]}")

show("rule_applicability — the dimensions applicability is expressed in:",
     """SELECT dimension, polarity, count(*) n FROM rule_applicability
        GROUP BY 1,2 ORDER BY n DESC""",
     lambda r: f"  {str(r[0]):24} {str(r[1]):8} {r[2]:6}")

show("rule_effect — what a rule actually does:",
     """SELECT effect_type, count(*) n,
               sum(CASE WHEN map_layer IS NOT NULL AND map_layer<>'' THEN 1 ELSE 0 END) mapped
        FROM rule_effect GROUP BY 1 ORDER BY n DESC""",
     lambda r: f"  {str(r[0]):26} {r[1]:6}   map-bound: {r[2]}")

show("rule_effect — topics (the controlled quantity):",
     "SELECT topic, count(*) n FROM rule_effect GROUP BY 1 ORDER BY n DESC",
     lambda r: f"  {str(r[0]):30} {r[1]:6}")

show("rule_edge — relationships between clauses:",
     "SELECT edge_type, count(*) n FROM rule_edge GROUP BY 1 ORDER BY n DESC",
     lambda r: f"  {str(r[0]):24} {r[1]:6}")

show("rule.precedence — is precedence actually populated?",
     "SELECT precedence, count(*) n FROM rule GROUP BY 1 ORDER BY n DESC",
     lambda r: f"  {str(r[0]):24} {r[1]:6}")

show("spatial_ref — how many carry real geometry?",
     """SELECT ref_type,
               count(*) n,
               sum(CASE WHEN geom IS NOT NULL AND geom<>'' THEN 1 ELSE 0 END) with_geom,
               sum(CASE WHEN map_layer IS NOT NULL AND map_layer<>'' THEN 1 ELSE 0 END) with_layer
        FROM spatial_ref GROUP BY 1 ORDER BY n DESC""",
     lambda r: f"  {str(r[0]):26} {r[1]:6}  geom:{r[2]:5}  layer:{r[3]:5}")

show("grounding — propositions tied to a literal source span:",
     """SELECT grounded, count(*) n FROM proposition GROUP BY 1 ORDER BY n DESC""",
     lambda r: f"  grounded={str(r[0]):8} {r[1]:6}")

show("numeric — the extracted standards, by metric:",
     "SELECT metric, count(*) n FROM numeric GROUP BY 1 ORDER BY n DESC",
     lambda r: f"  {str(r[0]):30} {r[1]:6}", limit=15)

con.close()
