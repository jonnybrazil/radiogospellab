# Rádio Gospel Lab

Home page de uma pseudo-rádio ao vivo para a Igreja Batista Luz, hospedável no GitHub Pages.

## O que já está implementado

- Página única responsiva inspirada na identidade visual fornecida.
- Player com dois elementos de áudio e Web Audio API.
- Pré-carregamento da próxima faixa, crossfade e ducking durante a transição.
- Controles de iniciar, pausar, volume e silêncio.
- Media Session API para controles compatíveis na tela bloqueada.
- Atualização periódica da fila sem recarregar a página.
- Playlist local inicial em `playlist.csv`.
- Mensagem do dia em `mensagem.txt`.
- Avisos em `avisos.txt`.
- Patrocinadores em `patrocinadores.html`.
- Manifesto e service worker básicos para instalação como PWA.

## Google Sheets

A programação, os avisos e o contador de visitas usam um Google Apps Script publicado como Web App. A URL do endpoint está configurada no início de `app.js`. O site consulta a programação conforme o intervalo definido na aba `Config`, sem recarregar a página, e registra cada carregamento da home na aba `Visitas`.

A aba `Playlist` usa estas colunas:

```csv
numero_faixa,ordem,título,caminho,ativo
101,1,Abrigo na Rocha,abrigo_na_rocha.mp3,SIM
102,2,Aquele Dia,aquele_dia.mp3,SIM
```

A célula `Config!B2` controla a sequência manual, por exemplo `101,102,103`. O Apps Script também retorna o total de visitas acumulado em `Visitas`.

A aba `Avisos` usa as colunas `ordem`, `texto` e `ativo`. O Apps Script retorna os avisos ativos ordenados, e o site alterna os textos a cada 10 segundos com fade-out e fade-in de 500 ms. Se não houver avisos ativos na planilha, o arquivo local `avisos.txt` é usado como fallback.

A aba `Patrocinio` usa `ordem`, `nome`, `imagem_url`, `descricao`, `link_compra` e `ativo`. Os produtos ativos são exibidos em dois cards por linha, com imagem e informação lado a lado, formando quatro colunas visuais no desktop. A seção fica fechada por padrão e é aberta pelo botão `Ver mais`. Os links usam `rel="sponsored nofollow noopener"`.

A home usa o título `RADIOGOSPELLAB`, um ícone de olho para o contador, indicador ao vivo vermelho e um player minimalista com apenas play/pausa e título da faixa. A página independente `em-construcao.html` usa o mesmo visual para períodos de manutenção ou preparação.

## Publicação

No GitHub, habilite **Settings → Pages → Deploy from a branch → main → / (root)**. Após a publicação, a página ficará disponível na URL do GitHub Pages do repositório.

A reprodução precisa ser iniciada por uma interação do ouvinte. O comportamento com tela bloqueada depende do navegador, do sistema operacional e da economia de bateria do aparelho; o site usa áudio nativo e Media Session API, mas nenhum site consegue garantir execução contínua em todos os celulares.
