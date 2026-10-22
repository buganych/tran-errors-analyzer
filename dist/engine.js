/* Local 1C stack analysis. No network or platform dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StackAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TYPES = [
    ['Справочник', 'Catalog', 'Catalogs'], ['Документ', 'Document', 'Documents'],
    ['Обработка', 'DataProcessor', 'DataProcessors'], ['Отчет', 'Report', 'Reports'],
    ['ОбщийМодуль', 'CommonModule', 'CommonModules'], ['ОбщаяФорма', 'CommonForm', 'CommonForms'],
    ['ОбщаяКоманда', 'CommonCommand', 'CommonCommands'], ['РегистрСведений', 'InformationRegister', 'InformationRegisters'],
    ['РегистрНакопления', 'AccumulationRegister', 'AccumulationRegisters'],
    ['РегистрБухгалтерии', 'AccountingRegister', 'AccountingRegisters'],
    ['РегистрРасчета', 'CalculationRegister', 'CalculationRegisters'],
    ['ПланСчетов', 'ChartOfAccounts', 'ChartsOfAccounts'],
    ['ПланВидовХарактеристик', 'ChartOfCharacteristicTypes', 'ChartsOfCharacteristicTypes'],
    ['ПланВидовРасчета', 'ChartOfCalculationTypes', 'ChartsOfCalculationTypes'],
    ['ПланОбмена', 'ExchangePlan', 'ExchangePlans'], ['БизнесПроцесс', 'BusinessProcess', 'BusinessProcesses'],
    ['Задача', 'Task', 'Tasks'], ['Константа', 'Constant', 'Constants'],
    ['Перечисление', 'Enum', 'Enums'], ['ЖурналДокументов', 'DocumentJournal', 'DocumentJournals'],
    ['Последовательность', 'Sequence', 'Sequences'], ['КритерийОтбора', 'FilterCriterion', 'FilterCriteria'],
    ['HTTPСервис', 'HTTPService', 'HTTPServices'], ['WebСервис', 'WebService', 'WebServices'],
    ['ВебСервис', 'WebService', 'WebServices'], ['ВнешнийИсточникДанных', 'ExternalDataSource', 'ExternalDataSources'],
    ['ВнешняяОбработка', 'ExternalDataProcessor', 'ExternalDataProcessors'],
    ['ВнешнийОтчет', 'ExternalReport', 'ExternalReports']
  ];
  const CHILDREN = [
    ['Форма', 'Form', 'Forms'], ['Команда', 'Command', 'Commands'],
    ['Таблица', 'Table', 'Tables'], ['Куб', 'Cube', 'Cubes'], ['ТаблицаИзмерений', 'DimensionTable', 'DimensionTables']
  ];
  const MODULES = [
    ['Модуль', 'Module'], ['МодульФормы', 'Module'], ['МодульОбъекта', 'ObjectModule'],
    ['МодульМенеджера', 'ManagerModule'], ['МодульНабораЗаписей', 'RecordSetModule'],
    ['МодульМенеджераЗначения', 'ValueManagerModule'], ['МодульКоманды', 'CommandModule'],
    ['МодульУправляемогоПриложения', 'ManagedApplicationModule'],
    ['МодульОбычногоПриложения', 'OrdinaryApplicationModule'],
    ['МодульВнешнегоСоединения', 'ExternalConnectionModule'], ['МодульСеанса', 'SessionModule']
  ];
  const aliases = new Map();
  for (const group of [...TYPES, ...CHILDREN, ...MODULES, ['Конфигурация', 'Configuration']]) {
    for (const item of group) aliases.set(item.toLowerCase(), group[1]);
  }
  const collections = new Map([...TYPES, ...CHILDREN].map(g => [g[2].toLowerCase(), g[1]]));
  const moduleNames = new Set(MODULES.map(g => g[1].toLowerCase()));
  const lower = text => text.normalize('NFC').toLowerCase();

  function canonicalModule(name) {
    const parts = name.trim().split('.').map(p => p.trim());
    // Translate metadata kinds only; user-defined object names can themselves be "Форма" or "Module".
    const result = [];
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i].toLowerCase();
      if (i === 0 || (i > 0 && i % 2 === 0)) result.push(aliases.get(key) || parts[i]);
      else result.push(parts[i]);
    }
    if (result[0] === 'Configuration' && result.length === 2) {
      result[1] = aliases.get(result[1].toLowerCase()) || result[1];
      result.shift();
    }
    if (result.at(-1) === 'Form' && (result.at(-3) === 'Form' || (result[0] === 'CommonForm' && result.length === 3))) result[result.length - 1] = 'Module';
    // Stack forms commonly omit the terminal .Module.
    if ((result[0] === 'CommonForm' && result.length === 2) ||
        (result.includes('Form') && result.at(-2) === 'Form')) result.push('Module');
    if ((result[0] === 'CommonModule' && result.length === 2)) result.push('Module');
    return lower(result.join('.'));
  }

  function identityFromPath(rawPath) {
    const path = rawPath.replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    const filename = parts.at(-1) || '';
    if (!/\.(bsl|txt)$/i.test(filename)) return null;
    const stem = filename.replace(/\.(bsl|txt)$/i, '');
    // Flat export: Catalog.X.Form.Y.Form.Module.txt.
    if (filename.toLowerCase().endsWith('.txt') && stem.includes('.')) {
      const flat = stem.split('.');
      if (flat.length >= 4 && /^(form)$/i.test(flat.at(-2)) && /^module$/i.test(flat.at(-1))) flat.splice(-2, 1);
      return { key: canonicalModule(flat.join('.')), format: 'flat' };
    }
    if (!filename.toLowerCase().endsWith('.bsl')) return null;
    const first = parts.findIndex(p => collections.has(p.toLowerCase()));
    if (first >= 0) {
      const p = parts.slice(first);
      const identity = [];
      for (let i = 0; i < p.length - 1; i++) {
        if (p[i].toLowerCase() === 'ext') continue;
        // Ext/Form is storage, not a second metadata Form object.
        if (p[i].toLowerCase() === 'form' && p[i - 1]?.toLowerCase() === 'ext') continue;
        const kind = collections.get(p[i].toLowerCase());
        if (!kind || i + 1 >= p.length - 1) return null;
        identity.push(kind, p[++i]);
      }
      identity.push(stem);
      return { key: canonicalModule(identity.join('.')), format: 'hierarchical' };
    }
    // Root configuration modules, or an exported external processor/report.
    if (moduleNames.has(stem.toLowerCase()) && parts.at(-2)?.toLowerCase() === 'ext') {
      return { key: canonicalModule(stem), format: 'hierarchical' };
    }
    return null;
  }

  function createIndex(files) {
    const byModule = new Map();
    const formats = new Set();
    let modules = 0;
    for (const file of files) {
      const path = file.webkitRelativePath || file.relativePath || file.name;
      const identity = identityFromPath(path);
      if (!identity) continue;
      const entry = { file, path, format: identity.format };
      const candidates = byModule.get(identity.key) || [];
      candidates.push(entry);
      byModule.set(identity.key, candidates);
      formats.add(identity.format);
      modules++;
    }
    return { byModule, formats: [...formats], modules };
  }

  async function filesFromDirectory(root, progress = () => {}) {
    const files = [], pending = [{ handle: root, path: root.name }];
    let visited = 0;
    while (pending.length) {
      const current = pending.pop();
      for await (const [name, handle] of current.handle.entries()) {
        const path = current.path + '/' + name;
        if (handle.kind === 'directory') pending.push({ handle, path });
        else if (handle.kind === 'file' && identityFromPath(path)) files.push({
          name, relativePath: path, arrayBuffer: async () => (await handle.getFile()).arrayBuffer()
        });
        if (++visited % 50 === 0) progress(files.length);
      }
    }
    progress(files.length);
    return files;
  }

  class AnalysisError extends Error {
    constructor(code, message, details = {}) { super(message); this.name = 'AnalysisError'; this.code = code; this.details = details; }
  }

  function parseContext(input) {
    let text = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw new AnalysisError('EMPTY_CONTEXT', 'Вставьте контекст из 1С.');
    if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1).trim();
    // Diagnostic stacks can start with the entry-point description shown by a 1C form.
    // It is not a stack frame and contains no source line number.
    text = text.replace(/^Форма\.Вызов[ \t]*:[ \t]*[\p{L}\p{N}_.]+[ \t]*\n/u, '').trim();
    // A frame begins only at a new line, or after a separating semicolon. Semicolons inside code stay intact.
    const pattern = /(^|[\n;])[ \t']*(?:\{([^{}\n]+)\((\d+)\)\}\s*:|([\p{L}\p{N}_.]+)\s*:\s*(\d+)\s*:)[ \t]*/gmu;
    // Mark string-literal spans so a stack-looking fragment inside an argument is never a new frame.
    const insideString = new Uint8Array(text.length);
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      insideString[i] = quoted ? 1 : 0;
      if (text[i] === '"') {
        if (quoted && text[i + 1] === '"') { insideString[++i] = 1; continue; }
        quoted = !quoted;
      }
    }
    const matches = [...text.matchAll(pattern)].filter(m => !insideString[m.index]);
    if (!matches.length) throw new AnalysisError('INVALID_CONTEXT', 'Не удалось разобрать контекст. Формат: ОбщийМодуль.Имя.Модуль:42:ТекстВызова();');
    if (text.slice(0, matches[0].index).trim()) throw new AnalysisError('INVALID_CONTEXT', 'Перед первой строкой контекста есть нераспознанный текст. Вставьте только стек вызовов.');
    return matches.map((m, i) => {
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let code = text.slice(m.index + m[0].length, end).trim();
      // In the compact stack, the last semicolon of the statement also separates frames.
      if (i + 1 < matches.length && matches[i + 1][1] === ';' && !code.endsWith("'") && !code.endsWith(';')) code += ';';
      // The stack serialization may wrap individual frames in single quotes.
      if (code.endsWith("'")) code = code.slice(0, -1).trimEnd();
      if (code.includes('\n')) {
        // Multi-line source expressions are allowed, but unparsed stack lines must not disappear silently.
        if (/\n\s*\{?[^\n]*[.:]\s*\d+\s*[:)]/.test(code)) throw new AnalysisError('INVALID_CONTEXT', `Не распознана одна из строк после кадра ${i + 1}.`);
      }
      const line = Number(m[3] || m[5]);
      if (!Number.isSafeInteger(line) || line < 1) throw new AnalysisError('INVALID_LINE', `Недопустимый номер строки в кадре ${i + 1}.`);
      if (!code) throw new AnalysisError('MISSING_SOURCE', `В кадре ${i + 1} нет текста строки. Без него нельзя проверить соответствие конфигурации.`);
      return { index: i, module: (m[2] || m[4]).trim(), line, code, raw: text.slice(m.index, end).replace(/^[\n;\s']+/, '') };
    });
  }

  async function readSource(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw new AnalysisError('ENCODING', 'Файл не в UTF-8 или UTF-16. Сохраните исходник в кодировке Unicode.'); }
  }

  // Lexical scanning preserves original offsets and line numbers. Strings and comments cannot become control-flow tokens.
  function tokenize(text) {
    const tokens = [];
    let i = 0, line = 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === '\n') line++;
          if (text[i] === '"') { if (text[i + 1] === '"') { i += 2; continue; } i++; break; }
          i++;
        }
        continue;
      }
      if (c === "'") { // Date literals.
        i++; while (i < text.length && text[i] !== "'" && text[i] !== '\n') i++;
        if (text[i] === "'") i++;
        continue;
      }
      if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
      const start = i;
      if (/[\p{L}_]/u.test(c)) {
        i++;
        while (i < text.length && /[\p{L}\p{N}_]/u.test(text[i])) i++;
        tokens.push({ value: text.slice(start, i).toLowerCase(), text: text.slice(start, i), offset: start, line, end: i, type: 'word' });
      } else { tokens.push({ value: c, text: c, offset: i, end: i + 1, line, type: 'symbol' }); i++; }
    }
    return tokens;
  }
  const isWord = (t, ...names) => t?.type === 'word' && names.includes(t.value);
  const isCall = (tokens, i, ...names) => isWord(tokens[i], ...names) && tokens[i + 1]?.value === '(';
  const isBuiltin = (tokens, i, ...names) => tokens[i - 1]?.value !== '.' && isCall(tokens, i, ...names);
  const isStart = t => isWord(t, 'процедура', 'функция', 'procedure', 'function');
  const isEnd = t => isWord(t, 'конецпроцедуры', 'конецфункции', 'endprocedure', 'endfunction');

  function methodAt(tokens, line, lines) {
    let start = null;
    const ranges = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (isStart(token)) start = { start: token.line, startIndex: i, name: tokens[i + 1]?.text || 'Метод' };
      if (isEnd(token) && start) { ranges.push({ ...start, end: token.line, endIndex: i }); start = null; }
    }
    if (start) ranges.push({ ...start, end: lines.length, endIndex: tokens.length - 1 });
    const method = ranges.find(r => line >= r.start && line <= r.end);
    if (method) return method;
    // Module initialization code lives outside named procedures/functions.
    const preceding = ranges.filter(r => r.end < line).at(-1);
    const following = ranges.find(r => r.start > line);
    const from = preceding ? preceding.end + 1 : 1;
    const to = following ? following.start - 1 : lines.length;
    return { start: from, end: to, startIndex: tokens.findIndex(t => t.line >= from), endIndex: tokens.findLastIndex(t => t.line <= to), name: 'Тело модуля' };
  }

  function analyzeMethod(lines, tokens, method, targetLine) {
    const local = tokens.filter(t => t.line >= method.start && t.line <= method.end);
    const attempts = [], stack = [], starts = [], closes = [], raises = [], rollback = [], implicit = [];
    const keywordLines = new Set([method.start, method.end, targetLine]);
    for (let i = 0; i < local.length; i++) {
      const t = local[i];
      if (isWord(t, 'попытка', 'try')) {
        const block = { start: t.offset, startLine: t.line, exception: null, end: Infinity, endLine: method.end };
        stack.push(block); attempts.push(block); keywordLines.add(t.line);
      } else if (isWord(t, 'исключение', 'except') && stack.length) {
        stack.at(-1).exception = t.offset; stack.at(-1).exceptionLine = t.line; keywordLines.add(t.line);
      } else if (isWord(t, 'конецпопытки', 'endtry') && stack.length) {
        const block = stack.pop(); block.end = t.offset; block.endLine = t.line; keywordLines.add(t.line);
      }
      if (isBuiltin(local, i, 'начатьтранзакцию', 'begintransaction')) { starts.push(t); keywordLines.add(t.line); }
      if (isBuiltin(local, i, 'зафиксироватьтранзакцию', 'committransaction', 'отменитьтранзакцию', 'rollbacktransaction')) {
        closes.push(t); keywordLines.add(t.line);
        if (isWord(t, 'отменитьтранзакцию', 'rollbacktransaction')) rollback.push(t);
      }
      if (isWord(t, 'вызватьисключение', 'raise') && local[i - 1]?.value !== '.') { raises.push(t); keywordLines.add(t.line); }
      if (isCall(local, i, 'записать', 'write', 'записатьвформе') && (local[i - 1]?.value === '.' || t.value === 'записатьвформе')) implicit.push(t);
    }
    const target = local.find(t => t.line === targetLine);
    const targetOffset = target?.offset ?? -1;
    const containing = attempts.filter(b => b.start <= targetOffset && b.end >= targetOffset);
    // Static signs only: no attempt to execute branches, loops or called methods.
    const explicitTransaction = starts.some(s => s.line <= targetLine && closes.some(c => c.offset > s.offset && c.line >= targetLine));
    const beginOnLine = starts.some(t => t.line === targetLine);
    const implicitTransaction = implicit.some(t => t.line === targetLine) ||
      /^(обработкапроведения|posting)$/i.test(method.name);
    const handlerTokens = collection => containing.some(b => b.exception !== null && collection.some(t => t.offset > b.exception && t.offset < b.end));
    const exceptionLines = new Set();
    for (const block of attempts) if (block.exception !== null) for (let n = block.exceptionLine; n <= block.endLine; n++) exceptionLines.add(n);
    return {
      transaction: explicitTransaction || beginOnLine || implicitTransaction,
      nestedTransaction: (explicitTransaction || beginOnLine) && implicitTransaction,
      attempt: containing.length > 0,
      raises: handlerTokens(raises),
      rollback: rollback.some(t => t.line === targetLine) || handlerTokens(rollback),
      implicitTransaction, explicitTransaction: explicitTransaction || beginOnLine,
      keywordLines: [...keywordLines], exceptionLines: [...exceptionLines]
    };
  }

  function checkLine(frame, lines) {
    const actual = lines[frame.line - 1];
    const expected = frame.code.replace(/\r\n?/g, '\n').trim();
    // Only the outside whitespace is ignored. Never search for a similar line at another offset.
    const length = expected.split('\n').length;
    const selected = lines.slice(frame.line - 1, frame.line - 1 + length).join('\n').trim();
    if (actual === undefined || expected !== selected) {
      throw new AnalysisError('CONFIGURATION_MISMATCH', 'Несоответствие конфигураций: строка контекста не совпадает с исходником.', {
        expected, actual: actual === undefined ? '(номер строки за пределами файла)' : selected,
        line: frame.line, module: frame.module
      });
    }
  }

  async function analyzeFrames(frames, index, progress = () => {}) {
    const cache = new Map();
    const rows = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      progress(i, frames.length);
      try {
        const key = canonicalModule(frame.module);
        const candidates = index.byModule.get(key) || [];
        if (!candidates.length) throw new AnalysisError('MODULE_NOT_FOUND', 'Модуль не найден в выбранном каталоге. Проверьте состав и версию выгрузки.', { module: frame.module });
        if (candidates.length > 1) throw new AnalysisError('AMBIGUOUS_MODULE', 'Найдено несколько файлов этого модуля. Выберите каталог одной выгрузки.', { paths: candidates.map(c => c.path) });
        const entry = candidates[0];
        if (!cache.has(entry.path)) {
          const text = (await readSource(entry.file)).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
          cache.set(entry.path, { lines: text.split('\n'), tokens: tokenize(text) });
        }
        const { lines, tokens } = cache.get(entry.path);
        checkLine(frame, lines);
        const method = methodAt(tokens, frame.line, lines);
        const flags = analyzeMethod(lines, tokens, method, frame.line);
        rows.push({ ...frame, status: 'ok', path: entry.path, format: entry.format, lines, method, ...flags });
      } catch (error) {
        rows.push({ ...frame, status: 'error', error: { code: error.code || 'READ_ERROR', message: error.message || 'Не удалось прочитать файл.', details: error.details || {} } });
      }
    }
    progress(frames.length, frames.length);
    return rows;
  }

  function visibleCode(row, mode = 'all') {
    if (row.status !== 'ok') return [];
    const selected = new Set(row.keywordLines);
    if (mode === 'exceptions') for (const n of row.exceptionLines) selected.add(n);
    const result = [];
    let gap = false;
    for (let n = row.method.start; n <= row.method.end; n++) {
      if (mode !== 'all' && !selected.has(n)) { gap = true; continue; }
      if (gap) { result.push({ gap: true }); gap = false; }
      result.push({ line: n, text: row.lines[n - 1], target: n === row.line });
    }
    return result;
  }

  return { TYPES, canonicalModule, identityFromPath, createIndex, filesFromDirectory, parseContext, readSource, tokenize, methodAt, analyzeMethod, analyzeFrames, checkLine, visibleCode, AnalysisError };
});
