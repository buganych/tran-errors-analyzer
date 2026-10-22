const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../dist/engine.js');
const demo = require('../dist/demo.js');

const memoryFile = (relativePath, text) => ({ relativePath, name: relativePath.split('/').at(-1), arrayBuffer: async () => new TextEncoder().encode(text).buffer });
const indexOf = (...sources) => A.createIndex(sources.map(([path, text]) => memoryFile(path, text)));
const analyze = async (source, code, module = 'ОбщийМодуль.Тест.Модуль') => {
  const line = source.split('\n').findIndex(s => s.trim() === code) + 1;
  const frame = { index: 0, module, line, code };
  return (await A.analyzeFrames([frame], indexOf(['Root/CommonModules/Тест/Ext/Module.bsl', source])))[0];
};

test('hierarchical and flat paths resolve to the same metadata identity', () => {
  const pairs = [
    ['Root/CommonModules/Обмен/Ext/Module.bsl', 'CommonModule.Обмен.Module.txt', 'ОбщийМодуль.Обмен.Модуль'],
    ['Root/Catalogs/Товары/Ext/ObjectModule.bsl', 'Catalog.Товары.ObjectModule.txt', 'Справочник.Товары.МодульОбъекта'],
    ['Root/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl', 'Catalog.Товары.Form.ФормаЭлемента.Form.Module.txt', 'Справочник.Товары.Форма.ФормаЭлемента.Форма'],
    ['Root/CommonForms/Настройки/Ext/Form/Module.bsl', 'CommonForm.Настройки.Form.Module.txt', 'ОбщаяФорма.Настройки.Форма'],
    ['Root/Documents/Заказ/Commands/Печать/Ext/CommandModule.bsl', 'Document.Заказ.Command.Печать.CommandModule.txt', 'Документ.Заказ.Команда.Печать.МодульКоманды'],
    ['Root/Ext/SessionModule.bsl', 'Configuration.SessionModule.txt', 'МодульСеанса'],
    ['Root/AccountingRegisters/Расчеты/Ext/RecordSetModule.bsl', 'AccountingRegister.Расчеты.RecordSetModule.txt', 'РегистрБухгалтерии.Расчеты.МодульНабораЗаписей'],
    ['Root/ExternalDataSources/Внешние/ Tables/Таблица/Ext/ObjectModule.bsl'.replace('/ Tables/', '/Tables/'), 'ExternalDataSource.Внешние.Table.Таблица.ObjectModule.txt', 'ВнешнийИсточникДанных.Внешние.Таблица.Таблица.МодульОбъекта']
  ];
  for (const [hierarchy, flat, context] of pairs) {
    assert.equal(A.identityFromPath(hierarchy)?.key, A.canonicalModule(context), hierarchy);
    assert.equal(A.identityFromPath(flat)?.key, A.canonicalModule(context), flat);
  }
  assert.equal(A.identityFromPath('Root/Templates/Макет/Ext/Template.txt'), null);
});

test('object names equal to metadata names are not translated', () => {
  assert.equal(A.identityFromPath('Root/Catalogs/Форма/Forms/Модуль/Ext/Form/Module.bsl').key, A.canonicalModule('Справочник.Форма.Форма.Модуль.Форма'));
});

test('context parser accepts colon and error-message formats, quotes, CRLF and compact frames', () => {
  const rows = A.parseContext("'ОбщийМодуль.Тест.Модуль:2:Вызов(\"a:b;c\");\r\n{Документ.Заказ.МодульОбъекта(8)}: Обработать();'");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'Вызов("a:b;c");');
  assert.equal(rows[1].line, 8);
  assert.equal(rows[1].code, 'Обработать();');
  const compact = A.parseContext('ОбщийМодуль.Тест.Модуль:2:Первый();ОбщийМодуль.Тест.Модуль:4:Второй();');
  assert.deepEqual(compact.map(f => f.code), ['Первый();', 'Второй();']);
  const literal = A.parseContext('ОбщийМодуль.Тест.Модуль:2:Сообщить("пример;ОбщийМодуль.Ложный.Модуль:77:это строка");\nОбщийМодуль.Тест.Модуль:4:Второй();');
  assert.equal(literal.length, 2);
  assert.equal(literal[0].code, 'Сообщить("пример;ОбщийМодуль.Ложный.Модуль:77:это строка");');
});

test('invalid input and missing source text fail explicitly', () => {
  for (const value of ['', 'ошибка без стека', 'ОбщийМодуль.X.Модуль:0:Вызов();', 'ОбщийМодуль.X.Модуль:1:']) assert.throws(() => A.parseContext(value), A.AnalysisError);
});

