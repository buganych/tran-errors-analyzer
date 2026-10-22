const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { File } = require('node:buffer');
const Z = require('../dist/zip.js');
const A = require('../dist/engine.js');

function makeZip(items, options = {}) {
  const localParts = [], centralParts = []; let offset = 0;
  for (const item of items) {
    const name = item.rawName || Buffer.from(item.name, 'utf8');
    const content = Buffer.from(item.text || '', 'utf8');
    const compressed = item.stored ? content : deflateRawSync(content);
    const method = item.stored ? 0 : 8, flags = item.flags ?? 0x800;
    const crc = item.wrongCrc ? 42 : Z.crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    localParts.push(header, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(item.attrs || 0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name); offset += header.length + name.length + compressed.length;
  }
  const local = Buffer.concat(localParts), central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  const extra = [];
  if (options.zip64) {
    const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(items.length), 24); record.writeBigUInt64LE(BigInt(items.length), 32); record.writeBigUInt64LE(BigInt(central.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + central.length), 8); locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(65535, 8); end.writeUInt16LE(65535, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16); extra.push(record, locator);
  }
  return new File([local, central, ...extra, end], options.name || 'Выгрузка.zip');
}
function domError(name) { return Object.assign(new Error(name), { name }); }
function directoryHandle(directory) {
  return {
    name: path.basename(directory),
    async queryPermission() { return 'granted'; },
    async getDirectoryHandle(name, options = {}) {
      const target = path.join(directory, name);
      try { const s = await fs.stat(target); if (!s.isDirectory()) throw domError('TypeMismatchError'); }
      catch (e) { if (e.code === 'ENOENT') { if (!options.create) throw domError('NotFoundError'); await fs.mkdir(target); } else throw e; }
      return directoryHandle(target);
    },
    async getFileHandle(name, options = {}) {
      const target = path.join(directory, name);
      try { const s = await fs.stat(target); if (!s.isFile()) throw domError('TypeMismatchError'); }
      catch (e) { if (e.code === 'ENOENT') { if (!options.create) throw domError('NotFoundError'); await fs.writeFile(target, ''); } else throw e; }
      return {
        name, __path: target,
        async isSameEntry(other) { return other.__path === target; },
        async getFile() { return new File([await fs.readFile(target)], name); },
        async createWritable() {
          const chunks = [];
          return { async write(chunk) { chunks.push(Buffer.from(chunk)); }, async close() { await fs.writeFile(target, Buffer.concat(chunks)); }, async abort() { chunks.length = 0; } };
        }
      };
    }
  };
}
async function sandbox(t, file) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'context-zip-test-'));
  t.after(async () => { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.match(path.basename(temp), /^context-zip-test-/); await fs.rm(temp, { recursive: true, force: true }); });
  if (file) await fs.writeFile(path.join(temp, file.name), Buffer.from(await file.arrayBuffer()));
  return { temp, parent: directoryHandle(temp) };
}

test('ZIP extraction writes next to archive and feeds extracted module to stack analyzer', async t => {
  const source = 'Процедура Тест()\n    Вызов();\nКонецПроцедуры';
  const zip = makeZip([{ name: 'CommonModules/Тест/Ext/Module.bsl', text: source }, { name: 'Configuration.xml', text: '<Configuration/>', stored: true }, { name: 'ПустойКаталог/', stored: true }]);
  const { temp, parent } = await sandbox(t, zip);
  const archive = await Z.inspect(zip), progress = [];
  const result = await Z.extract(archive, parent, p => progress.push(p));
  assert.equal(result.name, 'Выгрузка'); assert.equal(result.files.length, 2);
  assert.equal(await fs.readFile(path.join(temp, 'Выгрузка/CommonModules/Тест/Ext/Module.bsl'), 'utf8'), source);
  assert.ok((await fs.stat(path.join(temp, 'Выгрузка/ПустойКаталог'))).isDirectory());
  assert.equal(progress.at(-1).completed, 2);
  const rows = await A.analyzeFrames(A.parseContext('ОбщийМодуль.Тест.Модуль:2:Вызов();'), A.createIndex(result.files));
  assert.equal(rows[0].status, 'ok');
});

test('existing unpacked folder is not overwritten', async t => {
  const zip = makeZip([{ name: 'Module.bsl', text: 'new' }]);
  const { temp, parent } = await sandbox(t, zip);
  await fs.mkdir(path.join(temp, 'Выгрузка')); await fs.writeFile(path.join(temp, 'Выгрузка/keep.txt'), 'keep');
  const result = await Z.extract(await Z.inspect(zip), parent);
  assert.equal(result.name, 'Выгрузка (1)'); assert.equal(await fs.readFile(path.join(temp, 'Выгрузка/keep.txt'), 'utf8'), 'keep');
});

test('wrong parent or different ZIP with the same name is rejected before creating a folder', async t => {
  const zip = makeZip([{ name: 'Module.bsl', text: 'A' }]);
  const { temp, parent } = await sandbox(t);
  const archive = await Z.inspect(zip);
  await assert.rejects(() => Z.extract(archive, parent), /нет архива/);
  const other = makeZip([{ name: 'Module.bsl', text: 'B' }]);
  await fs.writeFile(path.join(temp, zip.name), Buffer.from(await other.arrayBuffer()));
  await assert.rejects(() => Z.extract(archive, parent), /другой архив/);
  assert.deepEqual(await fs.readdir(temp), [zip.name]);
});

