# Data Quality Analyzer

Aplicação web para analisar a qualidade de dados em arquivos CSV antes de usá-los em análises ou relatórios. Feita com HTML, CSS e JavaScript puros, sem backend, sem bibliotecas externas e sem serviços pagos.

**Privacidade:** todo o processamento acontece no navegador. O arquivo escolhido não é enviado a nenhum servidor e o arquivo original nunca é alterado.

## Objetivo

Ajudar a identificar, de forma rápida e transparente, problemas comuns de qualidade em um CSV: valores ausentes, linhas repetidas, espaços extras, formatos misturados e linhas com número irregular de campos. Cada ocorrência mostra a regra que a gerou, para que a pessoa possa revisar e decidir o que fazer.

## Funcionalidades

- Importação de CSV pelo computador (botão ou arrastar e soltar), com detecção automática de delimitador (`,` `;` Tab `|`) e de codificação (UTF-8 ou Windows-1252).
- Leitura correta de campos entre aspas com vírgulas, aspas duplicadas e quebras de linha.
- Tabela de dados paginada, com destaque nas células problemáticas e espaços nas pontas visíveis como pontos.
- Indicadores: total de registros, colunas analisadas, valores ausentes, duplicidades, inconsistências, linhas irregulares e linhas com problema.
- Resumo por coluna: tipo inferido, preenchidos, ausentes, percentual de ausentes, inconsistências e valores distintos.
- Filtros por tipo de problema, por coluna e busca por texto, aplicados à tabela e à lista de problemas.
- Lista de problemas com tipo, linha, coluna, valor original, regra e detalhe, com atalho "Ver na tabela".
- Relatório final com resumo, ocorrências por regra e observações da leitura.
- Exportação do relatório em CSV (completo ou apenas a visão filtrada).
- Botão de dados demonstrativos (fictícios) e botão de limpar.
- Mensagens claras para arquivo inválido, vazio, grande demais, sem dados, com bytes binários, com aspas abertas, erro de leitura e problemas de codificação.

## Categorias e regras

Os problemas são separados em quatro categorias: **ausentes**, **duplicados**, **inconsistências** (possíveis, a revisar) e **estrutura**.

| ID | Categoria | Regra |
|----|-----------|-------|
| R01 | Ausente | Campo vazio ou só com espaços |
| R02 | Duplicado | Linha idêntica a uma anterior (todos os campos) |
| R03 | Inconsistência | Linha igual a uma anterior só após ignorar espaços, maiúsculas e acentos |
| R04 | Inconsistência | Espaços no início ou no fim do valor |
| R05 | Inconsistência | Dois ou mais espaços seguidos no meio do valor |
| R06 | Inconsistência | Possível marcador de ausência (N/A, null, nan, -, ?, "não informado" etc.) |
| R07 | Inconsistência | Grafias diferentes do mesmo valor em colunas de texto (caixa, acentos, espaços) |
| R08 | Inconsistência | Valor incompatível com o tipo predominante da coluna (número, data ou e-mail) |
| R09 | Inconsistência | Formato de data diferente do predominante na coluna |
| R10 | Inconsistência | Data inexistente no calendário (por exemplo 31/02/2024) |
| R11 | Inconsistência | Separador decimal diferente do predominante (vírgula x ponto) |
| R12 | Inconsistência | Padrão de formatação diferente do predominante em colunas de texto com dígitos (telefone, CEP, códigos) |
| R13 | Estrutura | Quantidade de campos diferente da do cabeçalho |
| R14 | Estrutura | Nome de coluna vazio ou repetido |
| R15 | Estrutura | Aspas abertas e nunca fechadas |

Parâmetros usados: uma coluna é tratada como numérica, data ou e-mail quando pelo menos 70% dos valores preenchidos (e não marcados como ausência) seguem esse formato, com no mínimo 3 valores. Esses limiares são constantes no começo de `js/main.js` (`CONFIG`).

## Tecnologias

- HTML5, CSS3 e JavaScript (ES2020) sem dependências.
- Parser CSV próprio (máquina de estados compatível com RFC 4180), escrito em `js/main.js`.
- APIs do navegador: `FileReader`, `TextDecoder`, `Blob` e `URL.createObjectURL` para ler arquivos e baixar o relatório.

Como não há bibliotecas externas, não existe dependência para instalar nem CDN para configurar.

## Estrutura do projeto

```
data-quality-analyzer/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── main.js
├── data/
│   └── exemplo_clientes.csv    (CSV sintético para testes)
└── README.md
```

O mesmo conjunto de dados de `data/exemplo_clientes.csv` está embutido em `js/main.js` para que o botão de demonstração funcione também ao abrir `index.html` direto do disco (sem servidor).

## Como executar localmente

**Opção 1:** abra o arquivo `index.html` com duplo clique. Tudo funciona, inclusive o botão de dados demonstrativos.

**Opção 2:** sirva a pasta com um servidor local (opcional):

