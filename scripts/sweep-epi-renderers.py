"""Read the NSW Planning Portal Spatial Viewer's own symbol for every layer of the epi schema.

/epi drew its 56 layers with seven group colours, which tells you which family a layer belongs to and
nothing else. The epi tables ARE the ePlanning map layers, so the portal already has a symbol for almost
all of them, and a planner checking a property against the Spatial Viewer should see the same colours
here. This reads them rather than transcribing them: there are over 400 bands across minimum lot size,
height and floor space ratio alone, and hand-typing those is how a palette ends up almost right.

Output: shared/epi-renderers.json, read by shared/epi-symbology.ts. Regenerate it when ePlanning
restyles a map; the app needs no change, because the rules that key a symbol to a category live in the
TypeScript and the colours live here.

    python scripts/sweep-epi-renderers.py

WHAT IS AND IS NOT MEASURED. Every colour, width, hatch and class label comes from the service. Three
things are decided here and are marked in the output so they cannot be mistaken for measurements:
  · which ArcGIS layer each epi table corresponds to (MATCH, looked up in the service directories);
  · which class a portal renderer uses as its own catch-all (BASE_FROM);
  · the handful of epi tables the portal has no layer for at all (the catch-alls, and the four tables
    that are empty in this load), which get no entry and are coloured by the app.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "shared" / "epi-renderers.json"

BASE = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning"
SVC = {
    "principal": "Planning_Portal_Principal_Planning",
    "protection": "Planning_Portal_Protection",
    "hazard": "Planning_Portal_Hazard",
    "devctrl": "Planning_Portal_Development_Control",
    "sepp": "Planning_Portal_SEPP",
}
PRETTY = {"principal": "Principal Planning", "protection": "Protection", "hazard": "Hazard",
          "devctrl": "Development Control", "sepp": "SEPP"}

# ── epi table -> the ArcGIS layer the Spatial Viewer draws it with ───────────────────────────────────
#
# Looked up in each service's directory listing, not guessed. Several epi tables are the union of one
# layer repeated once per instrument - Land Application, Gross Floor Area, Environmental Conservation
# Area - and the portal gives every copy the same symbol, so one representative is named.
#
# `extra` layers are merged in for their classes only: the epi table holds rows from more than one
# published map, and the second map carries the classes the first one does not (riparian land is the
# clear case - the watercourse categories live in the Watercourses map).
MATCH = {
    # principal planning
    "epi_land_zoning": ("principal", 19, [("principal", 18)]),
    "epi_lot_size": ("principal", 22, [("principal", 21)]),
    "epi_floor_space_ratio": ("principal", 11, [("principal", 10)]),
    "epi_height_of_building": ("principal", 14, [("principal", 13)]),
    "epi_dwelling_density": ("principal", 25, []),
    "epi_land_reservation_acquisition": ("principal", 24, []),
    "epi_land_reclassification": ("principal", 23, []),
    "epi_heritage": ("principal", 16, [("principal", 221)]),
    "epi_foreshore_building_line": ("principal", 26, []),
    "epi_gross_floor_area": ("sepp", 136, []),
    "epi_reduced_level": ("sepp", 135, []),
    # land application
    "epi_land_application": ("sepp", 78, []),
    # biodiversity and protection
    "epi_terrestrial_biodiversity": ("protection", 243, [("protection", 768), ("protection", 737)]),
    "epi_riparian_lands_watercourses": ("protection", 240, [("protection", 751), ("protection", 1024),
                                                            ("protection", 740), ("protection", 590)]),
    "epi_wetlands": ("protection", 244, []),
    "epi_native_veg_protection": ("sepp", 123, []),
    "epi_environmental_cons_area": ("sepp", 141, []),
    "epi_environmentally_sensitive_land": ("protection", 245, []),
    "epi_special_areas": ("sepp", 127, []),
    "epi_scenic_protection": ("protection", 242, [("sepp", 183)]),
    # land, soil and water
    "epi_acid_sulfate_soils": ("protection", 234, []),
    "epi_csg_exclusions": ("sepp", 107, []),
    "epi_salinity": ("protection", 241, []),
    "epi_groundwater_vulnerability": ("protection", 237, []),
    "epi_strategic_agricultural_land": ("sepp", 104, []),
    "epi_drinking_water_catchments": ("protection", 236, []),
    "epi_water_zoning": ("sepp", 169, []),
    "epi_mineral_and_extractive": ("protection", 238, [("sepp", 108)]),
    # hazard
    "epi_flood": ("hazard", 230, []),
    "epi_landslide_risk": ("hazard", 232, []),
    "epi_geotechnical": ("sepp", 99, []),
    "epi_noise_exposure_forecast": ("protection", 235, []),
    "epi_obstacle_limitation_surface": ("protection", 239, []),
    # development controls and local provisions
    "epi_heritage_points": ("sepp", 285, []),
    "epi_additional_permitted_uses": ("devctrl", 225, []),
    "epi_active_street_frontages": ("devctrl", 224, []),
    "epi_key_sites": ("devctrl", 226, []),
    "epi_local_complying_exclusion": ("sepp", 92, []),
    "epi_local_exempt_exclusion": ("sepp", 93, []),
    "epi_urban_release_area": ("devctrl", 227, []),
    "epi_industrial_release_area": ("sepp", 82, []),
    "epi_growth_centres": ("sepp", 117, []),
    "epi_precinct_boundaries": ("sepp", 124, []),
    "epi_state_significant_dev_sites": ("sepp", 697, []),
    "epi_strategic_foreshore_sites_points": ("sepp", 186, []),
    "epi_additional_rural_village_land": ("sepp", 106, []),
    "epi_bulk_water_supply": ("sepp", 87, []),
    "epi_lease_area": ("sepp", 722, []),
    "epi_future_residential_growth_area": ("sepp", 105, []),
    "epi_referral_area": ("sepp", 796, []),
}

# The class a renderer uses as its OWN catch-all, promoted to the layer's base symbol. The portal reaches
# these when a council's value is not one of the standard ones, which is exactly the case the epi copy
# hits most often, so honouring them is what keeps a layer from falling through to a made-up grey.
BASE_FROM = {
    "epi_acid_sulfate_soils": "Non Standard Values",
    "epi_noise_exposure_forecast": "Non Standard Values",
    "epi_active_street_frontages": "Active Street Frontage",
    "epi_lease_area": "Lease Area",
    "epi_referral_area": "Referral Area",
    "epi_riparian_lands_watercourses": "Riparian Land",
    "epi_environmentally_sensitive_land": "Environmentally Sensitive Land",
    # Reduced Level is the one layer whose renderer cannot be keyed at all: it colours the SYM_CODE
    # letter while the epi copy keeps the level itself in metres AHD, and the plan's letter-to-level
    # table is not in the service. Its first band becomes the base, so the five polygons draw in this
    # map's own palette instead of a grey that belongs to no map.
    "epi_reduced_level": "O",
}

# The four numeric control maps - zoning, minimum lot size, floor space ratio, height - have no renderer
# default at all: the portal does not draw a value outside its own bands, and councils do map values outside
# them (height bands of '20 - 40', lot sizes of '100-199.9'; 2,391 lot size polygons in all).
#
# Not drawing a switched-on layer is worse here than on the portal, because the page's job is to say what
# covers a lot. So they borrow the symbol ePlanning uses for exactly this on the layers that do have one:
# Acid Sulfate Soils and Airport Noise both carry a 'Non Standard Values' class, a grey hatch. The colour
# stays measured; what is decided here is that it also fits these four.
BORROW_NON_STANDARD = [
    "epi_land_zoning", "epi_lot_size", "epi_floor_space_ratio", "epi_height_of_building",
]
NON_STANDARD_SOURCE = ("protection", 234, "Non Standard Values")

# ArcGIS fill styles, reduced to the hatches the app can draw (shared/hatch.ts). Anything else is solid.
HATCH = {
    "esriSFSBackwardDiagonal": "bdiag",
    "esriSFSForwardDiagonal": "fdiag",
    "esriSFSDiagonalCross": "dcross",
    "esriSFSCross": "cross",
    "esriSFSHorizontal": "horizontal",
    "esriSFSVertical": "vertical",
}


def get(url, tries=4):
    """mapprod3 drops a connection every few dozen requests; one lost layer would silently lose a symbol."""
    req = urllib.request.Request(url, headers={"User-Agent": "nsw-planning-library/epi-symbology"})
    for n in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            if n == tries - 1:
                raise
            time.sleep(2 * (n + 1))


def hexof(c):
    """An ArcGIS colour array to #rrggbb, or None where it is fully transparent - an unfilled symbol."""
    if not c or len(c) < 3 or (len(c) > 3 and c[3] == 0):
        return None
    return "#%02x%02x%02x" % (c[0], c[1], c[2])


