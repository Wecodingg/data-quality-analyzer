'use strict';

/* =============================================================
   Data Quality Analyzer
   Todo o processamento acontece localmente no navegador.
   Nenhum arquivo ou dado é enviado a servidores.

   Seções do arquivo:
   1. Configuração e catálogo de regras
   2. Parser CSV (aspas, vírgulas e quebras de linha em campos)
   3. Análise de qualidade
   4. Interface (renderização e eventos)
   5. Exportação do relatório
   6. Inicialização
   ============================================================= */

/* ---------------------------------------------------------------
   1. Configuração e catálogo de regras
   --------------------------------------------------------------- */
const CONFIG = {
  maxFileBytes: 25 * 1024 * 1024, // limite de tamanho aceito (25 MB)
  pageSize: 50,                   // linhas por página nas tabelas
  typeThreshold: 0.7,             // proporção mínima para inferir o tipo de uma coluna
  minSample: 3,                   // mínimo de valores preenchidos para inferir tipo/padrão
  maxCellChars: 120,              // truncamento visual de células longas
};

const DELIMITERS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const DELIMITER_NAMES = { ',': 'vírgula (,)', ';': 'ponto e vírgula (;)', '\t': 'tabulação (Tab)', '|': 'barra vertical (|)' };

const TYPE_INFO = {
  missing: { label: 'Ausente', plural: 'Ausentes' },
  duplicate: { label: 'Duplicado', plural: 'Duplicados' },
  inconsistency: { label: 'Inconsistência', plural: 'Inconsistências' },
  structure: { label: 'Estrutura', plural: 'Estrutura' },
};

const COLUMN_TYPE_LABEL = { text: 'Texto', number: 'Numérico', date: 'Data', email: 'E-mail' };

/* Cada regra tem um id estável, uma categoria e uma descrição exibida na interface. */
const RULES = {
  MISSING: {
    id: 'R01', type: 'missing', name: 'Valor ausente',
    description: 'O campo está vazio ou contém apenas espaços em branco.',
  },
  DUP_EXACT: {
    id: 'R02', type: 'duplicate', name: 'Linha duplicada (exata)',
    description: 'Todos os campos são idênticos aos de uma linha anterior. A primeira ocorrência é mantida; as repetições são sinalizadas.',
  },
  DUP_NORM: {
    id: 'R03', type: 'inconsistency', name: 'Possível duplicidade (após normalização)',
    description: 'A linha só fica igual a uma anterior depois de ignorar espaços extras, maiúsculas/minúsculas e acentos.',
  },
  SPACE_EDGE: {
    id: 'R04', type: 'inconsistency', name: 'Espaços no início ou no fim',
    description: 'O valor começa ou termina com espaço em branco (a tabela mostra esses espaços como pontos).',
  },
  SPACE_MULT: {
    id: 'R05', type: 'inconsistency', name: 'Espaços repetidos no meio do valor',
    description: 'O valor contém dois ou mais espaços em branco seguidos entre caracteres.',
  },
  PLACEHOLDER: {
    id: 'R06', type: 'inconsistency', name: 'Possível marcador de ausência',
    description: 'O valor parece representar "sem dado" (por exemplo N/A, null, nan, -, ? ou "não informado") em vez de estar vazio.',
  },
  CASE: {
    id: 'R07', type: 'inconsistency', name: 'Grafias diferentes para o mesmo valor',
    description: 'Em colunas de texto, valores que só diferem por maiúsculas/minúsculas, acentos ou espaços. A grafia mais frequente é tomada como referência.',
  },
  TYPE: {
    id: 'R08', type: 'inconsistency', name: 'Valor incompatível com o tipo da coluna',
    description: 'Quando pelo menos 70% dos valores preenchidos de uma coluna são números, datas ou e-mails, os demais valores são sinalizados. A regra de e-mail é simplificada (texto@domínio.sufixo).',
  },
  DATE_FORMAT: {
    id: 'R09', type: 'inconsistency', name: 'Formato de data diferente do predominante',
    description: 'Em colunas de data, formatos reconhecidos (AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA) diferentes do mais frequente na coluna.',
  },
  DATE_INVALID: {
    id: 'R10', type: 'inconsistency', name: 'Data inexistente no calendário',
    description: 'A data segue um formato conhecido, mas não existe (por exemplo 31/02/2024). Datas com barra são lidas como DD/MM/AAAA.',
  },
  NUM_STYLE: {
    id: 'R11', type: 'inconsistency', name: 'Separador decimal diferente do predominante',
    description: 'Em colunas numéricas, mistura de vírgula e ponto como separador decimal.',
  },
  PATTERN: {
    id: 'R12', type: 'inconsistency', name: 'Padrão de formatação diferente do predominante',
    description: 'Em colunas de texto com dígitos (telefone, CEP, códigos), quando 70% ou mais dos valores seguem o mesmo padrão de letras/números/símbolos, os que fogem dele são sinalizados.',
  },
  FIELDS: {
    id: 'R13', type: 'structure', name: 'Quantidade irregular de campos',
    description: 'A linha tem mais ou menos campos do que o cabeçalho define.',
  },
  HEADER: {
    id: 'R14', type: 'structure', name: 'Cabeçalho problemático',
    description: 'Nome de coluna vazio ou repetido (ignorando maiúsculas/minúsculas e espaços).',
  },
  QUOTE: {
    id: 'R15', type: 'structure', name: 'Aspas sem fechamento',
    description: 'Um campo foi aberto com aspas e nunca foi fechado; o restante do arquivo é lido como parte desse campo.',
  },
};

