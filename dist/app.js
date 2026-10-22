/* All processing is browser-local. No uploads, analytics, remote fonts or APIs. */
(() => {
  'use strict';
  const A = window.StackAnalyzer;
  const $ = id => document.getElementById(id);
  const state = { index: null, rows: [], selected: -1, mode: 'all', busy: false, generation: 0, zipParent: null };
  let toastTimer;
  const flagLabels = [
    ['transaction', 'Транзакция'], ['nestedTransaction', 'Внутри неявной транзакции'],
    ['attempt', 'Попытка'], ['rollback', 'Отмена транзакции'], ['raises', 'Вызов исключения']
  ];
  const formatLabel = formats => formats.map(f => f === 'flat' ? 'линейная' : 'иерархическая').join(' + ');
  const plural = (number, forms) => forms[(number % 100 >= 11 && number % 100 <= 14) ? 2 : number % 10 === 1 ? 0 : number % 10 >= 2 && number % 10 <= 4 ? 1 : 2];
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').className = error ? 'notice error' : 'notice';
    $('notice').hidden = !message;
  }
  function sourceFeedback(message, error = false) {
    $('source-feedback').textContent = message;
    $('source-feedback').hidden = !message;
    $('source-feedback').className = error ? 'source-feedback error' : 'source-feedback';
  }
  function toast(text) {
    document.querySelector('.toast')?.remove();
    const element = document.createElement('div');
    element.className = 'toast'; element.setAttribute('role', 'status'); element.textContent = text;
    document.body.append(element); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.remove(), 3200);
  }
  function refreshActions() {
    // Missing inputs must explain themselves instead of leaving an inert button.
    $('analyze').disabled = state.busy;
    const reason = state.busy ? 'Выполняется обработка…' : analysisBlocker();
    $('analyze').title = reason || 'Построить контекст по выбранным исходникам';
    $('source-readiness').textContent = reason || 'Исходники и контекст готовы к разбору.';
    $('source-readiness').className = reason ? 'readiness pending' : 'readiness ready';
    $('folder').disabled = state.busy;
    $('choose-folder').disabled = state.busy;
    $('choose-zip').disabled = state.busy;
    $('demo').disabled = state.busy;
    $('context').readOnly = state.busy;
    $('clear').disabled = state.busy;
    $('export').disabled = state.busy || !state.rows.length;
  }
  function analysisBlocker() {
    if (!state.index) return 'Сначала выберите каталог выгрузки или ZIP в блоке конфигурации.';
    if (!state.index.modules) return 'В выбранном каталоге нет модулей. Выберите корневую папку выгрузки 1С.';
    if (!$('context').value.trim()) return 'Вставьте контекст из 1С.';
    return '';
  }
  function resetResults() {
    state.generation++; state.rows = []; state.selected = -1;
    $('rows').replaceChildren(); $('row-count').textContent = '0';
    $('table-empty').hidden = false; $('summary').textContent = 'Контекст ещё не построен';
    $('method-title').textContent = 'Текст метода'; $('method-range').textContent = '';
    $('source-path').textContent = 'Выберите строку в таблице контекста';
    $('selection-info').textContent = 'Нет выбранного вызова';
    $('method-error').hidden = true; $('method-error').replaceChildren(); $('code').hidden = false;
    $('code').innerHTML = '<div class="code-empty"><span aria-hidden="true">↳</span><p>Каждый вызов — в своём контексте</p><span>Текст метода, исходные номера строк и точная позиция вызова.</span></div>';
    $('copy').disabled = true; $('jump').disabled = true; refreshActions();
  }
  function loadFiles(files, name, demo = false) {
    $('zip-panel').hidden = true;
    resetResults(); state.index = A.createIndex(files);
    $('folder-name').textContent = name || 'Выбранный каталог';
    $('folder-info').textContent = `${state.index.modules.toLocaleString('ru-RU')} ${plural(state.index.modules, ['модуль', 'модуля', 'модулей'])} · ${formatLabel(state.index.formats) || 'формат не определён'}`;
    $('source-selection').hidden = false;
    $('source-card').dataset.selection = state.index.modules ? 'ready' : 'error';
    $('source-selection-label').textContent = demo ? '✓ Демонстрационные исходники' : state.index.modules ? '✓ Каталог выбран' : '⚠ Каталог выбран, модули не найдены';
    $('selected-directory-path').value = demo ? 'Пример конфигурации' : '…\\' + (name || 'Выбранный каталог').replace(/ \/ /g, '\\');
    sourceFeedback(state.index.modules ? `Готово. Найдено модулей: ${state.index.modules.toLocaleString('ru-RU')}.` : 'В этой папке нет модулей выгрузки 1С. Выберите корневую папку с исходниками.', !state.index.modules);
    if (!state.index.modules) notice('В каталоге не найдены модули выгрузки 1С. Выберите корневой каталог с .bsl или линейной выгрузкой .txt.', true);
    else notice(demo ? 'Открыты демонстрационные исходники и контекст. Для своих данных выберите каталог выгрузки.' : 'Каталог проиндексирован. Вставьте контекст из той же версии конфигурации.');
    refreshActions();
  }
  $('folder').addEventListener('change', event => {
    const files = [...event.target.files];
    if (!files.length) return;
    loadFiles(files, files[0].webkitRelativePath.split('/')[0]);
  });
  $('choose-folder').addEventListener('click', async () => {
    if (state.busy) return;
    if (!window.showDirectoryPicker) { $('folder').click(); return; }
    state.busy = true; refreshActions();
    sourceFeedback('Открывается выбор каталога…');
    try {
      const directory = await window.showDirectoryPicker({ id: 'one-c-source-directory', mode: 'read' });
      notice('Чтение каталога выгрузки…');
      sourceFeedback(`Выбран «${directory.name}». Чтение содержимого…`);
      const files = await A.filesFromDirectory(directory, count => {
        const message = `Чтение каталога: найдено модулей — ${count.toLocaleString('ru-RU')}`;
        sourceFeedback(message); notice(message);
      });
      loadFiles(files, directory.name);
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Выбор каталога отменён.' : error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'Не удалось получить доступ к каталогу. Разрешите чтение выбранной папки в диалоге браузера.' : error.message || 'Не удалось прочитать каталог.';
      sourceFeedback(message, error.name !== 'AbortError'); notice(message, error.name !== 'AbortError');
    } finally { state.busy = false; refreshActions(); }
  });
  function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ГБ';
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
    return Math.ceil(bytes / 1024).toLocaleString('ru-RU') + ' КБ';
  }
  $('choose-zip').addEventListener('click', async () => {
    if (state.busy) return;
    if (!window.showOpenFilePicker || !window.showDirectoryPicker) {
      notice('Для автоматической распаковки ZIP рядом с архивом откройте HTML в Chrome или Edge. В этом браузере можно выбрать уже распакованный каталог.', true);
      return;
    }
    state.busy = true; refreshActions();
    sourceFeedback('Выбор ZIP и автоматическая распаковка…');
    notice('Выберите ZIP. Если браузер запросит доступ к папке архива, разрешите его — затем распаковка начнётся автоматически.');
    try {
      const output = await window.StackZip.chooseAndExtract({
        pickFile: options => window.showOpenFilePicker(options),
        pickDirectory: options => window.showDirectoryPicker(options),
        parent: state.zipParent,
        onParent: parent => { state.zipParent = parent; },
        validate: archive => {
          const index = A.createIndex(archive.files.map(entry => ({ name: entry.parts.at(-1), relativePath: entry.path })));
          if (!index.modules) throw new Error('В ZIP не найдены модули выгрузки 1С (.bsl или линейные .txt).');
        },
        onArchive: archive => {
          $('zip-panel').hidden = false;
          $('zip-name').textContent = archive.file.name;
          $('zip-info').textContent = `${archive.files.length.toLocaleString('ru-RU')} ${plural(archive.files.length, ['файл', 'файла', 'файлов'])} · ${formatBytes(archive.totalSize)} после распаковки`;
        },
        progress: progress => notice(`Распаковка: ${progress.completed} / ${progress.total} файлов · ${formatBytes(progress.bytesWritten)} / ${formatBytes(progress.totalSize)}${progress.path ? ' · ' + progress.path : ''}`)
      });
      loadFiles(output.files, output.parent.name + ' / ' + output.name);
      notice(`ZIP распакован рядом с архивом в «${output.parent.name} / ${output.name}». Этот каталог автоматически выбран для разбора контекста.`);
    } catch (error) {
      $('zip-panel').hidden = true;
      sourceFeedback(error.name === 'AbortError' ? 'Выбор ZIP или доступа к папке отменён.' : error.message || 'Не удалось распаковать ZIP.', error.name !== 'AbortError');
      if (error.name === 'AbortError') notice('Выбор ZIP или доступа к его папке отменён.');
      else if (error.name === 'NotAllowedError' || error.name === 'SecurityError') notice('Нет доступа к папке архива. Повторно выберите ZIP и разрешите браузеру доступ к его папке.', true);
      else notice(error.message || 'Не удалось распаковать ZIP.', true);
    } finally { state.busy = false; refreshActions(); }
  });
  $('context').addEventListener('input', () => { if (state.rows.length) resetResults(); notice(''); refreshActions(); });
  $('clear').addEventListener('click', () => { $('context').value = ''; resetResults(); notice(''); $('context').focus(); });
  $('context').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!$('analyze').disabled) analyze(); } });
  $('analyze').addEventListener('click', analyze);

  async function analyze() {
    if (state.busy) return;
    const blocker = analysisBlocker();
    if (blocker) {
      notice(blocker, true);
      if (!state.index?.modules) $('choose-folder').focus();
      else $('context').focus();
      return;
    }
    resetResults();
    const generation = state.generation;
    try {
      const frames = A.parseContext($('context').value);
      state.busy = true; refreshActions(); notice('Сопоставление контекста с исходниками…');
      // Give the browser a chance to paint progress before file reads.
      await new Promise(resolve => requestAnimationFrame(resolve));
      const rows = await A.analyzeFrames(frames, state.index, (done, total) => { $('analyze').textContent = `Разбор ${done} / ${total}`; });
      if (generation !== state.generation) return;
      state.rows = rows;
      renderRows();
      const errors = rows.filter(r => r.status === 'error').length;
      const mismatch = rows.filter(r => r.error?.code === 'CONFIGURATION_MISMATCH').length;
      const confirmed = rows.length - errors;
      $('summary').textContent = `${confirmed} совпало${errors ? ` · ${errors} ${plural(errors, ['ошибка', 'ошибки', 'ошибок'])}` : ' · без ошибок'}`;
      if (errors) notice(`${mismatch ? 'Несоответствие конфигураций. ' : ''}Не удалось сопоставить ${errors} из ${rows.length} строк. Выберите строку с ошибкой для подробностей.`, true);
      else notice(`Контекст построен. Совпадений с исходниками: ${rows.length} из ${rows.length}.`);
      selectRow(errors ? rows.findIndex(r => r.status === 'error') : 0);
    } catch (error) { notice(error.message || 'Не удалось построить контекст.', true); }
    finally {
      state.busy = false;
      $('analyze').innerHTML = 'Построить контекст <span aria-hidden="true">→</span>';
      refreshActions();
    }
  }

  function renderRows() {
    $('rows').replaceChildren(); $('table-empty').hidden = state.rows.length > 0;
    $('row-count').textContent = state.rows.length;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.rows.length; i++) {
      const row = state.rows[i]; const tr = document.createElement('tr');
      tr.dataset.index = i; tr.tabIndex = i === 0 ? 0 : -1; tr.setAttribute('aria-selected', 'false');
      const flags = flagLabels.map(([key, title]) => {
        const symbol = row.status !== 'ok' ? '?' : row[key] ? '✓' : '—';
        const label = row.status !== 'ok' ? 'не определено из-за ошибки' : row[key] ? 'обнаружено' : 'не обнаружено';
        return `<td class="flag-cell"><span class="flag ${row.status !== 'ok' ? 'unknown' : row[key] ? '' : 'no'}" role="img" aria-label="${title}: ${label}" title="${title}: ${label}">${symbol}</span></td>`;
      }).join('');
      const status = row.status === 'ok' ? 'Совпадает' : row.error.code === 'CONFIGURATION_MISMATCH' ? 'Несоответствие' : 'Ошибка';
      tr.innerHTML = `<td>${String(i + 1).padStart(2, '0')}</td><td><div class="module-name">${escape(row.module)}</div><div class="call-text" title="${escape(row.code)}">${escape(row.code)}</div></td><td class="line-number">${row.line}</td>${flags}<td><span class="badge ${row.status !== 'ok' ? 'error' : ''}"><span class="badge-dot"></span>${status}</span></td>`;
      tr.addEventListener('click', () => selectRow(i));
      tr.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowDown') next = Math.min(state.rows.length - 1, i + 1);
        if (event.key === 'ArrowUp') next = Math.max(0, i - 1);
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = state.rows.length - 1;
        if (event.key === 'Enter' || event.key === ' ') next = i;
        if (next !== undefined) { event.preventDefault(); selectRow(next); $('rows').children[next].focus(); }
      });
      fragment.append(tr);
    }
    $('rows').append(fragment);
  }

  function selectRow(index) {
    state.selected = index;
    [...$('rows').children].forEach((tr, i) => { tr.setAttribute('aria-selected', String(i === index)); tr.tabIndex = i === index ? 0 : -1; });
    const row = state.rows[index];
    if (!row) return;
    $('method-title').textContent = row.status === 'ok' ? row.method.name : 'Ошибка сопоставления';
    $('method-range').textContent = row.status === 'ok' ? `${row.method.start}–${row.method.end}` : '';
    $('source-path').textContent = row.path || row.module;
    $('selection-info').textContent = `Вызов ${index + 1} из ${state.rows.length} · строка ${row.line}`;
    $('copy').disabled = row.status !== 'ok'; $('jump').disabled = row.status !== 'ok';
    $('method-error').hidden = row.status === 'ok'; $('code').hidden = row.status !== 'ok';
    if (row.status !== 'ok') {
      const details = row.error.details;
      let html = `<h3>${escape(row.error.message)}</h3><p>${escape(row.module)} · строка ${row.line}</p>`;
      if (details.expected !== undefined) html += `<p class="diff-label">В контексте</p><pre>${escape(details.expected)}</pre><p class="diff-label">В выгруженной конфигурации</p><pre>${escape(details.actual)}</pre><p class="diff-label">Выберите выгрузку той версии, в которой был получен контекст.</p>`;
      if (details.paths) html += `<pre>${escape(details.paths.join('\n'))}</pre>`;
      $('method-error').innerHTML = html;
    } else { renderCode(row); }
  }

  const keywords = new Set('процедура функция конецпроцедуры конецфункции если тогда иначе иначеесли конецесли для каждого из цикл конеццикла пока попытка исключение конецпопытки вызватьисключение возврат новый неопределено истина ложь экспорт и или не procedure function endprocedure endfunction if then else elsif endif for each in do enddo while try except endtry raise return new undefined true false export and or not'.split(' '));
  const builtins = new Set('начатьтранзакцию зафиксироватьтранзакцию отменитьтранзакцию begintransaction committransaction rollbacktransaction'.split(' '));
  function highlight(line, stringState) {
    // Carry the string state across lines of multiline literals, including omitted lines in filtered modes.
    let result = '', i = 0;
    while (i < line.length) {
      if (stringState.open || line[i] === '"') {
        const start = i;
        if (!stringState.open) { stringState.open = true; i++; }
        while (i < line.length) {
          if (line[i] === '"') { if (line[i + 1] === '"') { i += 2; continue; } i++; stringState.open = false; break; }
          i++;
        }
        result += `<span class="syntax-string">${escape(line.slice(start, i))}</span>`;
      } else if (line.slice(i, i + 2) === '//') { result += `<span class="syntax-comment">${escape(line.slice(i))}</span>`; break; }
      else {
        const word = line.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
        if (word) {
          const value = word[0], key = value.toLowerCase();
          const style = keywords.has(key) ? 'syntax-keyword' : builtins.has(key) ? 'syntax-builtin' : '';
          result += style ? `<span class="${style}">${escape(value)}</span>` : escape(value);
          i += value.length;
        } else { result += escape(line[i++]); }
      }
    }
    return result;
  }
  function renderCode(row) {
    const visible = A.visibleCode(row, state.mode);
    const stringState = { open: false };
    const colored = new Map();
    // Start at file beginning so strings spanning the selected method's boundary are treated consistently.
    for (let n = 1; n <= row.method.end; n++) {
      const rendered = highlight(row.lines[n - 1], stringState);
      if (n >= row.method.start) colored.set(n, rendered);
    }
    $('code').innerHTML = visible.map(line => line.gap ? '<div class="code-line gap"><span class="code-gutter">···</span><span class="code-text">…</span></div>' :
      `<div class="code-line${line.target ? ' target' : ''}"${line.target ? ' id="target-line" aria-label="Строка вызова"' : ''}><span class="code-gutter"><span class="line-arrow">${line.target ? '→' : ''}</span><span>${line.line}</span></span><span class="code-text">${colored.get(line.line) || ' '}</span></div>`).join('');
    jumpToLine();
  }
  function jumpToLine() {
    const line = $('target-line');
    if (!line) return;
    const pane = $('code');
    pane.scrollTop = line.offsetTop - pane.offsetTop - pane.clientHeight / 2 + line.clientHeight / 2;
  }
  $('jump').addEventListener('click', jumpToLine);
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const row = state.rows[state.selected];
    if (row?.status === 'ok') renderCode(row);
  }));
  $('copy').addEventListener('click', async () => {
    const row = state.rows[state.selected];
    if (row?.status !== 'ok') return;
    const text = row.lines.slice(row.method.start - 1, row.method.end).join('\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea'); area.value = text; area.setAttribute('aria-label', 'Копирование метода');
        document.body.append(area); area.select();
        const copied = document.execCommand('copy'); area.remove();
        if (!copied) throw new Error('copy');
      }
      toast('Текст метода скопирован');
    } catch { toast('Копирование недоступно. Выделите текст метода и нажмите Ctrl+C.'); }
  });
  $('export').addEventListener('click', () => {
    const quote = value => {
      let str = String(value ?? '');
      // Prevent formulas when opening the CSV in a spreadsheet.
      if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
      return '"' + str.replace(/"/g, '""') + '"';
    };
    const lines = [['№', 'Модуль', 'Строка', 'Текст вызова', ...flagLabels.map(f => f[1]), 'Соответствие', 'Файл', 'Ошибка']];
    state.rows.forEach((row, i) => lines.push([i + 1, row.module, row.line, row.code, ...flagLabels.map(([key]) => row.status !== 'ok' ? '' : row[key] ? 'Да' : 'Нет'), row.status === 'ok' ? 'Совпадает' : 'Ошибка', row.path || '', row.error?.message || '']));
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = 'Контекст-транзакций.csv';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('demo').addEventListener('click', async () => {
    const files = window.StackDemo.files.map(source => {
      const file = new File([source.text], source.path.split('/').at(-1), { type: 'text/plain' });
      Object.defineProperty(file, 'relativePath', { value: source.path }); return file;
    });
    $('folder').value = ''; $('context').value = window.StackDemo.context;
    loadFiles(files, 'Пример конфигурации', true); await analyze();
    notice('Демонстрационный контекст построен. Для своих данных выберите каталог и замените текст контекста.');
  });
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
  refreshActions();
})();
