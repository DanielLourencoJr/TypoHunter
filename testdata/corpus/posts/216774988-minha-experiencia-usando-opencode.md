---
title: Minha experiência usando OpenCode - Parte 2
slug: minha-experiencia-usando-opencode
audience: everyone
publication_id: 6465422
id: 216774988
---

No texto anterior eu terminei exatamente onde todo bom projeto deveria começar: com um `git init`. Depois de quatro versões do bot, duas melhorias que não mudaram nada, uma refatoração que quebrou tudo em silêncio para 0% de vitórias e nenhum commit para voltar, eu tinha batido no limite do *MiniMax M2.5* e, para ser honesto, no meu próprio limite de desorganização.

> **Recap rápido:** *MiniMax M2.5* via *OpenCode* saiu do zero para um bot que já enxergava alguns lances à frente sem eu ler uma linha de código. Aí veio memória de posições (50 a 60% de vitórias, já decepcionante) e busca mais calma (50%, nada). Pedi uma refatoração só para limpar antes de versionar. Resultado: 0%. Ele entrou em loop tentando consertar sem saber o que tinha quebrado, apagou os torneios por cima e eu aprendi a lição número 1 do jeito mais burro possível.

De certa forma consegui o que queria: saber onde o modelo parava sem supervisão. Só que o bot também parou. A pergunta melhor era outra: e se eu recomeçasse do zero, com disciplina e outro modelo?

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->

Escolhi o *Muse Spark 1.2*. Mesmo *OpenCode*, mesma máquina capenga no HD, mesma ideia de bot de xadrez. A única diferença seria o modelo e começar com repositório desde o primeiro comando.

Desde que conheci o harness e usei o *MiniMax M2.5*, o provedor gratuito do *OpenCode* mudou. Apareceu o *DeepSeek V4 Flash* e depois o *Muse Spark 1.2*, que é o deste texto. O *1.3* já saiu, mas não entrou aqui.

# O recomeço que deveria ter sido o começo

O primeiro prompt da nova sessão foi literalmente:

> Crie o repositório git

Parece piada depois do texto anterior, mas é o ponto. O *Muse Spark* não discutiu. Fez `git init`, criou `.gitignore` e só então perguntou qual seria a estrutura.

Pedi a mesma coisa da primeira vez: um bot que fala o protocolo padrão do xadrez (UCI) e uma biblioteca que cuidasse das regras. Ele sugeriu uma lib em Go e isolou as regras num único lugar, um wrapper fino. Só esse arquivo conversa com a biblioteca de xadrez. O resto do projeto, engine, comunicação, Lichess, conversa com o wrapper.

> **Observação:** parece preciosismo, mas foi o que mais ajudou os agentes depois. Quando um modelo confunde um formato de lance com outro, quebra num lugar só, não em três. O *MiniMax* não tinha essa parede. Eu também não.

O resto já nasceu testável, com testes que rodam em segundos. Detalhe bobo, mas é o que deixa o modelo iterar sem eu ficar olhando por cima o tempo todo.

Em dez minutos eu tinha o que o *MiniMax* levou quase o artigo inteiro para fazer, só que com testes.

# O que não existia na Parte 1: Lichess e um teste que não mente

Na Parte 1 o bot só existia no meu terminal. Para saber se tinha melhorado eu compilava duas versões, rodava uma ferramenta em C cheia de flags, improvisava aberturas pegando cinco lances de partidas reais do Lichess e torcia para o número de vitórias significar algo. Quando o *MiniMax* quebrou, ainda apagou os resultados por cima. Não tinha como voltar nem como provar nada.

Na Parte 2 pedi duas coisas antes de mexer na força do bot.

1. Jogar no Lichess de verdade. O Lichess tem um modo BOT: você cria uma conta que nunca jogou, gera um token com permissão `bot:play` e converte a conta para BOT. A partir daí o bot escuta desafios e joga como qualquer usuário, só que via API.

Na primeira tentativa joguei `e4` e nada aconteceu. Ficamos uns vinte minutos até descobrir que o bot não sabia se era a vez dele. Quando funcionou, jogou uma partida inteira sozinho. Depois disso o agente criou comandos simples para ligar e desligar (`start`, `stop`, `logs`, `status`) e fez o bot se recuperar sozinho se reiniciar no meio de uma partida. Antes eu tinha uma engine. Agora tinha algo que dá para desafiar.

