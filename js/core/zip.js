// js/core/zip.js — a minimal ZIP reader/writer with no dependencies.
//
// Enough of the format for backup files: stored or raw-deflate entries, UTF-8
// names, no encryption, no ZIP64. Compression uses the platform's
// CompressionStream/DecompressionStream ('deflate-raw'), which are available in
// every browser that can run this app; without them files are stored.
//
// Writing is async because the deflate stream is async; reading likewise.
// Entries produced by other tools (data descriptors, extra fields) work because
// the central directory is the source of truth for sizes and offsets.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out.length < bytes.length ? out : null;
  } catch (e) {
    return null;
  }
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress deflated zip entries');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a zip. files: [{ name, data: string | Uint8Array }]
 * Resolves to a Uint8Array.
 */
export async function createZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime(now);

  for (const file of files) {
    const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
    const nameBytes = enc.encode(file.name);
    const crc = crc32(data);
    const deflated = data.length > 256 ? await deflateRaw(data) : null;
    const method = deflated ? 8 : 0;
    const body = deflated || data;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0x0800, true);      // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    locals.push(local, body);
    central.push({ nameBytes, crc, method, compSize: body.length, size: data.length, offset });
    offset += local.length + body.length;
  }

  const cdParts = [];
  let cdSize = 0;
  for (const e of central) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.compSize, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);  // extra
    cv.setUint16(32, 0, true);  // comment
    cv.setUint16(34, 0, true);  // disk
    cv.setUint16(36, 0, true);  // internal attrs
    cv.setUint32(38, 0, true);  // external attrs
    cv.setUint32(42, e.offset, true);
    cd.set(e.nameBytes, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of locals) { out.set(part, p); p += part.length; }
  for (const part of cdParts) { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

/** Read a zip into [{ name, data: Uint8Array }]. */
export async function readZip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== SIG_CENTRAL) throw new Error('Damaged zip (central directory)');
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    if (dv.getUint32(localOff, true) !== SIG_LOCAL) throw new Error('Damaged zip (local header)');
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`Unsupported compression method ${method}`);
    if (!name.endsWith('/')) out.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Convenience: entries whose name ends with `ext`, decoded as UTF-8 text. */
export async function readZipTexts(bytes, ext = '.pgn') {
  const entries = await readZip(bytes);
  const dec = new TextDecoder();
  return entries
    .filter((e) => e.name.toLowerCase().endsWith(ext))
    .map((e) => ({ name: e.name, text: dec.decode(e.data) }));
}
