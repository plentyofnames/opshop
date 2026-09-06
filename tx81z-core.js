/* ============================================================================
 * tx81z-core.js — pure, DOM-free sysex layer for the Yamaha TX81Z
 *
 * Every function is a pure transform (bytes <-> plain objects); no DOM, no
 * Web MIDI, no localStorage. Framing transcribed from Edisyn's Yamaha4Op
 * implementation, which corrects several errors in the TX81Z manual:
 *   - voice dump request header is 2n, not 0n
 *   - PCED parameter group is 0x10, not 0x13
 *   - PF slots in the program-change table start at 160, not 161
 *
 * Message map (n = channel 0-15):
 *   param change   F0 43 1n GG PP VV F7          GG: 12=VCED 13=ACED 10=PCED
 *   VCED dump      F0 43 0n 03 00 5D [93] ck F7
 *   ACED dump      F0 43 0n 7E 00 21 "LM  8976AE" [23] ck F7
 *   PCED dump      F0 43 0n 7E 00 78 "LM  8976PE" [110] ck F7
 *   VMEM dump      F0 43 0n 04 20 00 [4096] ck F7      (user bank, 32 voices)
 *   PMEM dump      F0 43 0n 7E .. .. "LM  8976PM" [..] ck F7  (24 perfs)
 *   requests       F0 43 2n 7E "LM  8976AE|PE|PM" F7 ; VMEM: F0 43 2n 04 F7
 * ==========================================================================*/
