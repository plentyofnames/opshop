# OP SHOP (TX81Z Editor)

Web editor/librarian for the Yamaha TX81Z, published as **OP SHOP** at
plentyofnames.github.io/opshop (repo `plentyofnames/opshop`; a tile on the
plentyofnam.es Software tab embeds it — that site lives in
`../plentyofnam.es`, deployed from its `publish` branch).

Vanilla JS + Web MIDI, no build
step, no frameworks — sibling to `../PCM 70 Editor` (same stack; follow its
conventions: one paced send queue with per-key coalescing, pure byte-level
functions kept DOM-free and testable, CSS custom properties for light+dark).

**Protocol reference is Edisyn** (`edisyn-master/edisyn/synth/yamaha4op/`),
not the TX81Z manual — the manual has known errors (dump-request substatus,
PCED group number, PF program-change-table offset). README.md lists them.

Key facts that trip people up:

- VCED/ACED dumps order operators **4, 2, 3, 1** (`TXD.OP_SLOT` maps UI op →
  dump slot; param-change PP numbers derive from it).
- Patch recall = sysex-write PC-table slot 127 → remote-press PLAY/PERFORM
  (group 0x13, pp 68) → PC 127 → wait ~500 ms → dump request.
- Single voices go to the **edit buffer only**; storing to I01–I32 happens on
  the unit's front panel. Don't add a per-slot write without VMEM bank writes.
- Factory names for banks A–D are hardcoded in `tx81z-data.js` (typed in from
  the owner's manual voice list); I-bank and PF names come from VMEM/PMEM
  scans, cached in localStorage under `tx81z:names:*`.
- ACED fine is only 0–7 when coarse < 4 (encode clamps; UI shows the computed
  ratio/Hz readout via `TXD.fineRatio` / `TXD.fixedFrequency`).

Testing: `test.html` runs round-trip assertions over `tx81z-core.js` — open it
via the dev server (`.claude/launch.json`, port 8917) after touching the core.
No MIDI hardware in the preview pane; simulate receives by calling
`Midi.onSysex(TXC.classify(bytes))` from the console.
