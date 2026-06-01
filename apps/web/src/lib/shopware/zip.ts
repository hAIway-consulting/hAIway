// Minimal ZIP writer (stored / no compression).
//
// Shopware's app upload expects a ZIP archive whose single root directory is
// named after the app's technical name, with manifest.xml inside it
// (`<AppName>/manifest.xml`). A bare manifest.xml is rejected with
// "No manifest.xml found". We only ever pack a couple of tiny text files, so
// the "stored" method (no DEFLATE) keeps this dependency-free and trivially
// verifiable while producing an archive any unzipper — including Shopware's
// PHP ZipArchive — accepts.

import { Buffer } from "node:buffer";

export interface ZipEntry {
  // Forward-slash path inside the archive. A trailing "/" marks a directory.
  name: string;
  data: Buffer;
}

// CRC-32 (IEEE 802.3), computed bitwise — fine for the few hundred bytes we pack.
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp (1980-01-01 00:00) so the archive is deterministic.
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021;

export function createStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const isDir = entry.name.endsWith("/");
    const data = isDir ? Buffer.alloc(0) : entry.data;
    const crc = isDir ? 0 : crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed to extract
    local.writeUInt16LE(0, 6);          // general purpose bit flag
    local.writeUInt16LE(0, 8);          // compression method: 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);      // compressed size
    local.writeUInt32LE(size, 22);      // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra field length
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // gp bit flag
    central.writeUInt16LE(0, 10);         // compression method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra field length
    central.writeUInt16LE(0, 32);         // file comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal file attributes
    central.writeUInt32LE(isDir ? 0x10 : 0, 38); // external attrs (0x10 = directory)
    central.writeUInt32LE(offset, 42);    // relative offset of local header
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDir = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // end of central directory signature
  eocd.writeUInt16LE(0, 4);                   // number of this disk
  eocd.writeUInt16LE(0, 6);                   // disk where central dir starts
  eocd.writeUInt16LE(entries.length, 8);      // central dir records on this disk
  eocd.writeUInt16LE(entries.length, 10);     // total central dir records
  eocd.writeUInt32LE(centralDir.length, 12);  // size of central directory
  eocd.writeUInt32LE(localData.length, 16);   // offset of central directory
  eocd.writeUInt16LE(0, 20);                  // comment length

  return Buffer.concat([localData, centralDir, eocd]);
}
