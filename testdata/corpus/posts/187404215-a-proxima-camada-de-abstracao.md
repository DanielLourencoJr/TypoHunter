---
title: A Próxima Camada de Abstração
subtitle: Como LLMs são melhor compreendidas como compressão de conhecimento
slug: a-proxima-camada-de-abstracao
audience: everyone
publication_id: 6465422
id: 187404215
---

### Escrita 

A diferença entre os humanos do século 21 *depois* de Cristo e os do século 21 *antes* de Cristo não é biológica. A diferença mora no conhecimento acumulado pela raça humana.

Enquanto a tradição oral tinha um limite de tamanho e um tempo de vida útil antes de se perder na memória de uma comunidade pequena, a escrita permitiu que o conhecimento transcendesse o espaço, podendo ser levado a outros povos, e transcendesse o tempo, podendo resistir e ser preservado para as próximas gerações com muito mais eficácia.

### Conhecimento acumulado

Tecnologia atualmente é vista como dispositivos digitais como computadores, sensores e maquinário, mas a definição é algo bem mais abrangente: 

> técnica ou conjunto de técnicas de um domínio particular.

A invenção da **escrita** foi revolucionária e permitiu, inclusive, a construção de sociedades maiores e mais complexas graças ao registro de leis.

Posteriormente, com a criação da **imprensa** e o índice cada vez maior de **alfabetização**, a produção e consumo de textos aumentou exponencialmente nos últimos séculos.

Rapidamente esse corpo de conhecimento acumulado e descentralizado cresceu a um ponto onde seria impossível uma única pessoa conseguir ler e aprender todo o conhecimento e tecnologia produzido. Tentativas como a enciclopédia foram feitas, mas logo descontinuadas pela natureza impossível da tarefa: catalogar e **condensar** o conhecimento sobre **tudo**.

Foi quando nasceram os especialistas. O sentido de existirem especialistas se contrapõe ao generalista, muito mal visto nos dias de hoje.

> O pato nada, o pato anda, o pato voa. O pato não faz nada direito.

A conotação cada vez mais pejorativa do termo generalista mostra uma intuição verdadeira sobre a natureza do conhecimento. **É impossível que uma pessoa saiba tudo sobre tudo.** Por isso é necessário um especialista, alguém que escolhe propositalmente não perder tempo e focar em uma única área. Sendo assim capaz de chegar mais longe, fazer descobertas e desenvolver novas técnicas.

Houveram sim muitos casos na história de generalistas famosos por conseguirem resultados admiráveis desafiando todo o bom senso: os famosos **polímatas**. Leonardo Da Vinci e outros tantos se destacaram na história por fazerem avanços em várias áreas do conhecimento comparáveis aos avanços de especialistas habilidosos. Isso se deve, claro, à uma genialidade fora de série, mas também à tendência da época de separar menos os assuntos do que atualmente.

Coisas como a criação das universidades, revolução industrial, urbanização e globalização deram um novo salto que somado ao acúmulo natural do tempo fizeram esse corpo de conhecimento humano crescer ao ponto onde não era mais possível uma pessoa saber tudo sobre uma área sequer. Assim, especialistas tinham uma literatura muito vasta e precisavam se contentar em estudar e desenvolver uma sub-área dentro da sua área de estudo.

Lembro do meu professor de história no ensino médio explicando a lógica do ensino superior (ele estava terminando seu doutorado na época). 

> Imagine um grande círculo. Este é todo o conhecimento da humanidade. Veja esse círculo menor contido no maior. Essa é a história. Ela estuda os acontecimentos passados e os conecta em relações de causa e efeito. Eu me graduei em história e me especializei na história do Brasil (e desenhou mais um círculo menor dentro do segundo). Agora eu estou fazendo um doutorado, não sobre a história de Sobral (minha cidade), mas sobre como a história da cidade foi manipulada pelos políticos locais nos registros oficiais. Percebem como vai afunilando? (e desenhou um ponto no círculo mais interno)

Ele falava com orgulho como naquele ponto específico desenhado no quadro não havia ninguém mais competente do que ele. Um domínio simples, mas poderoso.