(function (root) {
  "use strict";

  const D = root.TXD;
  const F0 = 0xf0, F7 = 0xf7, YAMAHA = 0x43;
  const OP_FOR_SLOT = [4, 2, 3, 1]; // dump slot k holds this operator (1-based)

  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
  const MAGIC_VOICE = ascii("LM  8976AE");
  const MAGIC_PERF = ascii("LM  8976PE");
  const MAGIC_PMEM = ascii("LM  8976PM");

  // Two's complement of the 7-bit sum of the data bytes (Edisyn's corrected
  // version of the manual's description).
  function checksum(bytes, start, end) {
    let s = 0;
    for (let i = start; i < end; i++) s = (s + bytes[i]) & 0xff;
    return (256 - s) & 0x7f;
  }

  function cleanName(str) {
    let out = "";
    for (const ch of String(str)) {
      const c = ch.charCodeAt(0);
      out += (c < 32 || c > 126) ? " " : ch;
    }
    return out.slice(0, 10);
  }
  const padName = (s) => (cleanName(s) + "          ").slice(0, 10);

  // read a 10-char name out of a dump; trailing pad spaces dropped
  function readName(d, off) {
    return cleanName(String.fromCharCode(...Array.from({ length: 10 }, (_, i) => d[off + i] & 127)))
      .replace(/\s+$/, "");
  }

  /* ---- builders: parameter changes + requests ---------------------------- */

  function paramChange(ch, group, pp, vv) {
    return new Uint8Array([F0, YAMAHA, 0x10 | (ch & 0x0f), group & 0x7f, pp & 0x7f, vv & 0x7f, F7]);
  }

  // Recall a patch by rewriting slot 127 of the unit's program-change table,
  // remotely pressing PLAY/PERFORM, then sending PC 127.
  //   value 0-159: voices I01..D32     value 160-183: performances PF1..PF24
  function recallMessages(ch, value) {
    const n = ch & 0x0f;
    const table = new Uint8Array([F0, YAMAHA, 0x10 | n, D.GROUP_PCED, 127, 127, (value >> 7) & 0x7f, value & 0x7f, F7]);
    const playPerform = new Uint8Array([F0, YAMAHA, 0x10 | n, D.GROUP_ACED, 68, 0x7f, F7]);
    const pc = new Uint8Array([0xc0 | n, 127]);
    return [table, playPerform, pc];
  }

  const requestVoice = (ch) => new Uint8Array([F0, YAMAHA, 0x20 | (ch & 15), 0x7e, ...MAGIC_VOICE, F7]);
  const requestPerf = (ch) => new Uint8Array([F0, YAMAHA, 0x20 | (ch & 15), 0x7e, ...MAGIC_PERF, F7]);
  const requestUserBank = (ch) => new Uint8Array([F0, YAMAHA, 0x20 | (ch & 15), 0x04, F7]);
  const requestPerfBank = (ch) => new Uint8Array([F0, YAMAHA, 0x20 | (ch & 15), 0x7e, ...MAGIC_PMEM, F7]);

  /* ---- voice <-> VCED (93 bytes) / ACED (23 bytes) ----------------------- */

  function encodeVcedData(v) {
    const d = new Uint8Array(93);
    for (let k = 0; k < 4; k++) {
      const o = v.ops[OP_FOR_SLOT[k] - 1], b = k * 13;
      [o.ar, o.d1r, o.d2r, o.rr, o.d1l, o.ls, o.rs, o.ebs, o.ame, o.kvs, o.out, o.crs, o.det]
        .forEach((val, i) => { d[b + i] = val & 0x7f; });
    }
    [v.alg, v.fb, v.lfs, v.lfd, v.pmd, v.amd, v.sync, v.lfw, v.pms, v.ams, v.trps,
      v.mono, v.pbr, v.portm, v.portt, v.fcvol, v.sus, v.porta, v.chorus,
      v.mwp, v.mwa, v.bcp, v.bca, v.bcpb, v.bceb]
      .forEach((val, i) => { d[52 + i] = val & 0x7f; });
    const name = padName(v.name);
    for (let i = 0; i < 10; i++) d[77 + i] = name.charCodeAt(i);
    for (let i = 0; i < 6; i++) d[87 + i] = (v.peg[i] || 0) & 0x7f;
    return d;
  }

  function encodeAcedData(v) {
    const d = new Uint8Array(23);
    for (let k = 0; k < 4; k++) {
      const o = v.ops[OP_FOR_SLOT[k] - 1], b = k * 5;
      d[b + 0] = o.fix & 1;
      d[b + 1] = o.fixrg & 7;
      d[b + 2] = (o.crs < 4 ? Math.min(o.fin, 7) : o.fin) & 15;
      d[b + 3] = o.opw & 7;
      d[b + 4] = o.shft & 3;
    }
    d[20] = v.rev & 7; d[21] = v.fcp & 0x7f; d[22] = v.fca & 0x7f;
    return d;
  }

  function frame(ch, header, payload) {
    // header = the two byte-count bytes after F0 43 0n TT; payload checksummed.
    const out = new Uint8Array(6 + payload.length + 2);
    out.set([F0, YAMAHA, ch & 0x0f, header[0], header[1], header[2]], 0);
    out.set(payload, 6);
    out[6 + payload.length] = checksum(out, 6, 6 + payload.length);
    out[7 + payload.length] = F7;
    return out;
  }

  // Full voice -> [ACED dump, VCED dump] (send/save in this order; the unit
  // replies to a voice request the same way).
  function voiceDumps(ch, v) {
    const aced = frame(ch, [0x7e, 0x00, 0x21], new Uint8Array([...MAGIC_VOICE, ...encodeAcedData(v)]));
    const vced = frame(ch, [0x03, 0x00, 0x5d], encodeVcedData(v));
    return [aced, vced];
  }

  // d = 93 VCED data bytes; merges into (a copy of) voice object v.
  function decodeVced(d, v) {
    const out = JSON.parse(JSON.stringify(v));
    for (let k = 0; k < 4; k++) {
      const o = out.ops[OP_FOR_SLOT[k] - 1], b = k * 13;
      o.ar = d[b] & 31; o.d1r = d[b + 1] & 31; o.d2r = d[b + 2] & 31;
      o.rr = d[b + 3] & 15; o.d1l = d[b + 4] & 15; o.ls = Math.min(d[b + 5] & 127, 99);
      o.rs = d[b + 6] & 3; o.ebs = d[b + 7] & 7; o.ame = d[b + 8] & 1;
      o.kvs = d[b + 9] & 7; o.out = Math.min(d[b + 10] & 127, 99);
      o.crs = d[b + 11] & 63; o.det = Math.min(d[b + 12] & 7, 6);
    }
    const c = (i, mask) => d[52 + i] & (mask || 127);
    out.alg = c(0, 7); out.fb = c(1, 7); out.lfs = c(2); out.lfd = c(3);
    out.pmd = c(4); out.amd = c(5); out.sync = c(6, 1); out.lfw = c(7, 3);
    out.pms = c(8, 7); out.ams = c(9, 3); out.trps = Math.min(c(10, 63), 48);
    out.mono = c(11, 1); out.pbr = Math.min(c(12, 15), 12); out.portm = c(13, 1);
    out.portt = c(14); out.fcvol = c(15); out.sus = c(16, 1); out.porta = c(17, 1);
    out.chorus = c(18, 1); out.mwp = c(19); out.mwa = c(20); out.bcp = c(21);
    out.bca = c(22); out.bcpb = c(23); out.bceb = c(24);
    out.name = readName(d, 77);
    out.peg = Array.from({ length: 6 }, (_, i) => d[87 + i] & 127);
    return out;
  }

  // d = 23 ACED data bytes; merges into (a copy of) voice object v.
  function decodeAced(d, v) {
    const out = JSON.parse(JSON.stringify(v));
    for (let k = 0; k < 4; k++) {
      const o = out.ops[OP_FOR_SLOT[k] - 1], b = k * 5;
      o.fix = d[b] & 1; o.fixrg = d[b + 1] & 7; o.fin = d[b + 2] & 15;
      o.opw = d[b + 3] & 7; o.shft = d[b + 4] & 3;
    }
    out.rev = d[20] & 7; out.fcp = Math.min(d[21] & 127, 99); out.fca = Math.min(d[22] & 127, 99);
    return out;
  }

  /* ---- performance <-> PCED (110 bytes) ---------------------------------- */

  function encodePcedData(p) {
    const d = new Uint8Array(110);
    p.insts.forEach((s, i) => {
      const b = i * 12;
      d[b + 0] = s.maxnotes & 15;
      d[b + 1] = (s.voice >> 7) & 1;
      d[b + 2] = s.voice & 127;
      d[b + 3] = s.ch & 31;
      d[b + 4] = s.low & 127; d[b + 5] = s.high & 127;
      d[b + 6] = s.det & 15; d[b + 7] = s.shift & 63;
      d[b + 8] = s.vol & 127; d[b + 9] = s.out & 3;
      d[b + 10] = s.lfo & 3; d[b + 11] = s.micro & 1;
    });
    d[96] = p.microtable & 15; d[97] = p.assign & 1;
    d[98] = p.effect & 3; d[99] = p.microkey & 15;
    const name = padName(p.name);
    for (let i = 0; i < 10; i++) d[100 + i] = name.charCodeAt(i);
    return d;
  }

  const perfDump = (ch, p) =>
    frame(ch, [0x7e, 0x00, 0x78], new Uint8Array([...MAGIC_PERF, ...encodePcedData(p)]));

  function decodePced(d) {
    const p = D.initPerformance();
    p.insts.forEach((s, i) => {
      const b = i * 12;
      s.maxnotes = Math.min(d[b] & 15, 8);
      s.voice = (((d[b + 1] & 1) << 7) | (d[b + 2] & 127)) % 160;
      s.ch = Math.min(d[b + 3] & 31, 16);
      s.low = d[b + 4] & 127; s.high = d[b + 5] & 127;
      s.det = Math.min(d[b + 6] & 15, 14); s.shift = Math.min(d[b + 7] & 63, 48);
      s.vol = Math.min(d[b + 8] & 127, 99); s.out = d[b + 9] & 3;
      s.lfo = d[b + 10] & 3; s.micro = d[b + 11] & 1;
    });
    p.microtable = Math.min(d[96] & 15, 12); p.assign = d[97] & 1;
    p.effect = d[98] & 3; p.microkey = Math.min(d[99] & 15, 11);
    p.name = readName(d, 100);
    return p;
  }

  /* ---- packed bank formats: VMEM (voices) and PMEM (performances) -------- */

  // d = 128 packed bytes for one VMEM voice slot.
  function decodeVmemVoice(d) {
    const v = D.initVoice();
    for (let k = 0; k < 4; k++) {
      const o = v.ops[OP_FOR_SLOT[k] - 1], b = k * 10;
      o.ar = d[b] & 31; o.d1r = d[b + 1] & 31; o.d2r = d[b + 2] & 31;
      o.rr = d[b + 3] & 15; o.d1l = d[b + 4] & 15; o.ls = Math.min(d[b + 5] & 127, 99);
      o.rs = (d[b + 9] >> 3) & 3;
      o.ebs = (d[b + 6] >> 3) & 7; o.ame = (d[b + 6] >> 6) & 1; o.kvs = d[b + 6] & 7;
      o.out = Math.min(d[b + 7] & 127, 99); o.crs = d[b + 8] & 63; o.det = Math.min(d[b + 9] & 7, 6);
      const e = 73 + k * 2;
      o.fix = (d[e] >> 3) & 1; o.fixrg = d[e] & 7; o.shft = (d[e] >> 4) & 3;
      o.fin = d[e + 1] & 15; o.opw = (d[e + 1] >> 4) & 7;
    }
    v.alg = d[40] & 7; v.fb = (d[40] >> 3) & 7; v.sync = (d[40] >> 6) & 1;
    v.lfs = d[41] & 127; v.lfd = d[42] & 127; v.pmd = d[43] & 127; v.amd = d[44] & 127;
    v.lfw = d[45] & 3; v.ams = (d[45] >> 2) & 3; v.pms = (d[45] >> 4) & 7;
    v.trps = Math.min(d[46] & 63, 48); v.pbr = Math.min(d[47] & 15, 12);
    v.portm = d[48] & 1; v.porta = (d[48] >> 1) & 1; v.sus = (d[48] >> 2) & 1;
    v.mono = (d[48] >> 3) & 1; v.chorus = (d[48] >> 4) & 1;
    v.portt = d[49] & 127; v.fcvol = d[50] & 127;
    v.mwp = d[51] & 127; v.mwa = d[52] & 127;
    v.bcp = d[53] & 127; v.bca = d[54] & 127; v.bcpb = d[55] & 127; v.bceb = d[56] & 127;
    v.name = readName(d, 57);
    v.peg = Array.from({ length: 6 }, (_, i) => d[67 + i] & 127);
    v.rev = d[81] & 7; v.fcp = Math.min(d[82] & 127, 99); v.fca = Math.min(d[83] & 127, 99);
    return v;
  }

  // msg = full VMEM sysex (F0 43 0n 04 20 00 [4096] ck F7) -> 32 voices.
  const decodeVmem = (msg) =>
    Array.from({ length: 32 }, (_, i) => decodeVmemVoice(msg.subarray(6 + i * 128, 6 + i * 128 + 128)));

  // d = 76 packed bytes for one PMEM performance slot.
  function decodePmemPerf(d) {
    const p = D.initPerformance();
    p.insts.forEach((s, i) => {
      const b = i * 8;
      s.maxnotes = d[b] & 15;
      s.voice = (((d[b] >> 4) & 1) << 7 | (d[b + 1] & 127)) % 160;
      s.out = (d[b] >> 5) & 3;
      s.ch = Math.min(d[b + 2] & 31, 16); s.lfo = (d[b + 2] >> 5) & 3;
      s.low = d[b + 3] & 127; s.high = d[b + 4] & 127;
      s.det = Math.min(d[b + 5] & 15, 14);
      s.shift = Math.min(d[b + 6] & 63, 48); s.micro = (d[b + 6] >> 6) & 1;
      s.vol = Math.min(d[b + 7] & 127, 99);
    });
    p.microtable = Math.min(d[64] & 15, 12);
    p.assign = d[65] & 1; p.effect = (d[65] >> 1) & 3; p.microkey = (d[65] >> 3) & 15;
    p.name = readName(d, 66);
    return p;
  }

  // msg = full PMEM sysex -> 24 performances (payload starts after the
  // 16-byte header F0 43 0n 7E bc bc "LM  8976PM").
  const decodePmem = (msg) =>
    Array.from({ length: 24 }, (_, i) => decodePmemPerf(msg.subarray(16 + i * 76, 16 + i * 76 + 76)));

  /* ---- inbound classification -------------------------------------------- */

  function magicAt(msg, off, magic) {
    for (let i = 0; i < magic.length; i++) if ((msg[off + i] & 127) !== magic[i]) return false;
    return true;
  }

  // msg = one complete sysex message. Returns {type, ...} or null.
  function classify(msg) {
    if (msg.length < 5 || msg[0] !== F0 || msg[1] !== YAMAHA) return null;
    const sub = msg[2] & 0xf0, ch = msg[2] & 0x0f, tt = msg[3];
    if (sub === 0x10 && msg.length === 7) {
      return { type: "param", ch, group: msg[3], pp: msg[4], vv: msg[5] };
    }
    if (sub !== 0x00) return null;
    if (tt === 0x03 && msg.length >= 101 && msg[4] === 0x00 && msg[5] === 0x5d) {
      return { type: "vced", ch, data: msg.subarray(6, 99) };
    }
    if (tt === 0x04 && msg.length >= 4104 && msg[4] === 0x20 && msg[5] === 0x00) {
      return { type: "vmem", ch, msg };
    }
    if (tt === 0x7e && msg.length >= 17) {
      if (magicAt(msg, 6, MAGIC_VOICE) && msg.length >= 41) return { type: "aced", ch, data: msg.subarray(16, 39) };
      if (magicAt(msg, 6, MAGIC_PERF) && msg.length >= 128) return { type: "pced", ch, data: msg.subarray(16, 126) };
      if (magicAt(msg, 6, MAGIC_PMEM) && msg.length >= 16 + 24 * 76) return { type: "pmem", ch, msg };
    }
    return null;
  }

  // Split a .syx file (possibly several concatenated messages) into messages.
  function splitSysex(bytes) {
    const out = [];
    let start = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === F0) start = i;
      else if (bytes[i] === F7 && start >= 0) { out.push(bytes.subarray(start, i + 1)); start = -1; }
    }
    return out;
  }

  root.TXC = {
    checksum, cleanName, padName,
    paramChange, recallMessages,
    requestVoice, requestPerf, requestUserBank, requestPerfBank,
    encodeVcedData, encodeAcedData, voiceDumps, decodeVced, decodeAced,
    encodePcedData, perfDump, decodePced,
    decodeVmemVoice, decodeVmem, decodePmemPerf, decodePmem,
    classify, splitSysex,
  };
})(typeof window !== "undefined" ? window : globalThis);
