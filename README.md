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

Para publicar a sequência a partir do Google Sheets, publique a aba como CSV e cole a URL em `PLAYLIST_SOURCE_URL`, no início de `app.js`.

A planilha deve conter pelo menos duas colunas:

```csv
title,url
Abrigo na Rocha,abrigo_na_rocha.mp3
Aquele Dia,aquele_dia.mp3
```

A URL pode ser uma URL completa para o arquivo de áudio ou apenas o nome do arquivo hospedado no mesmo repositório. A aplicação verifica a fonte novamente a cada 60 segundos, sem atualizar a página.

## Publicação

No GitHub, habilite **Settings → Pages → Deploy from a branch → main → / (root)**. Após a publicação, a página ficará disponível na URL do GitHub Pages do repositório.

A reprodução precisa ser iniciada por uma interação do ouvinte. O comportamento com tela bloqueada depende do navegador, do sistema operacional e da economia de bateria do aparelho; o site usa áudio nativo e Media Session API, mas nenhum site consegue garantir execução contínua em todos os celulares.