test('diagnostic stack from 1C form accepts entry-point header and indented frames', () => {
  const context = `Форма.Вызов : Обработка.ОшибкаТранзакции.Форма.Форма.Модуль.ВоспроизвестиНаСервере
Обработка.ОшибкаТранзакции.Форма.Форма.Форма : 12 : ВсеНорм = ВыполнитьКакиеТоДействия();
    Обработка.ОшибкаТранзакции.Форма.Форма.Форма : 33 : Сделал = РазличныеДействия.СделайТо();
        ОбщийМодуль.РазличныеДействия.Модуль : 4 : СделайСё(Истина);
            ОбщийМодуль.РазличныеДействия.Модуль : 13 : Возврат ПерезаписьВсего.ПерезаписатьНоменклатуру();`;
  const rows = A.parseContext(context);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].line, 12);
  assert.equal(rows[0].code, 'ВсеНорм = ВыполнитьКакиеТоДействия();');
  assert.equal(rows[3].line, 13);
  assert.equal(A.canonicalModule(rows[0].module), A.identityFromPath('Root/DataProcessors/ОшибкаТранзакции/Forms/Форма/Ext/Form/Module.bsl').key);
  assert.throws(() => A.parseContext('Непонятный заголовок\n' + rows[0].raw), /нераспознанный текст/);
});

test('demo: source match, method bounds, explicit and implicit flags, form module', async () => {
  const index = A.createIndex(demo.files.map(s => memoryFile(s.path, s.text)));
  const rows = await A.analyzeFrames(A.parseContext(demo.context), index);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.status === 'ok'), JSON.stringify(rows.map(r => r.error)));
  assert.equal(rows[0].method.name, 'ВыполнитьОбмен');
  assert.equal(rows[0].method.start, 2);
  assert.equal(rows[0].method.end, 15);
  assert.deepEqual([rows[0].transaction, rows[0].nestedTransaction, rows[0].attempt, rows[0].rollback, rows[0].raises], [true, true, true, true, true]);
  assert.equal(rows[1].implicitTransaction, true);
  assert.equal(rows[2].transaction, false);
  assert.equal(A.visibleCode(rows[0]).find(l => l.target).text.trim(), 'ДокументОбъект.Записать();');
  assert.ok(A.visibleCode(rows[0], 'keywords').find(l => l.target));
  assert.ok(A.visibleCode(rows[0], 'exceptions').some(l => l.text?.includes('ЗаписатьЖурналРегистрации')));
});

test('mismatch: exact line number is enforced even if text exists elsewhere', async () => {
  const source = 'Процедура Тест()\n    Первый();\n    Второй();\nКонецПроцедуры';
  const rows = await A.analyzeFrames([{ module: 'ОбщийМодуль.Тест.Модуль', line: 2, code: 'Второй();' }], indexOf(['Root/CommonModules/Тест/Ext/Module.bsl', source]));
  assert.equal(rows[0].error.code, 'CONFIGURATION_MISMATCH');
  assert.equal(rows[0].error.details.actual, 'Первый();');
  assert.equal(rows[0].transaction, undefined);
});

test('comparison preserves apostrophes, case, literal content and internal spacing', () => {
  const lines = ['    Вызов("O\'Brien");   '];
  assert.doesNotThrow(() => A.checkLine({ line: 1, code: 'Вызов("O\'Brien");' }, lines));
  for (const code of ['Вызов("OBrien");', 'вызов("O\'Brien");', 'Вызов( "O\'Brien");']) assert.throws(() => A.checkLine({ line: 1, code }, lines));
  assert.throws(() => A.checkLine({ line: 20, code: 'Вызов();' }, lines), /Несоответствие/);
});

test('comments and multiline string literals cannot create method boundaries or flags', async () => {
  const source = `Процедура Тест()
    // НачатьТранзакцию(); Попытка
    Текст = "Процедура Ложная()
    |НачатьТранзакцию();
    |Исключение
    |ВызватьИсключение;
    |КонецПроцедуры";
    Вызов();
    // ОтменитьТранзакцию(); КонецПопытки
КонецПроцедуры`;
  const row = await analyze(source, 'Вызов();');
  assert.equal(row.status, 'ok');
  assert.equal(row.method.name, 'Тест');
  assert.equal(row.method.end, 10);
  assert.deepEqual([row.transaction, row.attempt, row.rollback, row.raises], [false, false, false, false]);
});

