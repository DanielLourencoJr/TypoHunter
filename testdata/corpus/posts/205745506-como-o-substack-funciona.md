---
title: Como o Substack Funciona?
slug: como-o-substack-funciona
audience: everyone
publication_id: 6465422
id: 205745506
---

---

Como uso primariamente o Obsidian como editor de texto — visto que ele suporta formatação Markdown — para anotações pessoais e escrever meus textos que publico aqui no Substack, pensei se seria possível criar um plugin que me permitisse publicá-los com um único comando, já que meu procedimento atual é copiar e colar no editor do Substack e fazer quaisquer adaptações necessárias além de fazer upload manual de imagens.

![Um programa de edição de texto com quatro colunas, a mais a esquerda mostra os diretórios dos arquivos abertos. As três abas à direita mostram postagens em texto com imagens, metadados de engajamento e ID do usuário.](https://substack-post-media.s3.amazonaws.com/public/images/b524198c-fd6a-4e68-b276-33384b8328cc_1920x1044.png "Todas as minhas postagens exportadas em arquivos agregados por mês.")

Pra minha surpresa, [esse plugin já existia](https://github.com/roomi-fields/obsidian-content-publisher). Me contentarei então em estudar como isso funciona em detalhes. Como o Substack permite, mesmo que não intencionalmente, que outras aplicações façam uso das suas informações públicas e realizem ações em nome do usuário.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->

---

## Entendendo APIs

*Application Programming Interface*(API) é um protocolo que dois programas usam para se comunicar. Uma API define que tipos de requisição são aceitos, quais dados recebe, quais dados fornece, que tipo de autorização e/ou autenticação são necessárias.

Esses programas podem tanto ser de empresas diferentes, quanto da mesma. A seguir alguns exemplos:

- Claude Code, OpenCode, Codex, etc. são programas no seu computador que fazem uso de modelos de linguagem — que requerem bastante poder de processamento em um servidor dedicado — por meio de uma API, trafegando texto pela internet.
- Programas desktop têm uma interface para uso humano que chama funções do Sistema Operacional para realizar ações como, por exemplo, leitura e escrita de arquivos por meio de uma API, desta vez sem uso de internet.
- Aplicações web como YouTube e o próprio Substack usam APIs internas para pedir dinamicamente o conteúdo da página, ao invés de pedir a página inteira pronta.

---

## Entendendo SPA (Single Page Application)

Diferente de páginas web estáticas, como a Wikipédia, onde todo o conteúdo é reunido em uma página HTML auto-contida pelo servidor e enviada ao navegador do usuário, *Single Page Applications* requerem comunicação constante entre cliente e servidor, onde o cliente pede constantemente por novos dados para, por exemplo, regenerar um feed.

Essa comunicação pode se dar por requisições HTTP padrão, ou por um protocolo específico, uma API.

O nome vem do fato que SPAs tendem a ter um fluxo de navegação diferente. Você não navega entre páginas diferentes, mas a página atual vai mudando gradualmente conforme necessário.

---

## O caso do Substack

Aqui pretendo mostrar como o sistema web, o site, do Substack se comunica com o servidor e como essa comunicação pode ser replicada por outros programas. O texto é naturalmente técnico, mas não é voltado apenas para programadores.

Para começar existe uma página web que você recebe ao digitar a URL do Substack. Essa página é vazia, com apenas um template pronto para receber o conteúdo com o mínimo de fricção possível e um JavaScript que fará uma requisição ao servidor pedindo o conteúdo real da página.

O conteúdo é carregado dinamicamente, portanto ele precisa de um controle fino do que ele quer e o que não quer. Diferente de requisições HTTP cruas que devolvem uma página inteira, usa-se uma API que devolve o conteúdo em um formato de texto estruturado, o JSON.

Por exemplo, o JavaScript da página inicial faz uma requisição para o endpoint [https://substack.com/api/v1/reader/feed](https://substack.com/api/v1/reader/feed) para montar o “For You”. Essa requisição não requer nenhum tipo de autenticação e pode ser feito até mesmo por uma aba anônima. Claro que com a devida autenticação em uma conta usada para interagir com postagens vai receber uma coletânea de posts personalizada.

O padrão de resposta desse endpoint é de cinco *notes*, um *artigo* e *sugestões* de perfis para seguir. Posso supor que seu navegador faz novas requisições conforme você desce a página o suficiente.

A autenticação se dá por meio de um token fornecido no momento do login. É por meio dele que o servidor sabe sua identidade, o que é necessário para certas ações e requisições.

---

## API oficial vs não oficial

APIs oficiais são bem documentadas e abertas para uso público com as devidas limitações e restrições. Já APIs não oficiais são geralmente usadas internamente, entre serviços da própria empresa em diversos tipos de arquitetura de software e tipos de tecnologias.

O Substack cai na segunda categoria e tem cláusulas claras em seus [Termos de Uso](https://substack.com/tos) sobre uso das suas tecnologias.

> You also agree that you will not contribute any Post or otherwise use Substack in a manner that: 
> 
> [...]
> 
> - Runs Maillist, Listserv, any form of auto-responder or “spam” on Substack, or **any processes that run or are activated while you are not logged into Substack**, or that otherwise interferes with the proper working of Substack (including placing an unreasonable load on Substack’s infrastructure);
> - “Crawls,” “scrapes,” or “spiders” any page, data, or portion of Substack (through use of manual or automated means);
> - Copies or stores any significant portion of the content on Substack;
> - Decompiles, reverse engineers, or otherwise attempts to obtain the source code or underlying ideas or information of or relating to Substack.
> 
> Acessado em: 24/06/2026

Portanto, por mais que seja simples de explorar o formato de requisições e resposta por contra própria — além de existirem vários projetos que documentam em mais detalhes o funcionamento da API — me limito a apresentar uma visão geral do funcionamento e apresentar possíveis usos do recurso por aplicações externas.

---

## Informações Públicas

Existem certas rotas que não necessitam de autenticação pela natureza da ação a ser realizada. Uma que se destaca é [https://substack.com/api/v1/reader/feed/profile/{id}](https://substack.com/api/v1/reader/feed/profile/%7Bid%7D) que retorna todos os posts de um usuário de forma paginada, ou seja, retorna uma página com os 12 posts mais recentes. Você pode mudar o número do cursor enviado na requisição para ver a segunda página e assim por diante.

Para descobrir o *ID* de um usuário para usar em rotas como a anterior podemos usar [https://substack.com/api/v1/user/{handle}/public_profile](https://substack.com/api/v1/user/%7Bhandle%7D/public_profile). *Handle* geralmente é o arroba de um perfil, apesar de um perfil poder ter vários *handles*.

Usando apenas essas duas rotas seria possível fazer um pequeno script que exporta todos os seus posts públicos do usuário para arquivos *Markdown* preservando a formatação original e fazendo o download de imagens usadas. Acredito que isso não vá contra o *Termo de Uso* uma vez que ele garante ao usuário o direito sobre o conteúdo que produz e dá ao Substack o direito de apagá-lo a qualquer momento sem aviso prévio.

---

## Publicar textos

Usando a rota https://{publication}.substack.com/api/v1/drafts você pode criar drafts, editá-los e, por fim, publicá-los. Isso requer autenticação e a montagem do texto em um formato muito específico para que seja aceito e renderizado corretamente pela plataforma.

De certa forma proibida pelos *Termos de Uso*, essa ação é sim possível de ser feita e existem alguns projetos que se propõem a fazer isso. Entre elas o [plugin para Obsidian](https://github.com/roomi-fields/obsidian-content-publisher) que citei no início, e esses repositórios, [substack-api](https://github.com/jakub-k-slys/substack-api) e [substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss), que fazem o mesmo para *Notes* com a rota [https://substack.com/api/v1/comment/feed](https://substack.com/api/v1/comment/feed).

---

## Conclusão

Caso queira se aprofundar pode começar pelo [repositório](https://github.com/DanielLourencoJr/SubstackInternalAPI) que fiz antes de ir para os outros que citei acima. Nem de longe é uma documentação completa, mas apenas um guia inicial.

Essa experiência de estudar a API de um sistema em produção, explorando todas as rotas que posso e entendendo os formatos de requisições foi bem interessante. Recomendo que todo desenvolvedor ou estudante da área faça isso com alguma plataforma que tenha interesse. No meu caso foi o Substack visto que já estava fazendo algumas ferramentas pessoais improvisadas. Decidi parar para documentar o que podia ser feito ou não antes de gastar muito tempo nos meus projetos sem saber quais as limitações do que é ou não possível.

Esse texto demorou mais tempo do que deveria para ser feito — devido ao fato de ser uma pesquisa feita por tentativa e erro concomitante à escrita — e o resultado final podia ter sido melhor, mas me forcei a publicá-lo como está pois é um assunto que acho interessante e queria compartilhar o que aprendi.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->