def symof(sym):
    """One esri symbol reduced to {fill, line, width, hatch}: what the app's Sym can express."""
    if not sym:
        return None
    t = sym.get("type")
    if t == "esriSFS":
        out = {"fill": hexof(sym.get("color"))}
        h = HATCH.get(sym.get("style"))
        if h:
            out["hatch"] = h
        o = sym.get("outline") or {}
        out["line"] = hexof(o.get("color"))
        if o.get("width") is not None:
            out["width"] = o["width"]
    elif t == "esriSLS":
        out = {"fill": None, "line": hexof(sym.get("color"))}
        if sym.get("width") is not None:
            out["width"] = sym["width"]
    elif t in ("esriSMS", "esriPMS"):
        # a point. A picture marker carries no colour at all, and the app draws its own dot for those.
        o = sym.get("outline") or {}
        out = {"fill": hexof(sym.get("color")), "line": hexof(o.get("color")), "point": True}
        if o.get("width") is not None:
            out["width"] = o["width"]
    else:
        return None
    return out


def classes_of(renderer):
    """label -> symbol, for whichever kind of renderer this is. One label may carry many internal codes."""
    out, base = {}, None
    kind = renderer.get("type")
    if kind == "simple":
        base = symof(renderer.get("symbol"))
    elif kind in ("uniqueValue", "classBreaks"):
        base = symof(renderer.get("defaultSymbol"))
        infos = renderer.get("uniqueValueInfos") if kind == "uniqueValue" else renderer.get("classBreakInfos")
        for info in infos or []:
            label = (info.get("label") or "").strip()
            sym = symof(info.get("symbol"))
            if label and sym:
                out.setdefault(label, sym)
    return kind, base, out