const PLACEHOLDERS = new Set([
  'n/a', '#n/a', '#n/d', 'n.a.', 'null', 'nulo', 'none', 'nan', 'undefined',
  '-', '--', '---', '?', '??', 's/i', 'vazio',
  'sem informação', 'sem informacao', 'não informado', 'nao informado',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_HEADER_RE = /e-?mail/i;
const NUM_RE = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;
const NUM_THOUSANDS_RE = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$|^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const DATE_FORMATS = [
  { key: 'ISO', label: 'AAAA-MM-DD', re: /^(\d{4})-(\d{2})-(\d{2})$/, parts: (m) => [+m[1], +m[2], +m[3]] },
  { key: 'BR', label: 'DD/MM/AAAA', re: /^(\d{2})\/(\d{2})\/(\d{4})$/, parts: (m) => [+m[3], +m[2], +m[1]] },
  { key: 'BR-', label: 'DD-MM-AAAA', re: /^(\d{2})-(\d{2})-(\d{4})$/, parts: (m) => [+m[3], +m[2], +m[1]] },
];

class UserError extends Error {}

/* ---------------------------------------------------------------
   2. Parser CSV
   Máquina de estados simples compatível com RFC 4180:
   campos entre aspas podem conter delimitador, aspas duplicadas ("")
   e quebras de linha. Cada registro guarda a linha física onde começa.
   --------------------------------------------------------------- */
function detectDelimiter(text) {
  const candidates = [',', ';', '\t', '|'];
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  let seenContent = false;
  const limit = Math.min(text.length, 50000);
  for (let i = 0; i < limit; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; seenContent = true; continue; }
    if (inQuotes) continue;
    if (ch === '\n' || ch === '\r') { if (seenContent) break; continue; }
    if (counts[ch] !== undefined) counts[ch]++;
    if (!/\s/.test(ch)) seenContent = true;
  }
  let best = ',';
  for (const c of candidates) if (counts[c] > counts[best]) best = c;
  return best;
}

function parseCSV(text, delimiter) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quoteOpenedAt = null;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; quoteOpenedAt = null; }
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        field += '\n';
        line++;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; quoteOpenedAt = line; continue; }
    if (ch === delimiter) { record.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push({ fields: record, line: recordLine });
      record = [];
      field = '';
      line++;
      recordLine = line;
      continue;
    }
    field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push({ fields: record, line: recordLine });
  }
  return { records, unterminatedQuoteLine: inQuotes ? quoteOpenedAt : null };
}

/* ---------------------------------------------------------------
   3. Análise de qualidade
   --------------------------------------------------------------- */
