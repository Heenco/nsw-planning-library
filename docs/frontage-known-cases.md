# Frontage — known cases

Real lots that expose defects in the frontage calculation, with the evidence
and what each would take to fix. Written down rather than fixed immediately
because every one of them is a change to how runs are built or merged, and that
moves the numbers for **every cul-de-sac and corner lot in NSW** — so each needs
a before/after over a sample, not a spot fix.

Reproduce any of these with:

```bash
curl -s "http://localhost:3000/api/frontage?lot=<LOT>" | jq
```

The regression harness is `scripts/frontage-selftest.mjs` (7 lot fixtures,
cached so it runs offline). None of the lots below is in it yet; adding them is
the first step of fixing any of them, because the fixtures are what will show
whether a change to run-building broke the cases that already work.

---

## The common root

`classifyBoundary` decides which boundary edges are open, and groups consecutive
open edges into **runs**. `mergeByRoad` then joins runs that share a road name.

Both steps lean on the road name, and the road name comes from a second pass
over `road_segments` that frequently finds nothing — a cul-de-sac head is often
unnamed in that layer, and the centreline stops short of the bulb. When naming
fails there is nothing left to say where one frontage ends and the next begins,
and the two cases below are the two ways that goes wrong: a frontage that stays
split when it should join, and two frontages that join when they should stay
split.

`up_property_d_4.all_frontages` is a useful second opinion — it has already done
a road-to-parcel join statewide — and is what `server/api/frontage.get.ts` now
uses to name a run when the tile layer cannot. But it is a snapshot, it
sometimes disagrees, and it names a frontage by total length rather than by
edge, so it cannot settle where a run should be cut.

---

## Case A — a named fragment beats the real frontage

**`272//DP237530` — 6 Bromley Street Toronto**, 712 m², triangular, at a
cul-de-sac head.

| | |
|---|---|
| Reported primary | **BROMLEY 3.09 m**, basis `address` |
| Should be | **≈10.16 m** to Bromley Street |
| `d_4.all_frontages` | `BROMLEY STREET:7.07m, BROMLEY STREET:3.09m` |
| `d_4.primary_frontage_length_m` | **7.07 m** |

The two open runs are **contiguous**; edge 2 ends and edge 3 begins at exactly
`[151.5788862400149, -33.01014406103023]`:

```
edge 2   3.09 m   bearing 221.54°   BROMLEY (named from d_4)
edge 3   7.07 m   bearing 267.26°   unnamed — "no named road within range"
```

Together they are one continuous 10.16 m stretch facing the bulb, split because
the bearing turns 46° as the boundary follows the curve. `mergeByRoad` cannot
join them: it merges only runs that carry a name, and edge 3 has none.

So the address lookup worked, matched the run named BROMLEY, and that run is a
**fragment** of the frontage rather than the whole of it.

**Checked again 11 Sep 2026, against a reloaded `up_property_d_4`.** The stored
row has moved and is no longer the same second opinion it was when this was
written: it now names both fragments, with full street names, and takes the
longer one as primary — 7.07 m rather than 3.09 m. Better, and still wrong, in
the way this case describes. The two runs remain split because `mergeByRoad`
merges by name and both now carry one, but nothing joins them into the single
10.16 m stretch they physically are. Naming improved; run-building did not.

**Fix:** an open run contiguous with a named run, carrying no competing road
name of its own, should join it before the primary is chosen. On
`100//DP1139278` the same rule merges three cul-de-sac fragments into 16.71 m.

---

## Case B — two streets merged into one frontage

**`4//DP21303` — 240 Awaba Road Toronto**, 567 m², corner of Awaba Road and
Glenfield.

| | |
|---|---|
| Reported primary | **unnamed, 51.24 m**, basis `only_street_frontage` |
| `d_4.all_frontages` | `GLENFIELD ROAD:51.24m` — **one** frontage |
| Depth / width | **all null** — the sweep produced nothing at all |

Four consecutive open edges were grouped into a single run:

```
edge 0   31.91 m        edge 2   11.32 m
edge 1    7.84 m        edge 3    0.17 m   ← sliver
                        run: edges [0,1,2,3] = 51.24 m, bearing 9.9°
```

The run wraps **around the street corner**, so:

- the lot is not recognised as a corner lot — with one run there is nothing to
  compare, and the basis comes back `only_street_frontage`
- no road name attaches, because no single centreline runs along all of it
- `sweepLot` cannot establish a frontage direction from a run that turns a
  corner, so **depth, core depth and width are all null** — the dimensions panel
  is empty on a perfectly ordinary suburban lot

Note the 0.17 m sliver at edge 3. Degenerate edges like this are common in the
cadastre and are worth handling explicitly: they contribute nothing to a
frontage and can only distort a bearing.

**Fix:** runs need a second cut besides the road name — a bearing change beyond
some threshold is a corner whether or not the streets are named. Which is the
same threshold Case A needs relaxed, in the other direction, so the two have to
be solved together rather than tuned independently.

The neighbouring lot `5//DP21303` (242 Awaba Road) is the control: same street,
same block, 15.22 m AWABA from the address, depth 35.5 m — all correct.

**Checked again 11 Sep 2026, against a reloaded `up_property_d_4`.** This one
got worse, and it is the more important of the two updates. The stored row used
to disagree with the API — two frontages, 31.82 m and 11.5 m — and that
disagreement was the evidence that the merged 51.24 m run was wrong. It now
reads `GLENFIELD ROAD:51.24m`, `frontage_count` 1, `is_corner_lot` false, and
depth, core depth and width all null. The table has been reloaded from the same
method the API uses, so it now agrees with the defect and there is no
independent witness left for this case.

Which means the "useful second opinion" `all_frontages` gave under *The common
root* no longer holds where the two are computed the same way. A fix has to be
argued from the geometry — the four edges above and the 9.9° run bearing across
a street corner — rather than from a stored column that now reproduces it.

---

## What a fix has to preserve

- `scripts/frontage-selftest.mjs` — 7 lot fixtures, all currently passing
- `A//DP408911` — 2 runs, 390.65 m open of 651.66 m
- `1//DP214129` — 2 runs, 98.57 m open of 198.9 m
- `100//DP1139278` — 4 runs today; a correct fix makes this **2**
  (32.59 m Fenton + 16.71 m to the cul-de-sac)

## Related, not the same

- `shortest_no_address` has no floor: with no address and no `all_frontages`
  match, the shortest run wins however small. See `pickPrimary` in
  `shared/frontage-roads.mjs`.
- The Martin `lot` tile layer is a **fallback** for the cadastre, not the
  primary, because it and `d_4` share a snapshot while SIX is live — on
  `A//DP408911` the tile ring sits 24.9 m from SIX's with area and perimeter
  both inside 5%. See `server/utils/lot-tiles.ts`.