```bash
cd data-quality-analyzer
python3 -m http.server 8000
# abra http://localhost:8000
```

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo `data-quality-analyzer`) e envie todos os arquivos, com `index.html` na raiz.
2. No repositório, abra **Settings > Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**, selecione a branch `main` e a pasta `/ (root)`, e salve.
4. Aguarde alguns minutos. O site ficará em `https://SEU-USUARIO.github.io/data-quality-analyzer/`.

Todos os caminhos são relativos (`css/style.css`, `js/main.js`), então o projeto funciona em subpastas do GitHub Pages sem ajustes.

## Como testar cada funcionalidade

Use `data/exemplo_clientes.csv` (ou o botão **Carregar dados demonstrativos**, que usa o mesmo conteúdo). Os números abaixo são os esperados para esse arquivo.

| Funcionalidade | Como testar | Resultado esperado |
|----------------|-------------|--------------------|
| Importação | Escolha ou arraste `exemplo_clientes.csv` | Mensagem de análise concluída; arquivo, delimitador e codificação aparecem abaixo |
| Dados demonstrativos | Clique em "Carregar dados demonstrativos" | Mesma análise, sem escolher arquivo |
| Tabela | Role a tabela e use "Próxima" | 31 registros em páginas de 50 linhas; células ausentes em amarelo e inconsistências em azul |
| Ausentes | Clique no indicador "Valores ausentes" | 7 células (e-mail, telefone, cidade, valor_compra e 3 observações) |
| Duplicados | Filtro "Duplicados" | 1 linha: a segunda ocorrência do id 1020 (igual à linha 22) |
| Espaços e formatação | Filtro "Inconsistências" | 15 ocorrências, entre elas espaços nas pontas em "João Pereira", espaços duplos em "Lucas  Moreira", "sp", "ATIVO", "florianópolis", data 15/02/2024, data 31/02/2024, "abc", "N/A", "1.250,00", e-mail com `#` e telefone "48 90000 0014" |
| Possível duplicidade | Mesmo filtro | A linha 29 ("ANA RIBEIRO") fica igual à linha 2 após normalização |
| Linhas irregulares | Filtro "Estrutura" | 2 linhas: a de 7 campos (linha 25) e a de 11 campos (linha 26) |
| Campo com vírgula e quebra de linha | Veja as linhas 4 e 6 da tabela | "Pediu contato, sem retorno" e o endereço em duas linhas ficam em uma única célula |
| Indicadores | Veja os cartões | 31 registros, 10 colunas, 7 ausentes, 1 duplicidade, 15 inconsistências, 2 linhas irregulares, 20 linhas com problema |
| Filtro por coluna e busca | Escolha "valor_compra" ou busque "abc" | Tabela e lista reduzidas às ocorrências correspondentes |
| Lista de problemas | Clique em "Ver na tabela" em qualquer item | A tabela vai para a linha correspondente e a destaca por instantes |
| Relatório | Role até "Relatório de qualidade" | Resumo, ocorrências por regra e exemplos de linhas |
| Exportação | "Exportar relatório (CSV)" e "Exportar visão filtrada" | Download de `relatorio_qualidade_...csv` (25 ocorrências no completo) |
| Opções de leitura | Altere delimitador ou codificação | A análise é refeita com a nova opção |
| Limpar | Clique em "Limpar" | Resultados somem e a tela volta ao estado inicial |

Testes de erro:

- Arquivo `.pdf` ou `.xlsx`: mensagem de formato não suportado.
- Arquivo vazio, ou com apenas o cabeçalho: mensagem específica.
- Arquivo com mais de 25 MB: mensagem de limite.
- Arquivo com aspas abertas: ocorrência R15 e aviso na lista.
- CSV com ponto e vírgula e delimitador forçado para vírgula: aparece o aviso de uma única coluna.

## Sobre o relatório exportado

O CSV tem as colunas `tipo`, `id_regra`, `regra`, `linha_no_arquivo`, `coluna`, `valor_original` e `detalhe`. Ele é gerado em UTF-8 com BOM, para abrir com acentos corretos no Excel. Valores que começam com `=`, `+`, `@` ou `-` (quando não seguido de dígito) recebem um apóstrofo no início para evitar que planilhas os interpretem como fórmulas.

## Limitações

- A ferramenta **não detecta todos os erros possíveis**. Ela aplica apenas as regras listadas acima.
- Inconsistências são indícios para revisão humana, não confirmações de erro.
- Duplicidade é avaliada na linha inteira, não por coluna-chave.
- Datas com barra são lidas como DD/MM/AAAA; arquivos MM/DD/AAAA podem gerar falsos alertas.
- A validação de e-mail é simplificada.
- O tipo da coluna é inferido por proporção de valores; colunas com poucos valores não têm tipo nem padrão avaliados.
- Aspas soltas em campos sem aspas são aceitas como texto comum.
- O arquivo é lido inteiro na memória; arquivos grandes podem deixar a análise lenta (limite de 25 MB).
- Nenhuma métrica de precisão é calculada ou afirmada.

## Dados demonstrativos

Todos os nomes, e-mails (domínio `exemplo.com`), telefones e valores de `data/exemplo_clientes.csv` são fictícios e foram criados apenas para testar a ferramenta.
