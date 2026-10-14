---
title: Construí uma ferramenta para estudar inglês (de novo)
slug: construi-uma-ferramenta-para-estudar
audience: everyone
publication_id: 6465422
id: 197244824
---

Já falei algumas vezes sobre como uso o Anki para aumentar o meu vocabulário e reter da melhor forma possível no aprendizado de idiomas. Também já mostrei um [website](linguamap.daniellourenco.site) que fiz eu mesmo para me ajudar a encontrar e estudar novos textos em inglês, por exemplo.

Como a forma que estudo consiste em Imersão + Anki, idealmente queria eliminar a etapa intermediária de guardar o que aprendo da imersão no Anki.

# Antes

Antes eu estudava textos, usava extensões, dicionários, Google Translate e sites diversos para entender o conteúdo dos textos. Montava o card com a frase usando o termo que desconhecia, formatava e incluía definições ou traduções feitas por mim mesmo. Revisava os cards diariamente no Anki.

# LinguaMap

Para eliminar a etapa intermediária, o website mantêm um banco de dados com todo o meu vocabulário, as palavras que sei, que não sei, e que já vi poucas vezes. Bastava colocar um texto a ser estudado lá e ter o texto analisado. As palavras novas são contabilizadas, marcadas e destacadas. Após ler o texto completamente -- e idealmente o ter estudado e pesquisado o que não conhecer -- o sistema gera cards com frase original e tradução com formatação para o novo termo em um arquivo que facilita a exportação para o Anki com poucos cliques.

# Problemas

---

## Mapeamento

O LinguaMap, como diz o nome, tenta mapear idiomas inteiros dentro da sua cabeça. É muito ambicioso. Como resultado prático, ele não consegue uma imagem clara do que você sabe ou não sabe sem que você explicitamente marque palavra por palavra.

Isso parecia uma boa ideia, até que eu tive que manualmente clicar em milhares de palavras até que as marcações automáticas fossem uma boa representação do meu conhecimento. E mesmo depois disso, era normal ao estudar novos textos ter inúmeras palavras que conhecia, mas que o sistema não sabia ainda. O estudo acabava ficando massante comigo tendo que marcar infinitas palavras ao ponto de criar memória mecânica dos botões que realizam a ação.

## Integração com Anki

O sistema é, em essência, um programa rodando em um servidor web. Apesar de bem prático por não precisar de nenhuma instalação, só clicar em uma URL, também matou o principal objetivo de eliminar fricção com textos estudados e Anki.

O Anki é um programa rodando no seu computador ou celular. Com plugins como AnkiConnect é possível rodar um servidor HTTP em segundo plano de forma bem amigável para o usuário — ele nem percebe e é super leve. Tanto esse servidor como qualquer outro rodando localmente na máquina do usuário é potencialmente perigoso, podendo executar ações e acessar o sistema de arquivos. Por isso, existem restrições bem rígidas sobre requisições entre domínios diferentes. Ex: meu servidor -> seu servidor local são barradas por CORS.

Se esse não fosse o caso, eu poderia simplesmente adicionar flashcards no deck do usuário prontinhos para ele revisar depois. Por isso o máximo que conseguia fazer era gerar um arquivo de importação num formato que o Anki aceite. Isso por si só era chato e matava o propósito original, apesar de ainda ser mais útil do que fazer tudo na mão.

## Pipeline de estudo

Outra coisa que me incomodava bastante era o cold start: Eu tinha que virar uma chavinha no meu cérebro antes de usar o sistema.

> Agora eu vou estudar.

O procedimento era:

- Achar um texto em inglês
- Copiar para dentro do sistema
- Ler marcando o que já sabia
- Consultar o que não sabia no dicionário
- Exportar cards para o Anki

Se tem uma coisa que sei sobre procrastinação é que o maior problema para fazer qualquer tarefa é começar, mais que continuar.

Muitas vezes estava navegando por textos na Wikipédia, passando a vista em um manual ou documentação e achava um termo ou outro que seria interessante guardar. Seria totalmente ineficiente jogar uma frase ou um parágrafo no LinguaMap.

Mais do que uma plataforma fixa em um lugar, o que eu precisava era de um assistente pequeno, rápido que estivesse sempre ali do lado caso eu precisasse.

# SentenceMiner

---

Resolvi criar outra ferramenta para me ajudar com o mesmo problema, mas em outro formato que não estivesse preso pelas mesmas limitações que o LinguaMap. Ao invés de um website, seria um app Desktop que poderia se comunicar com o Anki sem problemas. Ele não tentaria mapear nada nem receberia textos inteiros.

Seu papel é ser uma versão enxuta e direta que:

- **lê o clipboard ou uma frase selecionada** pelo usuário em qualquer outro aplicativo
- **pede a palavra desconhecida** já que ele não sabe o que você conhece ou desconhece
- **gera uma tradução ou definição** como parte do card
- conecta e **envia o card** para o Anki

## Electron vs Tauri

Seria minha primeira vez fazendo um software desktop, pois só tinha trabalhado com scripts pequenos ou websites até agora. Como a ideia é ter esse programa sempre aberto no fundo, não seria bom que ele fosse demorado de abrir ou um peso para o sistema operacional. Tudo que sei das duas tecnologias é que o primeiro é lento e o segundo é rápido então não hesitei em escolher Tauri. O que ambos fazem é adaptar o desenvolvimento web com todas suas bibliotecas e linguagens para o mundo desktop.