test('path traversal, absolute paths, reserved names and case collisions are rejected', async () => {
  for (const name of ['../outside.bsl', '/outside.bsl', 'C:/outside.bsl', 'Root/../outside.bsl', 'Root\\..\\outside.bsl', 'Root/NUL.txt', 'Root/bad. /x', 'Root/x:stream']) {
    await assert.rejects(() => Z.inspect(makeZip([{ name, text: 'x' }])), /путь/);
  }
  await assert.rejects(() => Z.inspect(makeZip([{ name: 'a.bsl' }, { name: 'A.bsl' }])), /повторяется/);
  await assert.rejects(() => Z.inspect(makeZip([{ name: 'a' }, { name: 'a/x.bsl' }])), /файлом и каталогом/);
});

test('CRC failure stops extraction and reports the incomplete folder', async t => {
  const zip = makeZip([{ name: 'Module.bsl', text: 'broken', wrongCrc: true }]);
  const { temp, parent } = await sandbox(t, zip);
  await assert.rejects(async () => Z.extract(await Z.inspect(zip), parent), /CRC32.*Неполная папка: Выгрузка/s);
  assert.equal(await fs.readFile(path.join(temp, 'Выгрузка/Module.bsl'), 'utf8'), '');
});

test('ZIP64 end record is supported', async t => {
  const zip = makeZip([{ name: 'CommonModule.Тест.Module.txt', text: 'Текст', stored: true }], { zip64: true });
  const archive = await Z.inspect(zip); assert.equal(archive.files.length, 1);
  const { parent } = await sandbox(t, zip);
  const result = await Z.extract(archive, parent);
  assert.equal(new TextDecoder().decode(await result.files[0].arrayBuffer()), 'Текст');
});

test('password, symlinks and truncated ZIP are rejected explicitly', async () => {
  await assert.rejects(() => Z.inspect(makeZip([{ name: 'test', flags: 0x801 }])), /паролем/);
  await assert.rejects(() => Z.inspect(makeZip([{ name: 'link', attrs: 0xa1ff0000 }])), /ссылку/);
  await assert.rejects(() => Z.inspect(new File(['not zip'], 'bad.zip')), /повреждён/);
});

test('traditional CP866 Cyrillic names are decoded', async () => {
  const rawName = Buffer.concat([Buffer.from([0x92, 0xa5, 0xe1, 0xe2]), Buffer.from('.bsl')]);
  const archive = await Z.inspect(makeZip([{ name: '', rawName, flags: 0, stored: true }]));
  assert.equal(archive.files[0].path, 'Тест.bsl');
});

test('archive produced by Windows Compress-Archive extracts and analyzes all demo frames', async t => {
  const zip = new File([await fs.readFile(path.join(__dirname, 'fixtures/test.zip'))], 'ТестWindows.zip');
  const { parent } = await sandbox(t, zip);
  const output = await Z.extract(await Z.inspect(zip), parent);
  const demo = require('../dist/demo.js');
  const rows = await A.analyzeFrames(A.parseContext(demo.context), A.createIndex(output.files));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.status === 'ok'), JSON.stringify(rows.map(r => r.error)));
});

test('selecting ZIP immediately asks folder permission, extracts and returns the selected source', async t => {
  const zip = makeZip([{ name: 'CommonModules/Тест/Ext/Module.bsl', text: 'Процедура Тест()\nВызов();\nКонецПроцедуры' }]);
  const { parent } = await sandbox(t, zip);
  const handle = await parent.getFileHandle(zip.name);
  const events = [];
  const output = await Z.chooseAndExtract({
    pickFile: async () => { events.push('pick-file'); return [handle]; },
    pickDirectory: async options => { events.push('folder-permission'); assert.equal(options.startIn, handle); return parent; },
    onArchive: () => events.push('extract-start'),
    progress: () => events.push('progress')
  });
  assert.deepEqual(events.slice(0, 3), ['pick-file', 'folder-permission', 'extract-start']);
  assert.equal(output.parent, parent); assert.equal(output.name, 'Выгрузка');
  const rows = await A.analyzeFrames(A.parseContext('ОбщийМодуль.Тест.Модуль:2:Вызов();'), A.createIndex(output.files));
  assert.equal(rows[0].status, 'ok');
});

test('selecting ZIP in an already authorized folder skips the folder picker', async t => {
  const zip = makeZip([{ name: 'CommonModule.Тест.Module.txt', text: 'test' }]);
  const { parent } = await sandbox(t, zip);
  const handle = await parent.getFileHandle(zip.name);
  const output = await Z.chooseAndExtract({
    pickFile: async () => [handle], parent,
    pickDirectory: async () => { assert.fail('Already authorized folder must be reused'); }
  });
  assert.equal(output.parent, parent); assert.equal(output.files.length, 1);
});

test('canceling the folder permission does not create output', async t => {
  const zip = makeZip([{ name: 'Module.bsl', text: 'test' }]);
  const { temp, parent } = await sandbox(t, zip);
  const handle = await parent.getFileHandle(zip.name);
  await assert.rejects(() => Z.chooseAndExtract({
    pickFile: async () => [handle], pickDirectory: async () => { throw domError('AbortError'); }
  }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(temp), [zip.name]);
});
