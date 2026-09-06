/* ============================================================================
 * tx81z-data.js — static tables for the Yamaha TX81Z
 *
 * Sources:
 *  - Edisyn's edisyn/synth/yamaha4op/Yamaha4Op.java + Yamaha4OpMulti.java
 *    (parameter order, sysex groups, packed VMEM/PMEM layouts, ratio tables)
 *  - TX81Z Owner's Manual (factory voice list, value ranges)
 * Nothing in here touches the DOM or MIDI.
 * ==========================================================================*/
(function (root) {
  "use strict";

  /* ---- sysex constants --------------------------------------------------- */

  const GROUP_VCED = 0x12; // voice parameter change group
  const GROUP_ACED = 0x13; // additional voice params + remote switch group
  const GROUP_PCED = 0x10; // performance params + program-change table

  // The VCED/ACED dumps carry operators in the order OP4, OP2, OP3, OP1.
  // OP_SLOT[op-1] = that operator's slot index within the dump.
  const OP_SLOT = [3, 1, 2, 0]; // OP1->slot3, OP2->slot1, OP3->slot2, OP4->slot0

  const BANKS = ["I", "A", "B", "C", "D"];

  /* ---- frequency ratio tables (Edisyn, via Matt Gregory / the-all.org) --- */

  const FREQUENCY_RATIOS = [0.50, 0.71, 0.78, 0.87, 1.00, 1.41, 1.57, 1.73, 2.00, 2.82, 3.00, 3.14, 3.46, 4.00, 4.24, 4.71, 5.00, 5.19, 5.65, 6.00, 6.28, 6.92, 7.00, 7.07, 7.85, 8.00, 8.48, 8.65, 9.00, 9.42, 9.89, 10.00, 10.38, 10.99, 11.00, 11.30, 12.00, 12.11, 12.56, 12.72, 13.00, 13.84, 14.00, 14.10, 14.13, 15.00, 15.55, 15.57, 15.70, 16.96, 17.27, 17.30, 18.37, 18.84, 19.03, 19.78, 20.41, 20.76, 21.20, 21.98, 22.49, 23.55, 24.22, 25.95];
  const FREQUENCY_RATIOS_MAX = [0.93, 1.32, 1.37, 1.62, 1.93, 2.73, 3.04, 3.35, 2.93, 4.14, 3.93, 4.61, 5.08, 4.93, 5.55, 6.18, 5.93, 6.81, 6.96, 6.93, 7.75, 8.54, 7.93, 8.37, 9.32, 8.93, 9.78, 10.27, 9.93, 10.89, 11.19, 10.93, 12.00, 12.46, 11.93, 12.60, 12.93, 13.73, 14.03, 14.01, 13.93, 15.46, 14.93, 15.42, 15.60, 15.93, 16.83, 17.19, 17.17, 18.24, 18.74, 18.92, 19.65, 20.31, 20.65, 21.06, 21.88, 22.38, 22.47, 23.45, 24.11, 25.02, 25.84, 27.57];

  // Ratio mode: interpolate between table min and max by the fine value.
  function fineRatio(coarse, fine) {
    const min = FREQUENCY_RATIOS[coarse], max = FREQUENCY_RATIOS_MAX[coarse];
    if (min < 1.0) return Math.min(max, min + ((max - min) / 7) * fine);
    return min + ((max - min) / 15) * fine;
  }

  // Fixed mode: frequency in Hz. fine is clamped to 0..7 when coarse < 4.
  function fixedFrequency(range, coarse, fine) {
    const base = 1 << range;
    if (coarse < 4) return (8 + Math.min(fine, 7)) * base;
    return (16 * Math.floor(coarse / 4) + fine) * base;
  }

  /* ---- value labels ------------------------------------------------------ */

  const LFO_WAVES = ["Saw Up", "Square", "Triangle", "S/Hold"];
  const EG_SHIFTS = ["Off", "48dB", "24dB", "12dB"];
  const OP_WAVE_COUNT = 8; // W1..W8, drawn as SVG in the app
  const REVERB_RATES = ["Off", "1", "2", "3", "4", "5", "6", "7"];

  // Performance-side labels (Edisyn Yamaha4OpMulti).
  const OUT_ASSIGN = ["Off", "I", "II", "I+II"];
  const LFO_SELECT = ["Off", "Inst 1", "Inst 2", "Vibrato"];
  const EFFECTS = ["Off", "Delay", "Pan", "Chord"];
  const ASSIGN_MODES = ["Normal", "Alternate"];
  const MICROTUNE_TABLES = ["Equal", "Pure (Maj)", "Pure (Min)", "Mean Tone",
    "Pythagorean", "Werckmeist", "Kirnberger", "Vallotti&Y",
    "1/4 Shift", "1/4 Tone", "1/8 Tone", "User (Oct)", "User (Full)"];
  const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // Yamaha octave numbering: MIDI note 0 = C-2 (so 60 = C3).
  function noteName(n) {
    return KEYS[n % 12] + (Math.floor(n / 12) - 2);
  }

  /* ---- algorithms --------------------------------------------------------
   * Node layout + wiring per the 8 TX81Z algorithms (feedback is always OP4).
   * pos: [col, row] on a small grid, row 0 = bottom (carriers).
   * edges: [from, to] operator numbers.
   */
  const ALGORITHMS = [
    { carriers: [1], pos: { 1: [0, 0], 2: [0, 1], 3: [0, 2], 4: [0, 3] }, edges: [[4, 3], [3, 2], [2, 1]] },
    { carriers: [1], pos: { 1: [0.5, 0], 2: [0.5, 1], 3: [0, 2], 4: [1, 2] }, edges: [[4, 2], [3, 2], [2, 1]] },
    { carriers: [1], pos: { 1: [1, 0], 2: [0, 1], 3: [0, 2], 4: [1, 1] }, edges: [[3, 2], [2, 1], [4, 1]] },
    { carriers: [1], pos: { 1: [0.5, 0], 2: [0, 1], 3: [1, 1], 4: [1, 2] }, edges: [[4, 3], [2, 1], [3, 1]] },
    { carriers: [1, 3], pos: { 1: [0, 0], 2: [0, 1], 3: [1, 0], 4: [1, 1] }, edges: [[2, 1], [4, 3]] },
    { carriers: [1, 2, 3], pos: { 1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [2, 1] }, edges: [[4, 1], [4, 2], [4, 3]] },
    { carriers: [1, 2, 3], pos: { 1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [2, 1] }, edges: [[4, 3]] },
    { carriers: [1, 2, 3, 4], pos: { 1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [3, 0] }, edges: [] },
  ];

  /* ---- factory voice names (banks A-D, TX81Z Owner's Manual p.4) --------- */

  const FACTORY_NAMES = {
    A: ["GrandPiano", "Uprt Piano", "Deep Grd", "HonkeyTonk", "Elec Grand", "Fuzz Piano", "SkoolPiano", "Thump Pno",
      "LoTine81Z", "HiTine81Z", "ElectroPno", "NewElectro", "DynomiteEP", "DynoWurlie", "Wood Piano", "Reed Piano",
      "PercOrgan", "16'8'4'2F", "PumpOrgan", "<6 Tease>", "Farcheeza", "Small Pipe", "Big Church", "AnalogOrgn",
      "Thin Clav", "EZ Clav", "Fuzz Clavi", "LiteHarpsi", "RichHarpsi", "Celeste", "BriteCelst", "Squeezebox"],
    B: ["Trumpet81Z", "Full Brass", "FlugelHorn", "ChorusBras", "FrenchHorn", "AtackBrass", "SpitBoneBC", "Horns BC",
      "MelloTenor", "RaspAlto", "Flute", "Pan Floot", "Basson", "Oboe", "Clarinet", "Harmonica",
      "DoubleBass", "BowCello", "BoxCello", "SoloViolin", "HiString 1", "LowString", "Pizzicato", "Harp",
      "ReverbStrg", "SynString", "Voices", "HarmoPad", "FanfarTpts", "HiString 2", "PercFlute", "BreathOrgn"],
    C: ["NylonGuit", "Guitar # 1", "TwelveStrg", "Funky Pick", "AllThatJaz", "HeavyMetal", "Old Banjo", "Zither",
      "ElecBass 1", "SqncrBass", "SynFunkBas", "ElecBass 2", "AnalogBass", "Jaco Bass", "LatelyBass", "MonophBass",
      "StadiumSol", "TrumptSolo", "BCSexyPhon", "Lyrisyn", "WarmSquare", "Sync Lead", "MellowSqar", "Jazz Flute",
      "Heavy Lead", "Java Jive", "Xylophone", "GreatVibes", "Sitar", "Bell Pad", "PlasticHit", "DigiAnnie"],
    D: ["BaadBreath", "VocalNuts", "KrstlChoir", "Metalimba", "WaterGlass", "BowedBell", "> >WOW< <", "Fuzzy Koto",
      "Spc Midiot", "Gurgle", "Hole in 1", "Birds", "MalibuNite", "Helicopter", "Flight Sim", "Brthbells",
      "Storm Wind", "Alarm Call", "Racing Car", "Whistling", "Space Talk", "Space Vibe", "Timpani", "FM Hi-Hats",
      "Bass Drum", "Tube Bells", "Noise Shot", "Snare 1", "Snare 2", "Hand Drum", "Synballs", "Efem Toms"],
  };

  /* ---- init voice / init performance ------------------------------------- */

  function initVoice() {
    const op = () => ({
      ar: 31, d1r: 31, d2r: 0, rr: 15, d1l: 15, ls: 0, rs: 0, ebs: 0, ame: 0,
      kvs: 0, out: 0, crs: 4, det: 3,       // ratio 1.00, detune center
      fix: 0, fixrg: 0, fin: 0, opw: 0, shft: 0,
    });
    const v = {
      name: "INIT VOICE",
      ops: [op(), op(), op(), op()],        // index 0..3 = OP1..OP4
      alg: 0, fb: 0,
      lfs: 35, lfd: 0, pmd: 0, amd: 0, sync: 0, lfw: 2, pms: 0, ams: 0,
      trps: 24, mono: 0, pbr: 2, portm: 0, portt: 0, fcvol: 99,
      sus: 1, porta: 0, chorus: 0,
      mwp: 50, mwa: 0, bcp: 0, bca: 0, bcpb: 50, bceb: 0,
      peg: [0, 0, 0, 0, 0, 0],              // DX21 pitch EG bytes; kept for round-trip
      rev: 0, fcp: 0, fca: 0,
    };
    v.ops[0].out = 90;
    return v;
  }

  function initPerformance() {
    const inst = (i) => ({
      maxnotes: i === 0 ? 8 : 0, voice: 0, ch: 0, low: 0, high: 127,
      det: 7, shift: 24, vol: 99, out: 3, lfo: 0, micro: 0,
    });
    return {
      name: "INIT PERF",
      insts: [0, 1, 2, 3, 4, 5, 6, 7].map(inst),
      microtable: 0, assign: 0, effect: 0, microkey: 0,
    };
  }

  root.TXD = {
    GROUP_VCED, GROUP_ACED, GROUP_PCED, OP_SLOT, BANKS,
    FREQUENCY_RATIOS, FREQUENCY_RATIOS_MAX, fineRatio, fixedFrequency,
    LFO_WAVES, EG_SHIFTS, OP_WAVE_COUNT, REVERB_RATES,
    OUT_ASSIGN, LFO_SELECT, EFFECTS, ASSIGN_MODES, MICROTUNE_TABLES, KEYS,
    noteName, ALGORITHMS, FACTORY_NAMES, initVoice, initPerformance,
  };
})(typeof window !== "undefined" ? window : globalThis);