Pelo que pesquisei Electron roda um Chromium que, apesar de relativamente leve, consome cada vez mais memória RAM, o que piora conforme você usa mais de um programa em Electron. Existem também as abordagens nativas GTK ou Qt, mas nem cogitei por parecerem extremamente complicadas.

## Desenvolvimento

Foi bastante rápido conseguir algo que funcionasse. Isso se você ignorar o dia inteiro que levei para aprender a compilar projetos na linguagem Rust no qual o Tauri se baseia. Descobri que projetos Rust consomem bastante memória, o que causou problemas que nunca tive que lidar com meu humilde Ubuntu com 50 GB de armazenamento.

Isso acontece por que ele compila todas as dependências e o projeto em si em um formato temporário e separado que facilita o *debug*, criando uma versão de desenvolvimento do app para testes. Apesar disso, na hora que você tem algo bom o suficiente, pode compilar em modo *release* que gera um binário bem leve.

![](https://substack-post-media.s3.amazonaws.com/public/images/51cfdd38-09ac-4379-89c9-93eac0f9106a_1440x900.png)

Foi mais ou menos nessa época que a OpenAI liberou o Codex para usuários *free*. Também foi quando comecei a abrir meus olhos para *Agent Coding* na prática. Torrei meu limite semanal 5 vezes em contas diferentes até chegar na primeira versão usável. Foi nesse meio tempo que eu experimentei outros CLIs como Codex e OpenCode. [Até escrevi um texto falando da minha experiência.](https://substack.com/@danielloureno1/p-195679007)

![](https://substack-post-media.s3.amazonaws.com/public/images/1c40874d-d383-4a92-babd-46b963b5bc3d_1440x900.png)

Esse é o resultado até agora. Em pouco tempo consegui essa ferramenta bastante útil para mim. No processo de fazer e manter um projeto de programação sozinho, estou aprendendo o motivo de ser de diversas técnicas de arquitetura e desenvolvimento de sistemas que me pareciam só preciosismo antes.

Outra coisa que aprendi criando E usando essa ferramenta é que o valor que você percebe está totalmente na usabilidade e nos pequenos detalhes, não de interface, mas uso real.

Você olha para essa tela cheia de campos e botões e acha que é difícil de operar. Pode ser, não nego, mas o fluxo principal é só selecionar o texto, usar uma tecla de atalho da sua preferência(estou atualmente trabalhando nisso, estou aprendendo coisas como X11 e Wayland, coisas de Linux) — de forma análoga a um **Ctrl+C** — escrever o termo desconhecido, **Enter** para gerar o verso e **Ctrl+Enter** para enviar pro Anki. Uso mínimo do mouse(só no começo), foco redireciona entre campos sozinho.

Esse tipo de coisa, junto com deixar o executável na Área de Trabalho, foi o principal facilitador que me compeliu a usar ele de forma intensiva por mais de um mês. É sério, fiquei tão animado que li e estudei dois livros inteiros **só como desculpa pra usar o programa.**

Também tem a função de OCR que lê imagens então o texto nem precisa ser selecionável. Isso é bem útil para alguns PDFs sem texto selecionável ou mal digitalizados.

O verso é gerado por IA, já que é a forma mais fácil, preguiçosa e cara de se fazer isso e eu sou um dev modinha vibe coder. No futuro pretendo fazer um fall back para dicionários offline e uma análise estatística para preencher o termo automaticamente com o termo mais raro.

Existem vários refinamentos e nem de longe é um produto pronto. Só funciona na minha máquina capenga com um Ubuntu 24.04.4. Mas estou tão animado que queria compartilhar esse "upgrade" ou evolução.

# Conclusão

---

Isso não é uma conclusão. É só os meus pensamentos sobre o texto em si. Eu acabei de escrever, você acabou de ler.

Sempre acho difícil escolher um projeto para desenvolver com o objetivo de aprender. Geralmente acabo indo pro lado de ferramentas que eu quero usar. Ferramentas pessoais são a melhor sugestão que eu posso te dar se quiser aprender. Isso vai te levar a cantos que você nem esperava, diferente de decidir por projetos "rentáveis" ou que estão na moda, com trocentos tutoriais explicando o processo de cabo a rabo. Fora a motivação extrínseca ao desenvolvimento em si. Você vai querer usar, não vai esquecer que aquilo existe, vai dar manutenção.

Pra mim esse é o caminho para se destacar e desenvolver a si próprio. Seguindo o seu caminho, não o caminho dos outros. Mantendo projetos de longa duração, mostrando que você é capaz de crescer um sistema com consistência e controle total do processo.

IAs dominaram código, não engenharia. Seja um engenheiro, não um codificador. Leve sistemas até os limites da IA, estique esse limite, brinque com esse limite. É mais difícil, mas se não fosse nem valeria a pena. Foi por isso que eu me apaixonei por computadores desde a infância.

Escute meu conselho. Siga-o sem garantia nenhuma que ele é a resposta certa para o maior dilema da TI e se divirta no processo :)