const normalizeSpaces = (s) => s.trim().replace(/\s+/g, ' ');
const foldKey = (s) => normalizeSpaces(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isPlaceholder = (v) => PLACEHOLDERS.has(v.trim().toLowerCase());
const isNumeric = (v) => NUM_RE.test(v) || NUM_THOUSANDS_RE.test(v);

function decimalStyle(v) {
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  if (lastComma < 0 && lastDot < 0) return null;
  return lastComma > lastDot ? 'vírgula' : 'ponto';
}

function isValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function matchDate(v) {
  for (const fmt of DATE_FORMATS) {
    const m = fmt.re.exec(v);
    if (m) {
      const [y, mo, d] = fmt.parts(m);
      return { fmt, valid: isValidDate(y, mo, d) };
    }
  }
  return null;
}

function inferColumnType(name, values) {
  const n = values.length;
  if (n > 0 && EMAIL_HEADER_RE.test(name)) return 'email';
  if (n < CONFIG.minSample) return 'text';
  let dates = 0, nums = 0, emails = 0;
  for (const v of values) {
    if (matchDate(v)) dates++;
    if (isNumeric(v)) nums++;
    if (EMAIL_RE.test(v)) emails++;
  }
  const need = CONFIG.typeThreshold * n;
  if (dates >= need) return 'date';
  if (nums >= need) return 'number';
  if (emails >= need) return 'email';
  return 'text';
}

function shapeOf(v) {
  return v.trim().replace(/\d+/g, '9').replace(/[A-Za-zÀ-ÿ]+/g, 'A');
}

function mostFrequent(counter) {
  let best = null, bestCount = -1;
  for (const [key, count] of counter) if (count > bestCount) { best = key; bestCount = count; }
  return best;
}

function previewText(s, max = 100) {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function analyze(text, delimiterChoice) {
  const notes = [];
  const autoDetected = !DELIMITERS[delimiterChoice];
  const delimiter = autoDetected ? detectDelimiter(text) : DELIMITERS[delimiterChoice];
  const parsed = parseCSV(text, delimiter);

  const records = [];
  let blankLines = 0;
  for (const rec of parsed.records) {
    if (rec.fields.length === 1 && rec.fields[0].trim() === '') blankLines++;
    else records.push(rec);
  }
  if (records.length === 0) throw new UserError('O arquivo está vazio ou contém apenas linhas em branco.');
  if (records.length === 1) throw new UserError('O arquivo tem somente o cabeçalho e nenhuma linha de dados para analisar.');

  const headerRec = records[0];
  const rows = records.slice(1);
  const nCols = headerRec.fields.length;
  const headers = headerRec.fields.map((h, i) => h.trim() || `(coluna ${i + 1})`);

  if (blankLines > 0) notes.push(`${blankLines} linha(s) em branco foram ignoradas na análise.`);
  if (nCols === 1) notes.push('Apenas uma coluna foi identificada. Se o arquivo deveria ter mais, escolha o delimitador manualmente.');

  const issues = [];
  const add = (ruleKey, o) => {
    const rule = RULES[ruleKey];
    issues.push({
      type: rule.type, ruleKey, ruleId: rule.id, ruleName: rule.name,
      row: o.row ?? null, line: o.line, col: o.col ?? null,
      column: o.col != null ? headers[o.col] : '',
      value: o.value ?? '', detail: o.detail,
    });
  };

  /* Cabeçalho */
  const seenHeaders = new Map();
  headerRec.fields.forEach((raw, c) => {
    if (raw.trim() === '') {
      add('HEADER', { line: headerRec.line, col: c, value: raw, detail: `A coluna ${c + 1} não tem nome no cabeçalho.` });
      return;
    }
    if (/^\s|\s$/.test(raw)) {
      add('SPACE_EDGE', { line: headerRec.line, col: c, value: raw, detail: 'Nome de coluna com espaços no início ou no fim.' });
    }
    const key = foldKey(raw);
    if (seenHeaders.has(key)) {
      add('HEADER', { line: headerRec.line, col: c, value: raw, detail: `Nome de coluna repetido (igual à coluna ${seenHeaders.get(key) + 1}).` });
    } else seenHeaders.set(key, c);
  });

  /* Aspas sem fechamento */
  if (parsed.unterminatedQuoteLine != null) {
    add('QUOTE', {
      line: parsed.unterminatedQuoteLine,
      detail: `Aspas abertas na linha ${parsed.unterminatedQuoteLine} sem fechamento. O restante do arquivo foi lido como um único campo; corrija o arquivo de origem.`,
    });
  }

  /* Estrutura: quantidade de campos por linha */
  rows.forEach((row, r) => {
    if (row.fields.length !== nCols) {
      add('FIELDS', {
        row: r, line: row.line, value: previewText(row.fields.join(delimiter)),
        detail: `${row.fields.length} campo(s) encontrado(s); o cabeçalho define ${nCols}.`,
      });
    }
  });

  /* Duplicidades de linha inteira */
  const exactSeen = new Map();
  const normSeen = new Map();
  rows.forEach((row, r) => {
    const exactKey = JSON.stringify(row.fields);
    const normKey = row.fields.map(foldKey).join('\u0001');
    if (exactSeen.has(exactKey)) {
      const first = exactSeen.get(exactKey);
      add('DUP_EXACT', { row: r, line: row.line, value: previewText(row.fields.join(delimiter)), detail: `Linha idêntica à linha ${rows[first].line} do arquivo.` });
      return;
    }
    exactSeen.set(exactKey, r);
    if (normSeen.has(normKey)) {
      const first = normSeen.get(normKey);
      add('DUP_NORM', { row: r, line: row.line, value: previewText(row.fields.join(delimiter)), detail: `Fica igual à linha ${rows[first].line} se ignorarmos espaços, maiúsculas/minúsculas e acentos.` });
    } else normSeen.set(normKey, r);
  });

  /* Análise por coluna */
  const columns = [];
  for (let c = 0; c < nCols; c++) {
    const cells = [];
    rows.forEach((row, r) => { if (c < row.fields.length) cells.push({ r, v: row.fields[c], line: row.line }); });

    const filled = cells.filter((x) => x.v.trim() !== '');
    const sample = filled.filter((x) => !isPlaceholder(x.v));
    const type = inferColumnType(headers[c], sample.map((x) => x.v.trim()));
    const info = { name: headers[c], type, cells: cells.length, filled: filled.length, missing: 0, inconsistencies: 0, distinct: new Set(filled.map((x) => x.v.trim())).size };
    columns.push(info);

    const numberStyles = [];
    const dateFormats = [];

    for (const { r, v, line } of cells) {
      const t = v.trim();
      const base = { row: r, line, col: c, value: v };
      if (t === '') {
        info.missing++;
        add('MISSING', { ...base, detail: v === '' ? 'Campo vazio.' : 'Campo contém apenas espaços.' });
        continue;
      }
      if (/^\s|\s$/.test(v)) add('SPACE_EDGE', { ...base, detail: 'Espaços no início ou no fim do valor.' });
      if (/\s{2,}/.test(t)) add('SPACE_MULT', { ...base, detail: 'Dois ou mais espaços seguidos no meio do valor.' });
      if (isPlaceholder(t)) {
        add('PLACEHOLDER', { ...base, detail: `"${t}" parece representar ausência de dado.` });
        continue;
      }
      if (type === 'number') {
        if (!isNumeric(t)) add('TYPE', { ...base, detail: 'Valor não numérico em coluna predominantemente numérica.' });
        else { const style = decimalStyle(t); if (style) numberStyles.push({ ...base, style }); }
      } else if (type === 'date') {
        const m = matchDate(t);
        if (!m) add('TYPE', { ...base, detail: 'Valor não reconhecido como data em coluna predominantemente de datas.' });
        else {
          dateFormats.push({ ...base, fmt: m.fmt });
          if (!m.valid) add('DATE_INVALID', { ...base, detail: `A data ${t} não existe no calendário.` });
        }
      } else if (type === 'email') {
        if (!EMAIL_RE.test(t)) add('TYPE', { ...base, detail: 'Formato de e-mail inválido (regra simplificada).' });
      }
    }

    if (type === 'number' && numberStyles.length) {
      const counter = new Map();
      numberStyles.forEach((x) => counter.set(x.style, (counter.get(x.style) || 0) + 1));
      if (counter.size > 1) {
        const dominant = mostFrequent(counter);
        numberStyles.filter((x) => x.style !== dominant).forEach((x) => {
          const { style, ...base } = x;
          add('NUM_STYLE', { ...base, detail: `Usa ${style} como separador decimal; o predominante na coluna é ${dominant}.` });
        });
      }
    }

    if (type === 'date' && dateFormats.length) {
      const counter = new Map();
      dateFormats.forEach((x) => counter.set(x.fmt.key, (counter.get(x.fmt.key) || 0) + 1));
      if (counter.size > 1) {
        const dominantKey = mostFrequent(counter);
        const dominantLabel = DATE_FORMATS.find((f) => f.key === dominantKey).label;
        dateFormats.filter((x) => x.fmt.key !== dominantKey).forEach((x) => {
          const { fmt, ...base } = x;
          add('DATE_FORMAT', { ...base, detail: `Formato ${fmt.label}; o predominante na coluna é ${dominantLabel}.` });
        });
      }
    }

    if (type === 'text' && sample.length >= CONFIG.minSample) {
      /* R07: grafias diferentes */
      const groups = new Map();
      sample.forEach((x) => {
        const key = foldKey(x.v);
        const display = normalizeSpaces(x.v);
        if (!groups.has(key)) groups.set(key, new Map());
        const forms = groups.get(key);
        forms.set(display, (forms.get(display) || 0) + 1);
      });
      sample.forEach((x) => {
        const forms = groups.get(foldKey(x.v));
        if (forms.size < 2) return;
        const canonical = mostFrequent(forms);
        const display = normalizeSpaces(x.v);
        if (display !== canonical) {
          add('CASE', { row: x.r, line: x.line, col: c, value: x.v, detail: `Grafia "${display}" difere da mais frequente na coluna ("${canonical}").` });
        }
      });

      /* R12: padrão de formatação (apenas colunas com dígitos) */
      const shapes = new Map();
      sample.forEach((x) => { const s = shapeOf(x.v); shapes.set(s, (shapes.get(s) || 0) + 1); });
      const dominantShape = mostFrequent(shapes);
      if (dominantShape && dominantShape.includes('9') && shapes.get(dominantShape) >= CONFIG.typeThreshold * sample.length) {
        sample.forEach((x) => {
          const s = shapeOf(x.v);
          if (s !== dominantShape) {
            add('PATTERN', { row: x.r, line: x.line, col: c, value: x.v, detail: `Padrão "${s}" diferente do predominante "${dominantShape}" (9 = dígitos, A = letras).` });
          }
        });
      }
    }
  }

  /* Ordena, numera e cria índices de consulta */
  issues.sort((a, b) => a.line - b.line || (a.col ?? -1) - (b.col ?? -1) || a.ruleId.localeCompare(b.ruleId));
  issues.forEach((it, i) => { it.id = i; });

  const typeCounts = { missing: 0, duplicate: 0, inconsistency: 0, structure: 0 };
  const ruleCounts = {};
  Object.keys(RULES).forEach((k) => { ruleCounts[k] = { count: 0, lines: [] }; });
  const byRow = new Map();
  const cellIssues = new Map();

  for (const it of issues) {
    typeCounts[it.type]++;
    const rc = ruleCounts[it.ruleKey];
    rc.count++;
    if (rc.lines.length < 5 && !rc.lines.includes(it.line)) rc.lines.push(it.line);
    if (it.row != null) {
      if (!byRow.has(it.row)) byRow.set(it.row, []);
      byRow.get(it.row).push(it);
      if (it.col != null) {
        const key = it.row + ':' + it.col;
        if (!cellIssues.has(key)) cellIssues.set(key, []);
        cellIssues.get(key).push(it);
      }
    }
    if (it.col != null && it.type === 'inconsistency') columns[it.col].inconsistencies++;
  }

  const stats = {
    rows: rows.length,
    cols: nCols,
    missing: typeCounts.missing,
    duplicates: typeCounts.duplicate,
    inconsistencies: typeCounts.inconsistency,
    structure: typeCounts.structure,
    irregular: ruleCounts.FIELDS.count,
    rowsWithIssues: byRow.size,
    total: issues.length,
  };

  return {
    delimiter, autoDetected, headers, nCols, rows, issues, columns, notes, blankLines,
    stats, typeCounts, ruleCounts, byRow, cellIssues,
    hasExtra: rows.some((r) => r.fields.length > nCols),
  };
}

/* Exporta funções puras para testes em Node (ignorado no navegador). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV, detectDelimiter, analyze, RULES };
}

/* ---------------------------------------------------------------
   4. Interface
   --------------------------------------------------------------- */
const DEMO_FILENAME = 'dados_demonstrativos.csv';
const DEMO_CSV = String.raw`id,nome,email,telefone,cidade,estado,data_cadastro,valor_compra,status,observacao
1001,Ana Ribeiro,ana.ribeiro@exemplo.com,(48) 90000-0001,Florianópolis,SC,2024-01-10,150.50,Ativo,Cliente recorrente
1002,Bruno Martins,bruno.martins@exemplo.com,(11) 90000-0002,São Paulo,SP,2024-01-12,89.90,Ativo,Pedido entregue
1003,Carla Nogueira,carla.nogueira@exemplo.com,(21) 90000-0003,Rio de Janeiro,RJ,2024-01-15,230.00,Inativo,"Pediu contato, sem retorno"
1004,Daniel Prado,daniel.prado@exemplo.com,(48) 90000-0004,Florianópolis,SC,2024-01-18,75.00,Ativo,Aguardando pagamento
1005,Elisa Campos,elisa.campos@exemplo.com,(31) 90000-0005,Belo Horizonte,MG,2024-01-20,310.75,Ativo,"Endereço de entrega:
Rua Fictícia, 100"
1006,Fábio Teixeira,,(41) 90000-0006,Curitiba,PR,2024-01-22,120.00,Ativo,Sem pendências
1007,Gabriela Lins,gabriela.lins@exemplo.com,,Porto Alegre,RS,2024-01-25,64.30,Ativo,
1008,Henrique Alves,henrique.alves@exemplo.com,(48) 90000-0008,florianópolis,SC,2024-02-01,199.99,Ativo,Retirada na loja
1009,Isabela Freitas,isabela.freitas@exemplo.com,(11) 90000-0009,São Paulo,sp,2024-02-03,45.00,Ativo,Contato por e-mail
1010,  João Pereira ,joao.pereira@exemplo.com,(21) 90000-0010,Rio de Janeiro,RJ,2024-02-05,180,Ativo,Cliente recorrente
1011,Karen Duarte,karen.duarte#exemplo.com,(31) 90000-0011,Belo Horizonte,MG,2024-02-08,99.90,Ativo,Pedido entregue
1012,Lucas  Moreira,lucas.moreira@exemplo.com,(41) 90000-0012,Curitiba,PR,15/02/2024,140.00,Ativo,Aguardando pagamento
1013,Mariana Costa,mariana.costa@exemplo.com,(51) 90000-0013,Porto Alegre,RS,2024-02-17,"1.250,00",Ativo,Cliente recorrente
1014,Nelson Batista,nelson.batista@exemplo.com,48 90000 0014,Florianópolis,SC,2024-02-20,67.80,Ativo,Sem pendências
1015,Olívia Santana,olivia.santana@exemplo.com,(11) 90000-0015,São Paulo,SP,2024-02-22,abc,Ativo,Retirada na loja
1016,Paulo Vieira,paulo.vieira@exemplo.com,(21) 90000-0016,Rio de Janeiro,RJ,31/02/2024,55.00,Ativo,Contato por e-mail
1017,Quitéria Lopes,quiteria.lopes@exemplo.com,(31) 90000-0017,Belo Horizonte,MG,2024-03-01,N/A,Ativo,Cliente recorrente
1018,Rafael Gomes,rafael.gomes@exemplo.com,(41) 90000-0018,Curitiba,PR,2024-03-03,210.40,ATIVO,Pedido entregue
1019,Sofia Barros,sofia.barros@exemplo.com,(51) 90000-0019,Porto Alegre,RS,2024-03-05,88.00,Ativo,
1020,Tiago Ramos,tiago.ramos@exemplo.com,(48) 90000-0020,Florianópolis,SC,2024-03-08,130.00,Ativo,Aguardando pagamento
1020,Tiago Ramos,tiago.ramos@exemplo.com,(48) 90000-0020,Florianópolis,SC,2024-03-08,130.00,Ativo,Aguardando pagamento
1021,Úrsula Medeiros,ursula.medeiros@exemplo.com,(11) 90000-0021,São Paulo,SP,2024-03-10,76.50,Ativo,Retirada na loja
1022,Vitor Azevedo,vitor.azevedo@exemplo.com,(21) 90000-0022,Rio de Janeiro,RJ,2024-03-12
1023,Wanda Cardoso,wanda.cardoso@exemplo.com,(31) 90000-0023,Belo Horizonte,MG,2024-03-15,310.00,Ativo,Cliente VIP,extra
1024,Xavier Dias,xavier.dias@exemplo.com,(41) 90000-0024,Curitiba,PR,2024-03-18,59.90,Ativo,Contato por e-mail
1025,Yara Fonseca,yara.fonseca@exemplo.com,(51) 90000-0025,Porto Alegre,RS,2024-03-20,102.00,Ativo,Cliente recorrente
1001,ANA RIBEIRO,ana.ribeiro@exemplo.com,(48) 90000-0001,Florianópolis,SC,2024-01-10,150.50,Ativo,Cliente recorrente
1027,Zeca Moura,zeca.moura@exemplo.com,(48) 90000-0027,Florianópolis,SC,2024-03-25,,Ativo,Pedido entregue
1028,Alice Pinto,alice.pinto@exemplo.com,(11) 90000-0028,São Paulo,SP,2024-03-28,91.20,Ativo,Aguardando pagamento
1029,Beto Salles,beto.salles@exemplo.com,(21) 90000-0029,,RJ,2024-04-02,38.40,Ativo,
1030,Clara Reis,clara.reis@exemplo.com,(31) 90000-0030,Belo Horizonte,MG,2024-04-05,167.00,Inativo,Sem pendências`;

const state = {
  buffer: null, fileName: '', fileSize: 0,
  result: null, encodingUsed: '', encodingNote: '',
  filter: { type: 'all', col: 'all', q: '' },
  tablePage: 1, issuePage: 1,
  filteredRows: [], filteredIssues: [],
};
const ui = {};
const nf = new Intl.NumberFormat('pt-BR');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/* Mostra o valor exatamente como está no arquivo; espaços nas pontas aparecem como pontos. */
function renderValue(value) {
  const frag = document.createDocumentFragment();
  let s = value;
  const truncated = s.length > CONFIG.maxCellChars;
  if (truncated) s = s.slice(0, CONFIG.maxCellChars);
  const lead = (s.match(/^\s+/) || [''])[0];
  const trail = s.length > lead.length ? (s.match(/\s+$/) || [''])[0] : '';
  const core = s.slice(lead.length, s.length - trail.length).replace(/\n/g, ' ↵ ');
  const marker = (str) => el('span', { class: 'ws', title: 'espaço em branco' }, '·'.repeat(str.length));
  if (lead) frag.append(marker(lead));
  frag.append(core);
  if (trail) frag.append(marker(trail));
  if (truncated) frag.append('…');
  return frag;
}

/* ----- mensagens ----- */
function showMessage(kind, title, text) {
  const icons = { error: '!', warn: '!', success: '✓', info: 'i' };
  ui.messages.replaceChildren(
    el('div', { class: `msg msg-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      el('span', { class: 'msg-icon', 'aria-hidden': 'true' }, icons[kind]),
      el('div', { class: 'msg-body' }, el('strong', {}, title), text ? el('span', {}, ' ' + text) : null),
      el('button', { type: 'button', class: 'msg-close', 'aria-label': 'Fechar mensagem', onclick: clearMessage }, '×'),
    ),
  );
}
function clearMessage() { ui.messages.replaceChildren(); }

/* ----- leitura de arquivo ----- */
function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  if (fileList.length > 1) {
    showMessage('error', 'Selecione apenas um arquivo.', 'Esta ferramenta analisa um CSV por vez.');
    return;
  }
  const file = fileList[0];
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['csv', 'tsv', 'txt'].includes(ext)) {
    showMessage('error', 'Formato não suportado.', `O arquivo "${file.name}" não é .csv, .tsv ou .txt. Exporte seus dados como CSV e tente novamente.`);
    return;
  }
  if (file.size === 0) {
    showMessage('error', 'Arquivo vazio.', `"${file.name}" não tem nenhum conteúdo.`);
    return;
  }
  if (file.size > CONFIG.maxFileBytes) {
    showMessage('error', 'Arquivo muito grande.', `O limite é ${formatBytes(CONFIG.maxFileBytes)} e o arquivo tem ${formatBytes(file.size)}. Divida o arquivo em partes menores.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.buffer = reader.result;
    state.fileName = file.name;
    state.fileSize = file.size;
    processBuffer();
  };
  reader.onerror = () => showMessage('error', 'Erro de leitura.', `Não foi possível ler "${file.name}". Verifique se o arquivo não está aberto em outro programa ou corrompido e tente de novo.`);
  reader.onabort = () => showMessage('warn', 'Leitura cancelada.', 'O arquivo não foi carregado.');
  showMessage('info', 'Lendo arquivo...', '');
  reader.readAsArrayBuffer(file);
}

function loadDemo() {
  const bytes = new TextEncoder().encode(DEMO_CSV);
  state.buffer = bytes.buffer;
  state.fileName = DEMO_FILENAME;
  state.fileSize = bytes.byteLength;
  ui.encodingSelect.value = 'utf-8';
  ui.delimiterSelect.value = 'auto';
  processBuffer();
}

function decodeBuffer(buffer, choice) {
  if (choice === 'windows-1252') {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'Windows-1252', note: '' };
  }
  if (choice === 'utf-8') {
    const text = new TextDecoder('utf-8').decode(buffer);
    const note = text.includes('\uFFFD') ? 'O arquivo contém caracteres inválidos (�) em UTF-8. Tente a codificação Windows-1252.' : '';
    return { text, encoding: 'UTF-8', note };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8', note: '' };
  } catch (e) {
    return {
      text: new TextDecoder('windows-1252').decode(buffer), encoding: 'Windows-1252',
      note: 'O arquivo não é UTF-8 válido, então foi lido como Windows-1252. Confira se os acentos aparecem corretamente.',
    };
  }
}

function processBuffer() {
  if (!state.buffer) return;
  showMessage('info', 'Analisando...', '');
  setTimeout(() => {
    try {
      const decoded = decodeBuffer(state.buffer, ui.encodingSelect.value);
      const text = decoded.text.replace(/^\uFEFF/, '');
      if (text.includes('\u0000')) throw new UserError('O arquivo não parece ser texto (foram encontrados bytes binários). Confirme se é um CSV de verdade.');
      const result = analyze(text, ui.delimiterSelect.value);
      if (decoded.note) result.notes.unshift(decoded.note);
      state.result = result;
      state.encodingUsed = decoded.encoding;
      state.filter = { type: 'all', col: 'all', q: '' };
      renderResults();
      const s = result.stats;
      if (result.nCols === 1) {
        showMessage('warn', 'Análise concluída, mas só uma coluna foi encontrada.', 'Verifique o delimitador nas opções de leitura.');
      } else if (decoded.note) {
        showMessage('warn', 'Análise concluída com aviso.', decoded.note);
      } else if (s.total === 0) {
        showMessage('success', 'Nenhuma ocorrência encontrada pelas regras aplicadas.', 'Isso não garante que os dados estejam corretos: a ferramenta cobre apenas as regras listadas na página.');
      } else {
        showMessage('success', 'Análise concluída.', `${nf.format(s.total)} ocorrência(s) para revisar em ${nf.format(s.rowsWithIssues)} linha(s). Nada foi alterado no arquivo original.`);
      }
    } catch (err) {
      state.result = null;
      hideResults();
      if (err instanceof UserError) showMessage('error', 'Não foi possível analisar o arquivo.', err.message);
      else {
        console.error(err);
        showMessage('error', 'Erro inesperado durante a análise.', `Detalhe técnico: ${err.message}`);
      }
    }
  }, 30);
}

function hideResults() {
  ui.results.hidden = true;
  ui.emptyState.hidden = false;
  ui.fileInfo.textContent = '';
}

function clearAll() {
  state.buffer = null; state.result = null; state.fileName = '';
  state.filter = { type: 'all', col: 'all', q: '' };
  ui.fileInput.value = '';
  ui.delimiterSelect.value = 'auto';
  ui.encodingSelect.value = 'auto';
  hideResults();
  showMessage('info', 'Dados removidos da memória do navegador.', 'Você pode importar outro arquivo ou carregar os dados demonstrativos.');
}

/* ----- renderização geral ----- */
function renderResults() {
  ui.emptyState.hidden = true;
  ui.results.hidden = false;
  renderFileInfo();
  renderCards();
  renderColumns();
  renderFilters();
  applyFilters();
  renderReport();
}

function renderFileInfo() {
  const res = state.result;
  const delim = DELIMITER_NAMES[res.delimiter] + (res.autoDetected ? ', detectado automaticamente' : '');
  ui.fileInfo.textContent = `Arquivo: ${state.fileName} (${formatBytes(state.fileSize)}). Delimitador: ${delim}. Codificação: ${state.encodingUsed}.`;
}

function renderCards() {
  const s = state.result.stats;
  const defs = [
    { label: 'Registros', value: s.rows, hint: 'linhas de dados', filter: 'all' },
    { label: 'Colunas analisadas', value: s.cols, hint: 'campos do cabeçalho', filter: null },
    { label: 'Valores ausentes', value: s.missing, hint: 'células vazias', tone: 'missing', filter: 'missing' },
    { label: 'Duplicidades', value: s.duplicates, hint: 'linhas repetidas (exatas)', tone: 'duplicate', filter: 'duplicate' },
    { label: 'Inconsistências', value: s.inconsistencies, hint: 'possíveis, a revisar', tone: 'inconsistency', filter: 'inconsistency' },
    { label: 'Linhas irregulares', value: s.irregular, hint: 'nº de campos diferente do cabeçalho', tone: 'structure', filter: 'structure' },
    { label: 'Linhas com problema', value: s.rowsWithIssues, hint: 'ao menos uma ocorrência', filter: 'any' },
  ];
  ui.cards.replaceChildren(...defs.map((d) => {
    const inner = [
      el('span', { class: 'stat-label' }, d.label),
      el('span', { class: 'stat-value' }, nf.format(d.value)),
      el('span', { class: 'stat-hint' }, d.hint),
    ];
    const cls = `stat${d.tone ? ' tone-' + d.tone : ''}`;
    if (!d.filter) return el('div', { class: cls }, inner);
    return el('button', {
      type: 'button', class: `${cls} stat-action`, title: 'Filtrar a tabela e a lista por este indicador',
      onclick: () => { state.filter = { type: d.filter, col: 'all', q: '' }; applyFilters(); document.getElementById('dados').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    }, inner);
  }));
}

function renderColumns() {
  const res = state.result;
  ui.columnsBody.replaceChildren(...res.columns.map((c, i) => {
    const pct = c.cells ? (c.missing / c.cells) * 100 : 0;
    return el('tr', {},
      el('th', { scope: 'row' },
        el('button', {
          type: 'button', class: 'link-btn', title: 'Mostrar apenas ocorrências desta coluna',
          onclick: () => { state.filter = { type: 'any', col: i, q: '' }; applyFilters(); document.getElementById('dados').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        }, c.name)),
      el('td', {}, COLUMN_TYPE_LABEL[c.type]),
      el('td', { class: 'num' }, nf.format(c.filled)),
      el('td', { class: 'num' }, nf.format(c.missing)),
      el('td', { class: 'num' }, pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'),
      el('td', { class: 'num' }, nf.format(c.inconsistencies)),
      el('td', { class: 'num' }, nf.format(c.distinct)),
    );
  }));
}

/* ----- filtros ----- */
function renderFilters() {
  const res = state.result;
  const defs = [
    ['all', 'Todas as linhas', res.stats.rows],
    ['any', 'Com problemas', res.stats.rowsWithIssues],
    ['missing', 'Ausentes', res.typeCounts.missing],
    ['duplicate', 'Duplicados', res.typeCounts.duplicate],
    ['inconsistency', 'Inconsistências', res.typeCounts.inconsistency],
    ['structure', 'Estrutura', res.typeCounts.structure],
  ];
  ui.chips.replaceChildren(...defs.map(([key, label, count]) =>
    el('button', {
      type: 'button', class: `chip chip-${key}`, dataset: { type: key }, 'aria-pressed': 'false',
      onclick: () => { state.filter.type = key; applyFilters(); },
    }, label, el('span', { class: 'chip-count' }, nf.format(count)))));

  ui.columnFilter.replaceChildren(
    el('option', { value: 'all' }, 'Todas as colunas'),
    ...res.headers.map((h, i) => el('option', { value: String(i) }, h)),
  );

  const headRow = el('tr', {},
    el('th', { scope: 'col', class: 'col-line' }, 'Linha'),
    ...res.headers.map((h, i) => el('th', { scope: 'col', title: `Tipo inferido: ${COLUMN_TYPE_LABEL[res.columns[i].type]}` }, h)),
    res.hasExtra ? el('th', { scope: 'col' }, 'Campos extras') : null,
    el('th', { scope: 'col' }, 'Problemas'),
  );
  ui.tableHead.replaceChildren(headRow);
}

function syncFilterUI() {
  const f = state.filter;
  ui.chips.querySelectorAll('.chip').forEach((b) => {
    const on = b.dataset.type === f.type;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('active', on);
  });
  ui.columnFilter.value = String(f.col);
  ui.searchInput.value = f.q;
}

function typeColMatch(issue, f) {
  const typeOk = f.type === 'all' || f.type === 'any' || issue.type === f.type;
  const colOk = f.col === 'all' || issue.col === f.col;
  return typeOk && colOk;
}

function applyFilters() {
  const res = state.result;
  if (!res) return;
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  const structural = !(f.type === 'all' && f.col === 'all');

  state.filteredRows = [];
  res.rows.forEach((row, r) => {
    if (structural && !(res.byRow.get(r) || []).some((i) => typeColMatch(i, f))) return;
    if (q && !(String(row.line) === q || row.fields.some((x) => x.toLowerCase().includes(q)))) return;
    state.filteredRows.push(r);
  });

  state.filteredIssues = res.issues.filter((i) => {
    if (!typeColMatch(i, f)) return false;
    if (!q) return true;
    return `${i.line} ${i.column} ${i.value} ${i.detail} ${i.ruleName} ${i.ruleId}`.toLowerCase().includes(q);
  });

  state.tablePage = 1;
  state.issuePage = 1;
  syncFilterUI();
  renderTable();
  renderIssues();
  ui.exportFiltered.textContent = `Exportar visão filtrada (${nf.format(state.filteredIssues.length)})`;
}

function renderPager(container, page, pages, onChange) {
  if (pages <= 1) { container.replaceChildren(); return; }
  container.replaceChildren(
    el('button', { type: 'button', class: 'btn btn-small', disabled: page <= 1, onclick: () => onChange(page - 1) }, 'Anterior'),
    el('span', { class: 'pager-label' }, `Página ${nf.format(page)} de ${nf.format(pages)}`),
    el('button', { type: 'button', class: 'btn btn-small', disabled: page >= pages, onclick: () => onChange(page + 1) }, 'Próxima'),
  );
}

/* ----- tabela de dados ----- */
function renderTable() {
  const res = state.result;
  const total = state.filteredRows.length;
  const pages = Math.max(1, Math.ceil(total / CONFIG.pageSize));
  state.tablePage = Math.min(Math.max(1, state.tablePage), pages);
  const start = (state.tablePage - 1) * CONFIG.pageSize;
  const slice = state.filteredRows.slice(start, start + CONFIG.pageSize);
  const colSpan = res.nCols + 2 + (res.hasExtra ? 1 : 0);

  if (slice.length === 0) {
    ui.tableBody.replaceChildren(el('tr', {}, el('td', { colspan: colSpan, class: 'empty-cell' }, 'Nenhuma linha corresponde aos filtros atuais.')));
  } else {
    const frag = document.createDocumentFragment();
    for (const r of slice) {
      const row = res.rows[r];
      const rowIssues = res.byRow.get(r) || [];
      const rowTypes = new Set(rowIssues.filter((i) => i.col == null).map((i) => i.type));
      const rowClass = [rowTypes.has('duplicate') && 'row-duplicate', rowTypes.has('structure') && 'row-structure', rowTypes.has('inconsistency') && 'row-possible'].filter(Boolean).join(' ');
      const tr = el('tr', { dataset: { row: r }, class: rowClass || null });
      tr.append(el('td', { class: 'col-line' }, row.line));
      for (let c = 0; c < res.nCols; c++) {
        if (c >= row.fields.length) {
          tr.append(el('td', { class: 'cell cell-absent', title: 'Esta linha não tem este campo.' }, '-'));
          continue;
        }
        const list = res.cellIssues.get(r + ':' + c);
        const cls = ['cell'];
        if (list) {
          const types = new Set(list.map((i) => i.type));
          if (types.has('missing')) cls.push('cell-missing');
          if (types.has('inconsistency')) cls.push('cell-inconsistency');
        }
        const value = row.fields[c];
        tr.append(el('td', { class: cls.join(' '), title: list ? list.map((i) => `${i.ruleId}: ${i.detail}`).join('\n') : null },
          value === '' ? el('span', { class: 'muted' }, 'vazio') : renderValue(value)));
      }
      if (res.hasExtra) {
        const extra = row.fields.slice(res.nCols);
        tr.append(el('td', { class: extra.length ? 'cell cell-structure' : 'cell' }, extra.length ? extra.join(' | ') : ''));
      }
      const counts = {};
      rowIssues.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });
      const badges = Object.entries(counts).map(([t, n]) => el('span', { class: `badge badge-${t}` }, `${nf.format(n)} ${n === 1 ? TYPE_INFO[t].label.toLowerCase() : TYPE_INFO[t].plural.toLowerCase()}`));
      tr.append(el('td', { class: 'cell-badges' }, badges.length ? badges : el('span', { class: 'muted' }, '-')));
      frag.append(tr);
    }
    ui.tableBody.replaceChildren(frag);
  }

  const from = total ? start + 1 : 0;
  const to = Math.min(start + CONFIG.pageSize, total);
  ui.tableInfo.textContent = `Exibindo ${nf.format(from)} a ${nf.format(to)} de ${nf.format(total)} linha(s) (${nf.format(res.stats.rows)} no arquivo).`;
  renderPager(ui.tablePager, state.tablePage, pages, (p) => { state.tablePage = p; renderTable(); });
}

function goToRow(r) {
  state.filter = { type: 'all', col: 'all', q: '' };
  applyFilters();
  state.tablePage = Math.floor(r / CONFIG.pageSize) + 1;
  renderTable();
  const tr = ui.tableBody.querySelector(`tr[data-row="${r}"]`);
  if (tr) {
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tr.classList.add('flash');
    setTimeout(() => tr.classList.remove('flash'), 2200);
  }
}

/* ----- lista de problemas ----- */
function renderIssues() {
  const total = state.filteredIssues.length;
  const pages = Math.max(1, Math.ceil(total / CONFIG.pageSize));
  state.issuePage = Math.min(Math.max(1, state.issuePage), pages);
  const start = (state.issuePage - 1) * CONFIG.pageSize;
  const slice = state.filteredIssues.slice(start, start + CONFIG.pageSize);

  if (slice.length === 0) {
    ui.issuesBody.replaceChildren(el('tr', {}, el('td', { colspan: 7, class: 'empty-cell' },
      state.result.issues.length === 0 ? 'Nenhuma ocorrência encontrada pelas regras aplicadas.' : 'Nenhuma ocorrência corresponde aos filtros atuais.')));
  } else {
    ui.issuesBody.replaceChildren(...slice.map((i) => el('tr', {},
      el('td', {}, el('span', { class: `badge badge-${i.type}` }, TYPE_INFO[i.type].label)),
      el('td', { class: 'num' }, i.line),
      el('td', {}, i.column || '-'),
      el('td', { class: 'cell' }, i.value === '' ? el('span', { class: 'muted' }, 'vazio') : renderValue(i.value)),
      el('td', { title: RULES[i.ruleKey].description }, el('span', { class: 'rule-id' }, i.ruleId), ' ', i.ruleName),
      el('td', { class: 'wrap' }, i.detail),
      el('td', {}, i.row != null ? el('button', { type: 'button', class: 'btn btn-small', onclick: () => goToRow(i.row) }, 'Ver na tabela') : null),
    )));
  }
  const from = total ? start + 1 : 0;
  const to = Math.min(start + CONFIG.pageSize, total);
  ui.issuesInfo.textContent = `Exibindo ${nf.format(from)} a ${nf.format(to)} de ${nf.format(total)} ocorrência(s).`;
  renderPager(ui.issuesPager, state.issuePage, pages, (p) => { state.issuePage = p; renderIssues(); });
}

/* ----- relatório ----- */
function renderReport() {
  const res = state.result;
  const s = res.stats;
  ui.reportMeta.replaceChildren(
    ...[
      ['Arquivo', state.fileName],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      ['Delimitador', DELIMITER_NAMES[res.delimiter]],
      ['Codificação', state.encodingUsed],
    ].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]),
  );

  const paragraphs = [
    `O arquivo tem ${nf.format(s.rows)} registro(s) e ${nf.format(s.cols)} coluna(s). Pelas regras aplicadas, foram encontradas ${nf.format(s.total)} ocorrência(s): ${nf.format(s.missing)} valor(es) ausente(s), ${nf.format(s.duplicates)} linha(s) duplicada(s) exata(s), ${nf.format(s.inconsistencies)} possível(is) inconsistência(s) de formatação ou conteúdo e ${nf.format(s.structure)} ocorrência(s) de estrutura (campos irregulares, cabeçalho ou aspas). ${nf.format(s.rowsWithIssues)} linha(s) têm ao menos uma ocorrência.`,
    s.total === 0
      ? 'Nenhuma ocorrência foi encontrada, mas isso não prova que os dados estejam corretos: a ferramenta só aplica as regras listadas abaixo.'
      : 'As ocorrências são indícios para revisão, não confirmações de erro. Um valor sinalizado pode estar correto no contexto do seu negócio, e problemas fora das regras listadas não são detectados. Nenhuma correção foi aplicada ao arquivo original.',
  ];
  ui.reportSummary.replaceChildren(...paragraphs.map((p) => el('p', {}, p)));

  const withHits = Object.entries(RULES).filter(([k]) => res.ruleCounts[k].count > 0);
  const clean = Object.entries(RULES).filter(([k]) => res.ruleCounts[k].count === 0).map(([, r]) => r.id);
  const rows = withHits.map(([k, rule]) => {
    const rc = res.ruleCounts[k];
    const extra = rc.count > rc.lines.length ? ` (e mais)` : '';
    return el('tr', {},
      el('td', {}, el('span', { class: 'rule-id' }, rule.id)),
      el('td', {}, el('span', { class: `badge badge-${rule.type}` }, TYPE_INFO[rule.type].label)),
      el('td', {}, rule.name),
      el('td', { class: 'num' }, nf.format(rc.count)),
      el('td', { class: 'wrap' }, 'Linhas ' + rc.lines.join(', ') + extra),
    );
  });
  ui.reportRulesBody.replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 5, class: 'empty-cell' }, 'Nenhuma regra gerou ocorrências.'))]));

  const notes = [...res.notes];
  if (clean.length && withHits.length) notes.push(`Regras sem ocorrências neste arquivo: ${clean.join(', ')}.`);
  ui.reportNotes.replaceChildren(...notes.map((n) => el('li', {}, n)));
  ui.reportNotes.hidden = notes.length === 0;
}

