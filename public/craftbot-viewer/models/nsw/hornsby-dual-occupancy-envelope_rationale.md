# Hornsby dual occupancy — planning envelope

**This is not a NSW Housing Pattern Book design.** The Pattern Book's dimensions
are published only in its downloadable pattern packs, which this repository does
not hold. Rather than invent them, this model shows the envelope a two-storey
dual occupancy has to fit inside in Hornsby, built from the controls our own rule
layer returns. A real pattern can be modelled inside this cage once we have one.

## Controls used

Verbatim from `node scripts/planningai-envelope.mjs "dual occupancy" --storeys 2`:

| Plane | Value | Source |
|---|---|---|
| Front setback | 9 m (most restrictive of 3 / 6 / 7.6 / 9) | DCP cl 3.1.2 |
| Rear setback | 8 m, 2 storeys | DCP cl 3.1.2 |
| Side setback | 1.5 m each, 2 storeys | DCP cl 3.1.2 |
| Height | 8.5 m above natural ground | HLEP area I (DCP cl 3.1.1) |

The front setback is context-dependent, so the three values not modelled are
drawn on the ground as `Setback_front_alternative_*` — the envelope is a range,
not a single number, and hiding that would misrepresent the control.

Instrument ranking: these are DCP controls. Under EP&A Act s3.28 an
environmental planning instrument prevails over a DCP.

## The lot is an assumption

15 x 40 m (600 m²) is a representative
Sydney residential lot, **not a real parcel**. `up_property_comprehensive` and
`lot_metrics_3` live in the `urbanportaldbp` database behind the tile server,
which was refusing connections when this was built. Replace `LOT` in
`scripts/build-envelope-model.mjs` with a real frontage and depth and every
derived plane follows.

## What the geometry says

- Buildable footprint: **12.0 x 23.0 m**
  (276 m²) of a 600 m² lot.
- Massing built: two attached dwellings, 5.90 m wide each,
  16 m deep, 7.0 m to roof — inside the 8.5 m limit
  with 1.5 m to spare.
- The massing is volumes, not framing. Whether the form fits the envelope is
  answerable from what we hold; stud positions are not.

## Layers

`foundations` lot · `other` envelope cage, setback planes, height limit ·
`floors` slabs · `cladding ext` dwelling volumes · `frame` party wall ·
`roof` roof. Toggle `other` off to see the massing alone.
