# OP SHOP — Yamaha TX81Z Editor

Web-based editor for the Yamaha TX81Z FM tone generator. Vanilla JS + Web MIDI,
no build step — sibling project to `../PCM 70 Editor` and `../EF-303 Editor`
(same stack and conventions).

Live at https://plentyofnames.github.io/opshop/ (also on the Software tab of
https://plentyofnam.es).

## Run it

Serve the folder over HTTP (Web MIDI needs a secure or localhost origin, and
`file://` blocks the module files):

```bash
python3 -m http.server 8917
```

Then open http://localhost:8917 in Chrome and allow the MIDI + sysex permission
prompt. Connect MIDI in **and** out to the TX81Z (dumps come back on the in
port), set the channel to the unit's basic receive channel, and make sure the
TX81Z has sysex enabled (UTILITY → MIDI CONTROL → EXCLUSIVE ON).

## What it does

- **Voice tab** — the full voice on one page: 4 operator strips (EG with
  thumbnail, scaling/sensitivity, output, ratio/fixed frequency with a live
  readout, the 8 operator waveforms drawn as they appear in the manual),
  algorithm diagram with carrier/modulator highlighting, LFO, function and
  controller sections. Every edit goes out live as a VCED/ACED parameter
  change.
- **Performance tab** — the 8-instrument performance (PCED): per-instrument
  voice assignment (with names), note limits, channel, detune/shift/volume,
  output assign, LFO select, microtune, plus effect/assign/microtune common
  settings.
- **Patch recall** — click any patch I01–D32 or PF1–24. Factory names for
  banks A–D are built in (from the owner's manual); *Scan I* / *Scan PF* read
  the user names from the unit via a VMEM/PMEM dump and cache them in
  localStorage. Recall works by rewriting slot 127 of the unit's
  program-change table via sysex, remote-pressing PLAY/PERFORM, sending PC
  127, then requesting an edit-buffer dump so the editor syncs.
- **Files** — open/save single voices (ACED+VCED `.syx`) and performances
  (PCED `.syx`); opening a VMEM/PMEM bank file shows a patch picker.
- **Mirroring** — front-panel edits on the unit (echoed as sysex parameter
  changes) update the editor.
- A little keyboard at the bottom for auditioning, with velocity.

## Hardware facts that shape the design

Transcribed from Edisyn's `Yamaha4Op` implementation (`edisyn-master/`), which
corrects several errors in the TX81Z manual:

- The manual's dump-request substatus (`0n`) is wrong — requests use `2n`.
- The PCED parameter-change group is `0x10`, not the documented `0x13`.
- PF slots in the program-change table start at 160, not the documented 161.
- Checksum: two's complement of the 7-bit sum of the data bytes.
- **Single voices cannot be written to a numbered slot** — only the edit
  buffer. Store from the front panel (STORE button), like Edisyn.
- VCED/ACED dumps order operators 4, 2, 3, 1.
- After a program change the unit needs ~500 ms before it answers a dump
  request reliably.

## Files

- `index.html` — UI + app (Midi / Store / UI layers, one paced send queue)
- `tx81z-core.js` — pure, DOM-free sysex encode/decode (used by tests)
- `tx81z-data.js` — parameter tables, factory names, ratio tables, algorithms
- `test.html` — round-trip assertions for the pure layer
- `edisyn-master/` — reference implementation (Java), kept for consultation
