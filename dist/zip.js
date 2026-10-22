/* ZIP/ZIP64 reader and streaming disk extraction using native browser APIs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StackZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  class ZipError extends Error {
    constructor(message) { super(message); this.name = 'ZipError'; }
  }
  const fail = message => { throw new ZipError(message); };
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    crcTable[i] = crc >>> 0;
  }
  function crcUpdate(crc, data) { for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return crc >>> 0; }
  const crc32 = data => (crcUpdate(0xffffffff, data) ^ 0xffffffff) >>> 0;
  const view = data => new DataView(data.buffer, data.byteOffset, data.byteLength);
  async function read(file, offset, size) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > file.size) fail('ZIP повреждён: данные выходят за границы архива.');
    const data = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
    if (data.length !== size) fail('Не удалось полностью прочитать ZIP.');
    return data;
  }
  function uint64(data, offset) {
    if (offset + 8 > data.byteLength) fail('ZIP64 повреждён: неполные размеры файла.');
    const value = Number(data.getBigUint64(offset, true));
    if (!Number.isSafeInteger(value)) fail('ZIP слишком велик для обработки в браузере.');
    return value;
  }
  function safePath(name) {
    const path = name.replace(/\\/g, '/');
    if (!path || path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) fail(`Недопустимый путь в ZIP: ${name}`);
    const parts = path.replace(/\/$/, '').split('/');
    for (const p of parts) {
      if (!p || p === '.' || p === '..' || /[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) fail(`Недопустимый путь в ZIP: ${name}`);
    }
    return { path: parts.join('/'), parts, directory: path.endsWith('/') };
  }
  function extras(bytes) {
    const map = new Map(); const data = view(bytes);
    for (let i = 0; i < bytes.length;) {
      if (i + 4 > bytes.length) fail('ZIP повреждён: неполное дополнительное поле.');
      const tag = data.getUint16(i, true), length = data.getUint16(i + 2, true); i += 4;
      if (i + length > bytes.length) fail('ZIP повреждён: неверная длина дополнительного поля.');
      map.set(tag, bytes.subarray(i, i + length)); i += length;
    }
    return map;
  }
  function decodeName(raw, flags, extra) {
    try {
      if (flags & 0x800) return new TextDecoder('utf-8', { fatal: true }).decode(raw);
      const unicode = extra.get(0x7075);
      if (unicode?.length >= 5 && unicode[0] === 1 && view(unicode).getUint32(1, true) === crc32(raw)) return new TextDecoder('utf-8', { fatal: true }).decode(unicode.subarray(5));
      // Traditional Cyrillic ZIP filenames use DOS codepage 866.
      return new TextDecoder('ibm866').decode(raw);
    } catch { fail('Не удалось прочитать имя файла в ZIP. Используйте архив с именами в UTF-8.'); }
  }

  async function inspect(file) {
    if (file.size < 22) fail('Файл не является ZIP-архивом или повреждён.');
    const tailOffset = Math.max(0, file.size - 65557);
    const tail = await read(file, tailOffset, file.size - tailOffset); const t = view(tail);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (t.getUint32(i, true) === 0x06054b50 && i + 22 + t.getUint16(i + 20, true) === tail.length) { eocd = i; break; }
    if (eocd < 0) fail('ZIP повреждён: не найден каталог архива.');
    if (t.getUint16(eocd + 4, true) || t.getUint16(eocd + 6, true)) fail('Многотомные ZIP-архивы не поддерживаются.');
    let count = t.getUint16(eocd + 10, true), size = t.getUint32(eocd + 12, true), offset = t.getUint32(eocd + 16, true);
    if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) {
      const locator = view(await read(file, tailOffset + eocd - 20, 20));
      if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) fail('ZIP64 повреждён или содержит несколько томов.');
      const record = view(await read(file, uint64(locator, 8), 56));
      if (record.getUint32(0, true) !== 0x06064b50 || record.getUint32(16, true) || record.getUint32(20, true)) fail('Неверный заголовок ZIP64.');
      count = uint64(record, 32); size = uint64(record, 40); offset = uint64(record, 48);
      if (uint64(record, 24) !== count) fail('Многотомные ZIP-архивы не поддерживаются.');
    } else if (t.getUint16(eocd + 8, true) !== count) fail('Многотомные ZIP-архивы не поддерживаются.');
    if (size > 128 * 1024 * 1024 || count > 250000) fail('В ZIP слишком много файлов для обработки в браузере. Распакуйте его обычным архиватором и выберите каталог.');
    if (offset + size > tailOffset + eocd) fail('ZIP повреждён: неверное расположение каталога.');
    const central = await read(file, offset, size), data = view(central);
    const entries = [], seen = new Map(); let position = 0, totalSize = 0;
    for (let i = 0; i < count; i++) {
      const p = position;
      if (p + 46 > size || data.getUint32(p, true) !== 0x02014b50) fail('ZIP повреждён: неверная запись каталога.');
      const flags = data.getUint16(p + 8, true), compression = data.getUint16(p + 10, true);
      const crc = data.getUint32(p + 16, true);
      let compressedSize = data.getUint32(p + 20, true), originalSize = data.getUint32(p + 24, true), localOffset = data.getUint32(p + 42, true);
      const nameSize = data.getUint16(p + 28, true), extraSize = data.getUint16(p + 30, true), commentSize = data.getUint16(p + 32, true);
      const disk = data.getUint16(p + 34, true), attrs = data.getUint32(p + 38, true);
      position = p + 46 + nameSize + extraSize + commentSize;
      if (position > size) fail('ZIP повреждён: обрезанный каталог.');
      const extra = extras(central.subarray(p + 46 + nameSize, p + 46 + nameSize + extraSize));
      if (originalSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff || disk === 65535) {
        const z = extra.get(1); if (!z) fail('ZIP64 повреждён: отсутствуют размеры.');
        const values = view(z); let cursor = 0;
        if (originalSize === 0xffffffff) { originalSize = uint64(values, cursor); cursor += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = uint64(values, cursor); cursor += 8; }
        if (localOffset === 0xffffffff) { localOffset = uint64(values, cursor); cursor += 8; }
        if (disk === 65535 && (cursor + 4 > z.length || values.getUint32(cursor, true) !== 0)) fail('Многотомные ZIP-архивы не поддерживаются.');
      } else if (disk) fail('Многотомные ZIP-архивы не поддерживаются.');
      if (flags & 1) fail('ZIP защищён паролем. Сначала снимите пароль или распакуйте архив обычным архиватором.');
      if (compression !== 0 && compression !== 8) fail(`Метод сжатия ZIP ${compression} не поддерживается. Используйте обычное сжатие Deflate.`);
      const rawName = central.subarray(p + 46, p + 46 + nameSize);
      const name = decodeName(rawName, flags, extra);
      const path = safePath(name);
      const unixType = (attrs >>> 16) & 0xf000;
      if (unixType && unixType !== 0x8000 && unixType !== 0x4000) fail(`ZIP содержит ссылку или специальный файл: ${name}`);
      path.directory ||= unixType === 0x4000 || Boolean(attrs & 0x10);
      const key = path.path.normalize('NFC').toLowerCase();
      if (seen.has(key)) fail(`В ZIP повторяется путь: ${name}`);
      seen.set(key, path.directory);
      if (localOffset + 30 + compressedSize > offset) fail(`ZIP повреждён: неверное расположение файла ${name}`);
      if (compression === 0 && compressedSize !== originalSize) fail(`ZIP повреждён: неверный размер файла ${name}`);
      entries.push({ ...path, rawName: new Uint8Array(rawName), flags, compression, crc, compressedSize, originalSize, localOffset });
      totalSize += originalSize;
      if (!Number.isSafeInteger(totalSize)) fail('Общий размер ZIP слишком велик.');
    }
    for (const entry of entries) for (let i = 1; i < entry.parts.length; i++) {
      const parent = entry.parts.slice(0, i).join('/').normalize('NFC').toLowerCase();
      if (seen.get(parent) === false) fail(`Путь одновременно является файлом и каталогом: ${entry.path}`);
    }
    const files = entries.filter(e => !e.directory);
    if (!files.length) fail('ZIP не содержит файлов.');
    if (files.some(e => e.compression === 8)) {
      try { new DecompressionStream('deflate-raw'); }
      catch { fail('Браузер не поддерживает распаковку Deflate. Откройте инструмент в актуальной версии Chrome или Edge.'); }
    }
    return { file, entries, files, totalSize, centralOffset: offset };
  }

  async function verifyArchive(parent, file) {
    let sibling;
    try { sibling = await (await parent.getFileHandle(file.name)).getFile(); }
    catch (error) { if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') fail(`В выбранной папке нет архива «${file.name}». Выберите папку, в которой находится ZIP.`); throw error; }
    if (sibling.size !== file.size) fail('В выбранной папке находится другой архив с тем же именем.');
    const chunk = 1024 * 1024;
    for (let start = 0; start < file.size; start += chunk) {
      const [a, b] = await Promise.all([file.slice(start, start + chunk).arrayBuffer(), sibling.slice(start, start + chunk).arrayBuffer()]);
      const left = new Uint8Array(a), right = new Uint8Array(b);
      if (left.some((byte, i) => byte !== right[i])) fail('В выбранной папке находится другой архив с тем же именем.');
    }
  }
  async function createDestination(parent, archiveName) {
    let base = archiveName.replace(/\.zip$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Конфигурация';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = '_' + base;
    for (let n = 0; n < 10000; n++) {
      const name = base + (n ? ` (${n})` : '');
      // Check both files and directories; never reuse or overwrite an existing destination.
      try { await parent.getDirectoryHandle(name); continue; } catch (error) { if (error.name === 'TypeMismatchError') continue; if (error.name !== 'NotFoundError') throw error; }
      try { await parent.getFileHandle(name); continue; } catch (error) { if (error.name === 'TypeMismatchError') continue; if (error.name !== 'NotFoundError') throw error; }
      return { name, handle: await parent.getDirectoryHandle(name, { create: true }) };
    }
    fail('Не удалось выбрать свободное имя папки для распаковки.');
  }
  async function fileStream(archive, entry) {
    const header = await read(archive.file, entry.localOffset, 30), h = view(header);
    if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== entry.compression || h.getUint16(6, true) !== entry.flags) fail(`ZIP повреждён: неверный заголовок ${entry.path}`);
    const nameSize = h.getUint16(26, true), extraSize = h.getUint16(28, true);
    const name = await read(archive.file, entry.localOffset + 30, nameSize);
    if (name.length !== entry.rawName.length || name.some((b, i) => b !== entry.rawName[i])) fail(`ZIP повреждён: имена файла не совпадают (${entry.path}).`);
    const start = entry.localOffset + 30 + nameSize + extraSize;
    if (start + entry.compressedSize > archive.centralOffset) fail(`ZIP повреждён: неполные данные ${entry.path}`);
    let stream = archive.file.slice(start, start + entry.compressedSize).stream();
    if (entry.compression === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    return stream;
  }

  async function extract(archive, parent, progress = () => {}) {
    await verifyArchive(parent, archive.file);
    const destination = await createDestination(parent, archive.file.name);
    const files = []; let completed = 0, bytesWritten = 0;
    const directories = new Map([['', destination.handle]]);
    async function getDirectory(parts) {
      const key = parts.join('/'); if (directories.has(key)) return directories.get(key);
      const parentHandle = await getDirectory(parts.slice(0, -1));
      const handle = await parentHandle.getDirectoryHandle(parts.at(-1), { create: true }); directories.set(key, handle); return handle;
    }
    try {
      for (const entry of archive.entries) {
        if (entry.directory) { await getDirectory(entry.parts); continue; }
        progress({ completed, total: archive.files.length, bytesWritten, totalSize: archive.totalSize, path: entry.path });
        const directory = await getDirectory(entry.parts.slice(0, -1));
        const handle = await directory.getFileHandle(entry.parts.at(-1), { create: true });
        const writer = await handle.createWritable(); let reader;
        let actualSize = 0, crc = 0xffffffff;
        try {
          reader = (await fileStream(archive, entry)).getReader();
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            actualSize += chunk.value.length;
            if (actualSize > entry.originalSize) fail(`ZIP повреждён: размер ${entry.path} больше заявленного.`);
            crc = crcUpdate(crc, chunk.value); await writer.write(chunk.value); bytesWritten += chunk.value.length;
          }
          if (actualSize !== entry.originalSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail(`Ошибка целостности ZIP: ${entry.path}. Размер или CRC32 не совпадает.`);
          await writer.close();
        } catch (error) { await reader?.cancel().catch(() => {}); await writer.abort().catch(() => {}); throw error; }
        files.push({ name: entry.parts.at(-1), relativePath: destination.name + '/' + entry.path, arrayBuffer: async () => (await handle.getFile()).arrayBuffer() });
        completed++;
      }
      progress({ completed, total: archive.files.length, bytesWritten, totalSize: archive.totalSize, path: '' });
      return { ...destination, files };
    } catch (error) {
      // Keep partial output for inspection; never delete a directory recursively on failure.
      throw new ZipError(`Распаковка не завершена. ${error.message} Неполная папка: ${destination.name}.`);
    }
  }
  async function chooseAndExtract({ pickFile, pickDirectory, parent = null, validate = () => {}, onArchive = () => {}, onParent = () => {}, progress = () => {} }) {
    const [handle] = await pickFile({
      id: 'one-c-zip', multiple: false, excludeAcceptAllOption: true,
      types: [{ description: 'Выгрузка конфигурации 1С (ZIP)', accept: { 'application/zip': ['.zip'] } }],
      ...(parent ? { startIn: parent } : {})
    });
    if (!handle) throw new DOMException('Выбор ZIP отменён.', 'AbortError');
    if (parent) {
      try {
        const sibling = await parent.getFileHandle(handle.name);
        if (!(await sibling.isSameEntry(handle)) || await parent.queryPermission({ mode: 'readwrite' }) !== 'granted') parent = null;
      } catch { parent = null; }
    }
    // Run the permission picker immediately after file selection, before ZIP reading.
    // startIn points the picker to the folder that contains the selected ZIP.
    if (!parent) parent = await pickDirectory({ id: 'one-c-zip-parent', mode: 'readwrite', startIn: handle });
    const sibling = await parent.getFileHandle(handle.name).catch(error => {
      if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') fail(`В выбранной папке нет ZIP «${handle.name}». Выберите папку, в которой он лежит.`);
      throw error;
    });
    if (!(await sibling.isSameEntry(handle))) fail('Выбранная папка не содержит выбранный ZIP. Повторите выбор ZIP и разрешите доступ к его папке.');
    onParent(parent);
    const file = await handle.getFile();
    const archive = await inspect(file);
    await validate(archive);
    onArchive(archive);
    const output = await extract(archive, parent, progress);
    return { ...output, parent };
  }
  return { inspect, extract, chooseAndExtract, safePath, crc32, ZipError };
});