1. Um teste que não mente. Em vez de torneio gigante para medir quem ganha de quem, pedi algo mais direto: 50 posições onde já se sabe a resposta, dez mates em 1, dez em 2, até mate em 5. O bot recebe a posição, tem um segundo para achar o primeiro lance do mate e o teste confere se acertou. Roda com um comando e escreve um relatório em arquivo que não some se eu fechar o terminal. E é extensível: para adicionar mais puzzles é só colocar mais posições no arquivo.

O *MiniMax* dependia de base improvisada e comando que eu não lembrava de cabeça. Esse teste é reprodutível. É o que me impede de achar que melhorei quando na verdade não melhorei.

1. O resto veio porque a base já existia. Com Lichess e teste no lugar, o agente fez em minutos o que antes levaria horas: escreveu um manual curto para futuros agentes e fez o bot pensar no tempo do oponente, chutando o que vou jogar e já calculando a resposta para jogar instantâneo se acertar. Quando reclamei que demorava para parar, corrigiu para parar na hora. Quando pedi para explicar sem jargão, simplificou o texto sem simplificar o código. Isso é trabalho de agente.

Nada disso deixa o bot mais forte no tabuleiro. Deixa mais forte como software. E foi exatamente o que faltou na Parte 1.

# A parte que eu realmente queria testar

Eu não queria provar que IA escreve código. Eu já sabia disso. Queria saber se ela sustenta engenharia.

Por isso, com medida já na mão, pedi a mesma escada do texto anterior, uma coisa por vez:

1. Fazer o bot pensar camada por camada. Em vez de tentar ver tudo de uma vez até travar, ele aprofunda uma camada, guarda o melhor lance e só então tenta ir mais fundo. Assim sempre tem algo para jogar quando o tempo acaba. Mate em 1: 10/10. Geral: 15/50. Igual ao *MiniMax* na versão 2, só que agora entendendo o relógio do protocolo de verdade.
2. Fazer o bot usar o relógio de verdade. Eu reclamava que o torneio dava 1s por lance e o bot usava tempo fixo. Ele trocou para usar o tempo que realmente tem no relógio, considerando quanto falta e quanto ganha por lance. O *MiniMax* nunca chegou nessa conversa.
3. Fazer o bot lembrar posições e valorizar desenvolvimento. Em vez de recalcular tudo sempre, ele passou a guardar posições já avaliadas. E ganhou um empurrão para preferir lances que desenvolvem o jogo, não só que ganham material. O ganho foi parecido com o do *MiniMax*, mas dessa vez sabíamos por quê.
4. Fazer o bot não parar no meio de uma troca. Essa quebrou o *MiniMax*. É o efeito horizonte: parar a busca logo depois de capturar uma peça e achar que saiu no lucro, sem ver a recaptura. Dessa vez o bot só para quando a posição acalma, estendendo capturas e xeques. Pouco ganho, mate em 2 foi de 1/10 para 2/10, mas honesto. E sem quebrar o resto.

Até aqui nada espetacular. Os números são até parecidos. A diferença não estava no que ele fazia, mas em como fazia.

# Comparando os dois modelos

- Arranque: o *MiniMax* foi rápido e impressionante, zero leitura de código minha. O *Muse Spark* foi rápido também, mas já criando manual, testes e separação de regras.
- Escada técnica: o *MiniMax* fez tudo na ordem que pedi. O *Muse Spark* fez a mesma escada, mas cada passo com teste e commit.
- Quando não melhora: o *MiniMax* insiste que melhorou e apaga o teste anterior. O *Muse Spark* mostra o relatório e deixa o arquivo para eu ver que não melhorou.
- Quando quebra: o *MiniMax* quebra em silêncio, 0% vitórias, loop sem diagnóstico, sem volta. O *Muse Spark* não quebrou em silêncio porque o teste rodava antes de cada passo.
- Resultado: o *MiniMax* entregou só engine. O *Muse Spark* entregou engine com Lichess, scripts para ligar e desligar e suite de 50 puzzles.
- Postura: o *MiniMax* é convicto e nada confiável (lição 3 do texto anterior). O *Muse Spark* é convicto também, é LLM, mas com mais disciplina para provar que funciona.

O *MiniMax* foi ótimo para validar a ferramenta. Em três prompts eu tinha um bot aleatório jogando. Para uso casual, ele entrega. O problema é a segunda metade do trabalho: manter, medir, não regredir. Ali ele me deixou na mão e eu ajudei, por ser desorganizado.

O *Muse Spark* também erra. A diferença é que erra dentro de um andaime que ele mesmo ajuda a construir: testes, relatório em arquivo e um manual curto dizendo o que não fazer.