def read(service, lid):
    d = get(f"{BASE}/{SVC[service]}/MapServer/{lid}?f=json")
    if d.get("error"):
        raise RuntimeError(f"{service}/{lid}: {d['error'].get('message')}")
    info = d.get("drawingInfo") or {}
    kind, base, cls = classes_of(info.get("renderer") or {})
    return {
        "name": d.get("name"),
        "from": f"Spatial Viewer · {PRETTY[service]}/{lid} {d.get('name')}",
        "geometry": d.get("geometryType"),
        "type": kind,
        "field": ", ".join(f for f in (
            (info.get("renderer") or {}).get("field1"),
            (info.get("renderer") or {}).get("field2"),
            (info.get("renderer") or {}).get("field3")) if f) or None,
        # the portal's own transparency, so a blanket layer is as see-through here as it is there
        "transparency": info.get("transparency") or 0,
        "base": base,
        "classes": cls,
    }


def main():
    out, failed = {}, []
    for table, (service, lid, extra) in MATCH.items():
        try:
            rec = read(service, lid)
        except (RuntimeError, urllib.error.URLError, TimeoutError) as e:
            failed.append(f"{table}: {e}")
            print(f"{table:<40} FAILED {e}")
            continue

        froms = [rec["from"]]
        for esvc, elid in extra:
            try:
                more = read(esvc, elid)
            except (RuntimeError, urllib.error.URLError, TimeoutError) as e:
                failed.append(f"{table} (extra {esvc}/{elid}): {e}")
                continue
            added = 0
            for label, sym in more["classes"].items():
                if label not in rec["classes"]:
                    rec["classes"][label] = sym
                    added += 1
            if more["type"] == "simple" and more["base"] and more["name"] not in rec["classes"]:
                rec["classes"][more["name"]] = more["base"]
                added += 1
            if added:
                froms.append(f"+ {PRETTY[esvc]}/{elid} {more['name']}")
        rec["from"] = " ".join(froms)

        promoted = BASE_FROM.get(table)
        if promoted and promoted in rec["classes"]:
            rec["base"] = dict(rec["classes"][promoted])
            rec["base_from"] = promoted
        elif promoted:
            failed.append(f"{table}: no class {promoted!r} to promote to the base symbol")

        out[table] = rec
        print(f"{table:<40} {service}/{lid:<5} {rec['type'] or '-':<12} "
              f"{len(rec['classes']):>3} classes  base={'yes' if rec['base'] else 'no ':<3} "
              f"{rec['name']}")

    svc, lid, label = NON_STANDARD_SOURCE
    try:
        src = read(svc, lid)["classes"].get(label)
    except (RuntimeError, urllib.error.URLError, TimeoutError) as e:
        src = None
        failed.append(f"non-standard base: {e}")
    for table in BORROW_NON_STANDARD:
        rec = out.get(table)
        if not rec or rec.get("base"):
            continue
        if not src:
            failed.append(f"{table}: no non-standard symbol to borrow, so an out-of-band value has no colour")
            continue
        rec["base"] = dict(src)
        rec["base_from"] = f"{label}, borrowed from {PRETTY[svc]}/{lid}"
        rec["from"] += f" + base: {PRETTY[svc]}/{lid} {label}"
        print(f"{table:<40} base borrowed from {PRETTY[svc]}/{lid} {label}")

    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n{len(out)} layers -> {OUT.relative_to(REPO)}")
    if failed:
        print(f"\n{len(failed)} problems:")
        for f in failed:
            print("  " + f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