![](https://substack-post-media.s3.amazonaws.com/public/images/5649c6c4-f563-4f07-9009-ba07e1f40bca_1024x1024.png)

Outra boa analogia é a de círculos concêntricos. O desenvolvimento humano, o aprimoramento da tecnologia, é a adição de uma camada externa, com área maior. Imagine que  você deve estudar as camadas internas, subir até a camada externa para só então começar a construir a nova camada, seria desnecessário e ineficiente. Na prática, o que fazemos durante a vida inteira no ensino básico é estudar com inteligência o mínimo possível das camadas interiores. Somente o suficiente para podermos seguir em frente, às vezes com grande quantidade de abstrações.

![](https://substack-post-media.s3.amazonaws.com/public/images/87d32115-dd64-4da4-8b87-44f33957a052_1024x1024.png)

<!-- substack-cli-node:v1 eyJ0eXBlIjoiYnV0dG9uIiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJBc3NpbmUgYWdvcmEiLCJhY3Rpb24iOm51bGwsImNsYXNzIjpudWxsfX0 -->

### Camadas de abstração

Vamos pegar como exemplo um computador pessoal nos dias de hoje. Ele tem várias camadas de abstração que chamamos de Modelo OSI. São 7 camadas no total que são desenvolvidas **em paralelo**. 

A *Camada 1 - Física*: trata de **sinais**. Voltagem, luz, rádio, ruído, conectores, bits crus passando. É o mundo dos elétrons e fótons. O mundo real.

A *Camada 3 - Rede*: decide **por onde** os dados vão passar para chegar ao destino, mesmo atravessando várias redes diferentes. Roteadores operam aqui.

A *Camada 4 - Transporte*: cuida da confiabilidade. Ordem dos pacotes, retransmissão, controle de congestionamento, portas. TCP e UDP vivem aqui.

A *Camada 6 - Apresentação*: Aqui os dados ganham significado. Codificação, compressão, criptografia. UTF-8, JSON, TLS conceitualmente passam por aqui.

A *Camada 7 - Aplicação*: é a que você usa através de coisas como HTTP, FTP, SMTP, DNS, navegador, e-mail, APIs.

Eu, como programador, não preciso saber como o computador se comunica com outros pela rede nem como a rede em si funciona. Me basta saber que o computador se comunica e que essa conexão pode ser através de requests pontuais ou comunicação contínua com troca perpétua de informações.

Já os engenheiros que trabalham com a parte física não precisam saber como sites são feitos ou como games são programados para aprimorar a tecnologia de fibra óptica e eletromagnética que o computador usa para trocar informação com a rede.

E você não precisa saber de nada disso para usar um computador ou um celular para consumir conteúdo na camada de Aplicação.

*Camadas de Abstração* te permitem seguir em frente com zero conhecimento sobre como prédio que você subiu foi construído e com a impressão de que ele não vai cair de uma hora pra outra. Abstração é importante para que um aspirante a inovação consiga aprender o suficiente para criar nova tecnologia em cima do que já existe dentro do seu tempo de vida.

### Gênios

Pessoas geniais são aquelas com criatividade para aplicar o pouco conhecimento que elas tem no grande esquema das coisas para aplicar uma ideia inovadora, para criar uma técnica útil. Gênios são pessoas com habilidades incríveis de aprendizado que conseguem navegar por essas *Camadas de Abstração* e aprender o suficiente sobre elas para otimizar processos e unir técnicas aparentemente não relacionadas.

Enquanto criatividade não pode ser controlada, o número de coisas a serem aprendidas cresce a cada dia. 

### A próxima camada

A questão então se torna: como manter essa corrida? Como garantir que novos gênios continuem surgindo quando o volume de conhecimento necessário para chegar à “borda” do círculo só aumenta?

Temos basicamente duas opções. A primeira é continuar estreitando os domínios de expertise - transformar especialistas em hiper-especialistas, dividindo o conhecimento em pedaços cada vez menores até que alguém consiga dominar o suficiente para contribuir. Mas isso tem um limite prático: coordenar milhares de especialistas trabalhando em fragmentos microscópicos do conhecimento é lento, caro e ineficiente.

A segunda opção é criar uma nova camada de abstração. Assim como a escrita abstraiu a necessidade de estar fisicamente presente para transmitir conhecimento, precisamos de algo que abstraia o processo de consumir todo o conhecimento acumulado.

E se pudéssemos comprimir não apenas textos individuais, mas a essência de milhões deles? E se, em vez de passar anos lendo e conectando ideias dispersas em bibliotecas infinitas, você pudesse conversar com o conhecimento acumulado da humanidade e chegar direto ao que precisa para sua inovação específica?

### LLMs

A tradição oral permitia que conhecimento morresse. A escrita permite o crescimento teoricamente ilimitado do conhecimento, mas à custa de não ser completamente acessível para uma pessoa. E se os modelos de linguagem como ChatGPT, Grok, Gemini e Claude fossem a próxima tecnologia capaz de levar a produção de tecnologia a outro patamar?

*Large Language Models*(LLMs) são modelos treinados para repetir padrões dos textos usados no seu treinamento de forma probabilística. De forma prática LLMs podem ser pensados como arquivos ZIP, uma compressão de conteúdo e conhecimento de centenas ou milhares de *gigabytes* de informação condensada em poucos gigas. Mesmo na minha máquina modesta sem placa de vídeo, consigo rodar modelos de 3 ou 7 bilhões de parâmetros pesando entre 1 e 4 *gigabytes* capazes de conversar em múltiplas línguas, fazer raciocínios simples e até mesmo citar textos de cor, sem acesso a internet. 

Isso mesmo, a humanidade chegou a um ponto onde conseguiu ajustar **parâmetros** de um programa para reproduzir **textos já escritos** de uma forma comprimida para ocupar menos espaço ao custo de um comportamento não determinístico, mas probabilístico. Se você ler esse [paper da Meta](https://arxiv.org/pdf/2302.13971) você vai entender o quão conceitualmente profundo é substituir espaço de armazenamento por tempo e energia gasta no treinamento de forma a conseguir respostas tão precisas, quase como se os textos estivessem realmente ali, guardados. 

E mais importante do que ocupar menos espaço, isso permitiu a esse programa ligar essas ideias ao ser guiado por uma pessoa que sabe onde quer chegar.

Alguém com o mínimo conhecimento sobre uma área consegue usar da IA para pular etapas e construir coisas acima do próprio nível. IA não pode fazer isso sozinha, mas é uma ferramenta com potencial enorme para **acelerar o processo** de aprender o que a humanidade já construiu e impulsionar alguém direto para o *endgame*.

### Conclusão

Como alguém da TI, eu, mais do que você, estou cansado de gente falando merda sobre IA, mas não posso deixar de falar sobre isso pois é revolucionário, não ironicamente. 

Vejo muita gente usando IAs das formas mais estúpidas possíveis. Isso me lembra da imagem de índios pegando espadas pela primeira vez, não pelo cabo, mas pela lâmina. Maravilhados pelo brilho do metal, esquecemos da utilidade e do potencial do uso direcionado do equipamento.

Pelo menos eu acho essa uma discussão melhor do que entrar em debates sem fim sobre “Será que a IA vai criar consciência?” ou “Será que a IA vai ficar mais inteligente do que humanos?” e filosofia sem fim tentando definir o que é e o que não é inteligência.

Fato é, que desde o princípio tive a noção clara de que IA vai automatizar o conhecimento atual e deixar os humanos de verdade livres para criar coisas novas. 

Um especialista gasta 80% do seu tempo aprendendo o que já foi descoberto, -dominando sua área - e só 20% inovando/tentando criar coisas novas. A IA pode permitir que isso vire um 30/70, por exemplo. Em vez de passar anos subindo cada camada, você pode usar a IA como um atalho - pular direto para a borda externa onde o novo conhecimento é criado.

Isso inverte a lógica atual: ao invés de “IA vai roubar empregos/criatividade”, a IA pode libertar humanos do trabalho repetitivo de processar conhecimento antigo para focar no que realmente importa - inovação genuína.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->