# A linguagem ajudou os agentes ou só não atrapalhou?

Essa era a pergunta que eu mais queria responder. E a resposta é que ajudou, mas não pelo motivo que eu esperava.

Escolhi *Go* sem pensar muito. Poderia ter sido Python ou Rust. Hoje vejo que *Go* ajudou os agentes por três motivos bem práticos:

1. Go é chato, e isso é bom para agentes. Tipagem estática, erro sempre explícito, nada de mágica escondida. O modelo não tem onde se esconder. Se inventa um campo com tipo errado, o verificador quebra na hora. Em Python isso passaria silencioso e viraria bug às duas da manhã no Lichess. Em Go quebrou cedo e fez barulho.
2. Separar as regras foi mais importante que a linguagem. Isolar a biblioteca de xadrez num único arquivo fez o erro virar erro de compilação, não derrota na partida. E clonar o tabuleiro de forma explícita evita o bug clássico de mexer no tabuleiro imaginário e sujar o real sem querer, que provavelmente quebrou minha refatoração no *MiniMax*.
3. Ferramental rápido. Teste e verificação em Go são tão rápidos que o agente pode rodar a cada passo. No meu setup isso quase quebrou: meu HD é NTFS e `go build` travava mais de dez segundos por causa do controle de versão. O agente percebeu a lentidão, descobriu que o HD era o gargalo e passou a compilar para a pasta temporária na RAM (`/tmp` em `tmpfs`). Parece detalhe de infra, mas sem isso o loop de escreve, testa, corrige ficava parado a cada iteração, inviável para agentes.

Onde Go não ajudou: verbosidade. Tudo precisa de controle de cancelamento e prazo espalhado no código. Para humano tudo bem, para LLM é mais texto e mais chance de esquecer algo. E Go não salva lógica ruim: a suite de mate hoje é 16/50 (32%). Mate em 1 é 100%, mate em 4 é 0%. O bot ainda não calcula. Linguagem nenhuma resolve isso, só algoritmo melhor.

No fim, *Go* não deixou o bot mais forte no tabuleiro. Deixou mais fácil de manter. E para agentes, isso vale mais.

# O que ainda dói

O relatório atual:

```
Mate em 1: 10/10 (100.0%)
Mate em 2: 2/10 (20.0%)
Mate em 3: 2/10 (20.0%)
Mate em 4: 0/10 (0.0%)
Mate em 5: 2/10 (20.0%)
Geral: 16/50 (32.0%)
```

É humilhante. Um bot que não vê mate em 4 não é bot, é entusiasta. Mas é um número honesto. Sei exatamente onde melhorar, e sei que não regredi, porque o teste existe.

O *MiniMax* me deu 84% de vitórias contra aleatório e achei que estava voando. O *Muse Spark* me deu 32% numa suite que eu mesmo pedi e sei que estou no chão. Prefiro o chão com mapa.

# Lições atualizadas

As quatro do texto anterior continuam:

1. **Nenhum projeto é tão pequeno que não mereça um repositório local.**
2. **Não se atreva a fazer uma grande mudança antes de marcos importantes.**
3. **Modelos de linguagem são convictos e nada confiáveis.**
4. **Não aceite alterações que não entende.**

Adicionaria mais duas, aprendidas na segunda volta:

1. **Crie o andaime antes da feature.** Manual, teste e script não são perfumaria. São o que permitem o modelo errar sem te levar junto.
2. **Meça com arquivo, não com memória.** Torneio que escreve por cima do anterior não é métrica, é anedota. Relatório em arquivo vale mais que número bonito no terminal que você fechou.

No fim, não sei dizer quanto do mérito é do *OpenCode* e quanto é do *Muse Spark 1.2*. Sei que o *OpenCode* me deu a interface que elogiei no primeiro texto, melhor que *Codex* e *Gemini CLI*, e o *Muse Spark* me deu a disciplina que faltou na primeira sessão. O *MiniMax M2.5* me mostrou o teto da ferramenta sem supervisão. O *Muse Spark* me mostrou o piso de um projeto que consigo manter.

E sobre o bot: ainda não é forte. Mas agora joga no Lichess, responde no protocolo padrão e diz com franqueza quando não vê mate. É um começo que não preciso jogar fora.

Como disse no texto anterior: *IAs dominaram código, não engenharia.* Continuo achando isso. Só que agora tenho um manual para provar.

---

*Próximos passos continuam: testar em projetos maiores e com outros modelos. Só que agora com histórico e teste para não ter que confiar na minha memória.*

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->