/* ----- catálogo de regras (sempre visível) ----- */
function renderRulesCatalog() {
  ui.rulesBody.replaceChildren(...Object.values(RULES).map((r) => el('tr', {},
    el('td', {}, el('span', { class: 'rule-id' }, r.id)),
    el('td', {}, el('span', { class: `badge badge-${r.type}` }, TYPE_INFO[r.type].label)),
    el('th', { scope: 'row' }, r.name),
    el('td', { class: 'wrap' }, r.description),
  )));
}

/* ---------------------------------------------------------------
   5. Exportação do relatório em CSV
   --------------------------------------------------------------- */
function csvCell(value) {
  let s = String(value ?? '');
  /* Evita que planilhas interpretem o texto como fórmula (CSV injection). */
  if (/^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildReportCSV(issues) {
  const header = ['tipo', 'id_regra', 'regra', 'linha_no_arquivo', 'coluna', 'valor_original', 'detalhe'];
  const lines = [header.join(',')];
  for (const i of issues) {
    lines.push([TYPE_INFO[i.type].label, i.ruleId, i.ruleName, i.line, i.column, i.value, i.detail].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

function downloadText(filename, text, mime) {
  const blob = new Blob(['\uFEFF' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportReport(filtered) {
  const res = state.result;
  if (!res) { showMessage('error', 'Nada para exportar.', 'Importe um arquivo ou carregue os dados demonstrativos primeiro.'); return; }
  const list = filtered ? state.filteredIssues : res.issues;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const base = state.fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'dados';
  downloadText(`relatorio_qualidade_${base}${filtered ? '_filtrado' : ''}_${stamp}.csv`, buildReportCSV(list), 'text/csv;charset=utf-8');
  showMessage('success', 'Relatório exportado.', list.length === 0 ? 'O arquivo contém apenas o cabeçalho, pois não há ocorrências.' : `${nf.format(list.length)} ocorrência(s) no arquivo CSV.`);
}

/* ---------------------------------------------------------------
   6. Inicialização
   --------------------------------------------------------------- */
function init() {
  [
    'fileInput', 'dropzone', 'demoBtn', 'clearBtn', 'delimiterSelect', 'encodingSelect', 'messages', 'fileInfo',
    'emptyState', 'results', 'cards', 'columnsBody', 'chips', 'columnFilter', 'searchInput', 'clearFilters',
    'tableHead', 'tableBody', 'tablePager', 'tableInfo', 'issuesBody', 'issuesPager', 'issuesInfo',
    'exportAll', 'exportFiltered', 'reportMeta', 'reportSummary', 'reportRulesBody', 'reportNotes', 'rulesBody',
  ].forEach((id) => { ui[id] = document.getElementById(id); });

  renderRulesCatalog();

  ui.fileInput.addEventListener('change', () => { handleFiles(ui.fileInput.files); ui.fileInput.value = ''; });
  ui.demoBtn.addEventListener('click', loadDemo);
  ui.clearBtn.addEventListener('click', clearAll);
  ui.delimiterSelect.addEventListener('change', () => { if (state.buffer) processBuffer(); });
  ui.encodingSelect.addEventListener('change', () => { if (state.buffer) processBuffer(); });

  ui.dropzone.addEventListener('click', (e) => { if (!e.target.closest('button, label, select, a, input')) ui.fileInput.click(); });
  ['dragenter', 'dragover'].forEach((ev) => ui.dropzone.addEventListener(ev, (e) => { e.preventDefault(); ui.dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => ui.dropzone.addEventListener(ev, (e) => { e.preventDefault(); ui.dropzone.classList.remove('is-over'); }));
  ui.dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  /* Evita que soltar um arquivo fora da área abra o CSV no navegador. */
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!(e.target.closest && e.target.closest('#dropzone'))) e.preventDefault(); }));

  ui.columnFilter.addEventListener('change', () => {
    const v = ui.columnFilter.value;
    state.filter.col = v === 'all' ? 'all' : Number(v);
    applyFilters();
  });
  let searchTimer;
  ui.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filter.q = ui.searchInput.value; applyFilters(); }, 200);
  });
  ui.clearFilters.addEventListener('click', () => { state.filter = { type: 'all', col: 'all', q: '' }; applyFilters(); });
  ui.exportAll.addEventListener('click', () => exportReport(false));
  ui.exportFiltered.addEventListener('click', () => exportReport(true));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