test('nested attempts: a neighboring handler is not attributed to the selected call', async () => {
  const source = `Процедура Тест()
    Попытка
        ДругаяОперация();
    Исключение
        ВызватьИсключение;
    КонецПопытки;
    Попытка
        ЦелеваяОперация();
    Исключение
        Сообщить("Ошибка");
    КонецПопытки;
КонецПроцедуры`;
  const row = await analyze(source, 'ЦелеваяОперация();');
  assert.equal(row.attempt, true); assert.equal(row.raises, false); assert.equal(row.rollback, false);
});

test('nested attempts: outer handler applies to an inner call', async () => {
  const source = `Procedure Test()
    BeginTransaction();
    Try
        Try
            Target();
        Except
            Message("error");
        EndTry;
        CommitTransaction();
    Except
        RollbackTransaction();
        Raise;
    EndTry;
EndProcedure`;
  const row = await analyze(source, 'Target();');
  assert.deepEqual([row.transaction, row.attempt, row.rollback, row.raises], [true, true, true, true]);
});

test('module initialization shows surrounding module body', async () => {
  const row = await analyze('Процедура Тест()\nКонецПроцедуры\n\nИнициализировать();', 'Инициализировать();');
  assert.equal(row.method.name, 'Тело модуля'); assert.equal(row.method.start, 3);
});

test('unknown/ambiguous module errors do not suppress other rows', async () => {
  const source = 'Процедура Тест()\nВызов();\nКонецПроцедуры';
  const index = indexOf(['One/CommonModules/Тест/Ext/Module.bsl', source], ['Two/CommonModules/Тест/Ext/Module.bsl', source], ['One/CommonModules/Другой/Ext/Module.bsl', source]);
  const rows = await A.analyzeFrames(['Тест', 'НетМодуля', 'Другой'].map(name => ({ module: `ОбщийМодуль.${name}.Модуль`, line: 2, code: 'Вызов();' })), index);
  assert.equal(rows[0].error.code, 'AMBIGUOUS_MODULE');
  assert.equal(rows[1].error.code, 'MODULE_NOT_FOUND');
  assert.equal(rows[2].status, 'ok');
});

test('flat export is read and analyzed end to end', async () => {
  const source = 'Процедура Тест()\r\n\tВызов();\r\nКонецПроцедуры';
  const rows = await A.analyzeFrames(A.parseContext('Справочник.Товары.Форма.ФормаЭлемента:2:Вызов();'), indexOf(['Root/Catalog.Товары.Form.ФормаЭлемента.Form.Module.txt', source]));
  assert.equal(rows[0].status, 'ok'); assert.equal(rows[0].format, 'flat');
});

test('repeated frames read their shared module once', async () => {
  let reads = 0;
  const file = memoryFile('Root/CommonModules/Тест/Ext/Module.bsl', 'Процедура Тест()\nВызов();\nКонецПроцедуры');
  const original = file.arrayBuffer;
  file.arrayBuffer = async () => { reads++; return original(); };
  const frames = A.parseContext('ОбщийМодуль.Тест.Модуль:2:Вызов();\nОбщийМодуль.Тест.Модуль:2:Вызов();');
  const rows = await A.analyzeFrames(frames, A.createIndex([file]));
  assert.ok(rows.every(r => r.status === 'ok')); assert.equal(reads, 1);
});

test('UTF-16 source is decoded; unsupported encoding produces an explicit error', async () => {
  const text = 'Процедура Тест()';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  assert.equal(await A.readSource(file), text);
  await assert.rejects(() => A.readSource({ arrayBuffer: async () => Uint8Array.from([0xff, 0xff, 0xff]).buffer }), { code: 'ENCODING' });
});

test('native directory selection discovers modules recursively without reading every file', async () => {
  let reads = 0;
  const file = (name, text) => ({ kind: 'file', name, getFile: async () => { reads++; return memoryFile(name, text); } });
  const directory = (name, children) => ({ kind: 'directory', name, async *entries() { for (const child of children) yield [child.name, child]; } });
  const root = directory('Исходники', [file('Configuration.xml', '<xml/>'), directory('CommonModules', [directory('Тест', [directory('Ext', [file('Module.bsl', 'Процедура Тест()\nВызов();\nКонецПроцедуры')])])])]);
  const files = await A.filesFromDirectory(root);
  assert.equal(reads, 0);
  assert.equal(files.length, 1);
  assert.equal(files[0].relativePath, 'Исходники/CommonModules/Тест/Ext/Module.bsl');
  const rows = await A.analyzeFrames(A.parseContext('ОбщийМодуль.Тест.Модуль:2:Вызов();'), A.createIndex(files));
  assert.equal(rows[0].status, 'ok');
  assert.equal(reads, 1);
});
