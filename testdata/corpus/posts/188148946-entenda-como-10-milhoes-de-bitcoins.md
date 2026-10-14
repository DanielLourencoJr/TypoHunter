---
title: Entenda como 10 milhões de bitcoins não têm dono
subtitle: E como o SegWit causou isso
slug: entenda-como-10-milhoes-de-bitcoins
audience: everyone
publication_id: 6465422
id: 188148946
---

### Introdução

Se você roda um full node de Bitcoin e ao mesmo tempo mora numa caverna, no dia 24 de Agosto de 2017 você viu algo **sem precedentes** acontecendo na blockchain: transações sem endereço definido. Semelhantes àquelas feitas para scripts e smart contracts, mas um tipo específico que podia ser realizado por **literalmente qualquer pessoa**.

Sim, você leu corretamente: **Qualquer um poderia gastar aqueles bitcoins**. Mas claro que a história não é tão simples assim.

### SegWit

O que acontece é que à época estava sendo lançado uma alteração no Bitcoin: o *SegWit*.

*SegWit*, uma abreviação para **Segregated Witness**, é um conjunto de BIPs que reorganiza a estrutura dos blocos, separando as assinaturas (witness) das transações base. Isso permite que os dados de assinatura “contem menos” para o limite de 1 MB, aumentando a capacidade efetiva dos blocos.

Outra vantagem crucial foi **resolver a maleabilidade de transações** — permitindo que o ID da transação (txid) não pudesse mais ser alterado. Isso abriu caminho para protocolos de segunda camada como a **Lightning Network**. Pretendo escrever sobre isso no futuro.

### Soft Fork vs Hard Fork

Por se tratar de uma mudança nas regras de consenso, isso necessariamente gera um fork, uma divisão na rede entre **nós que adotam** a mudança e **nós que não adotam**.

*Hard Forks* são divisões brutas da rede, onde cada lado aceita e trabalha em cima de uma *blockchain* diferente.

*Soft Forks* são divisões onde as regras de um dos lados se torna **mais restritiva**, mas ainda dentro do que os dois lados aceitam. Assim, a *blockchain* não se divide.

### Retrocompatibilidade

O resultado disso é uma atualização retrocompatível. Todos os blocos aceitos pelos novos nós, são aceitos pelos antigos. Mas **nem todos** os blocos aceitos pelos nós antigos são aceitos pelos novos.

> Regras antigas: “X é válido se condições A, B e C”
> 
> Soft fork: “X é válido se condições A, B, C e também D”

Como nós antigos continuam podendo usar a rede, *Soft Forks* são preferíveis.

Para ser um *soft fork* (compatível com versões anteriores), o *SegWit* precisava que:

- Nós antigos aceitassem blocos com transações *SegWit*
- Nós novos aplicassem regras extras de validação
- Não causasse fork da blockchain

### Detalhando o SegWit

Enquanto novos nós olham no novo campo *witness*:

```
witness: <assinatura> <pubKey>
```

Nós antigos continuam olhando nos campos antigos:

```
scriptPubKey: OP_0 <hash qualquer de 20 ou 32 bytes>
scriptSig: [vazio]
```

Onde

- `scriptPubKey`: define CONDIÇÕES para gastar

- `scriptSig`: fornece DADOS para satisfazer as condições

Ao receberem esses valores ao invés de um script de verdade, qualquer um pode satisfazer as condições para gastar os fundos daquela transação.

Exemplo comum de valores válidos:

```
scriptSig: <assinatura> <pubKey>
scriptPubKey: OP_DUP OP_HASH160 <hash160(pubKey)> OP_EQUALVERIFY OP_CHECKSIG
```

Em outras palavras, para resumir:

> *SegWit* não usa o campo designado para dizer quem tem controle sobre o output(UTXO) criado naquela transação, então nós que não entendem *SegWit* pensam que aquele output pode ser gasto por qualquer um.

> Nós que entendem *SegWit* fazem a verificação do campo `witness` e rejeitam transações que não atendam as condições específicas do *SegWit*(diferente do `scriptPubKey`).

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJQYXJhIHJlY2ViZXIgdGV4dG9zIHBhcmVjaWRvcywgYXNzaW5lIGdyYXR1aXRhbWVudGUuIn1dfV19 -->

### Vantagem real do SegWit

Pelo que eu disse até aqui parece que o *SegWit* meramente move as assinaturas das transações para outro lugar no bloco. Que vantagem real ele traz? E qual a relação disso com o título do texto? 

Antes as assinaturas estavam unidas de forma inseparável às transações, e por isso entravam no limite máximo de 1 MB que os blocos têm. Com *SegWit*, a parte principal do bloco fica preenchida de forma contígua somente por dados das transações, enquanto os *witness* ficam segregados em uma parte separada.

```
┌─────────────────────────────────────┐
│ Block Header (80 bytes)             │
├─────────────────────────────────────┤
│ Transaction Count                   │
├─────────────────────────────────────┤
│ TRANSAÇÕES (parte principal)        │ ← Contíguas, SEM witness
│   TX1: version, inputs, outputs...  │
│   TX2: version, inputs, outputs...  │
│   TX3: version, inputs, outputs...  │
│   ...                               │
├─────────────────────────────────────┤
│ WITNESS DATA (separado)             │ ← Todos os witness juntos
│   Witness para TX1                  │
│   Witness para TX2                  │
│   Witness para TX3                  │
│   ...                               │
└─────────────────────────────────────┘
```

Em essência, *witness* contém as assinaturas e condições de gasto — o mesmo conteúdo que antes ficava embutido na transação, mas agora em local separado.

Aqui está o pulo do gato: **o **<!-- substack-cli-inline:v1 eyJ0eXBlIjoidGV4dCIsInRleHQiOiJTZWdXaXQiLCJtYXJrcyI6W3sidHlwZSI6InN0cm9uZyJ9LHsidHlwZSI6ImVtIn1dfQ -->** redefiniu o que conta como “tamanho do bloco”**.

Antes, a regra era simples: “bloco não pode ter mais de 1 MB de dados, ponto final”. Isso limitava quantas transações cabiam, já que cerca de 60% de cada transação era ocupado pela assinatura.

O *SegWit* mudou a regra para: “bloco não pode exceder um certo **peso**, onde dados da transação base pesam 4x mais que dados witness”. Isso significa que assinaturas agora “contam menos” para o limite — é como se você pudesse colocar mais coisas numa mala porque roupas agora “pesam menos” que antes, mesmo ocupando o mesmo espaço físico.

O resultado? Blocos podem ter ~1.8-2.2 MB de dados reais (transações + assinaturas), mas para fins da regra de consenso ainda “cabem” dentro do limite.

Para nós antigos, nada mudou — eles só veem a parte base (~1 MB) e pensam “tudo normal, dentro do limite”. Nós novos veem o bloco completo (1.8-2.2 MB) mas aplicam as novas regras de peso que tornam isso válido.

**Em resumo: **<!-- substack-cli-inline:v1 eyJ0eXBlIjoidGV4dCIsInRleHQiOiJTZWdXaXQiLCJtYXJrcyI6W3sidHlwZSI6InN0cm9uZyJ9LHsidHlwZSI6ImVtIn1dfQ -->** não economizou espaço de armazenamento — ele trapaceou no sistema de medição para permitir blocos maiores sem fazer hard fork.**

### Por que isso não quebra nada?

Nós antigos continuam vendo apenas a parte base das transações (sem witness), que fica abaixo de 1 MB — respeitando o limite antigo. Eles literalmente não enxergam os dados witness que foram adicionados. Ou seja, o limite de tamanho do bloco continua sendo respeitado retroativamente.

Por outro lado, *witness* é um campo importante que nós novos se importam. O que garante que as regras *SegWit* estão sendo respeitadas se nós antigos não fazem ideia sobre essas regras e não as usam para fazer sua validação?

Quem faz essa verificação são os mineradores que são nós novos por uma maioria quase unânime.

### Adoção do SegWit (Mineradores)

Como já expliquei em um [texto anterior](https://danielloureno1.substack.com/p/bitcoin-nao-e-dinheiro) o Bitcoin é um protocolo de consenso onde mudanças podem ser feitas desde que seja o consenso da rede. O BIP 9 definia um critério claro para organizar essa mudança repentina gerando o menor caos possível. 

O BIP 9 dizia que os mineradores poderiam adicionar uma informação extra nos seus blocos de forma padronizada para sinalizar apoio. Caso num período de 2016 blocos seguidos 1916 blocos sinalizassem apoio, em mais 2016 blocos todos deveriam começar a usar as novas regras. Ou seja, se no período de duas semanas pelo menos 95% dos mineradores apoiassem as novas regras, em mais duas semanas eles poderiam usá-las.

De Novembro de 2016 até Maio de 2017 a sinalização dos mineradores apoiando *SegWit* ficou girando em torno de 30% sem sinal de aumentar. Muita coisa aconteceu nesse período entre Maio e Agosto de 2017 que tornam o *SegWit* a maior mudança no Bitcoin e a mais turbulenta.

Em 24 Maio 2017, o BIP 148 (UASF - User Activated Soft Fork) definiu que os nós que o adotassem iriam rejeitar blocos de mineradores que não sinalizassem apoio ao *SegWit* a partir de 1 de Agosto de 2017. Isso causaria um **Hard Fork!!**

Em 14 de Junho, o BIP 91 teve seu código finalizado. Ele servia como um passo intermediário na busca do consenso, definia regras mais brandas para ativação do *SegWit*: Somente 80% de sinalização num período de 336 blocos (2-3 dias).

Em 19 de Julho os 80% de sinalização do BIP 91 são atingidos evitando o fork do UASF, que aconteceria em menos de duas semanas.

Entre 23 e 24 de Agosto a rede atinge 100% de sinalização para *SegWit*.

Toda essa luta era necessária por um motivo. Em um *Soft Fork* os nós antigos perdem a capacidade de validar plenamente as transações seguindo o padrão *SegWit* pelos motivos já discutidos. Mas com a grande maioria dos mineradores fazendo essa validação, esse problema é mitigado. Sem falar que os nós antigos que não adotaram *SegWit* na main-net são uma raça em extinção.

Vale mencionar que em 1 de Agosto de 2017, antes mesmo do *SegWit* ativar, uma facção contrária à mudança executou um **hard fork** criando o Bitcoin Cash (BCH) — uma blockchain separada que rejeitou o *SegWit* e aumentou o tamanho dos blocos para 8 MB.

### Conclusão

Então se você é um nó desatualizado e usa uma versão anterior ao *Bitcoin Core 0.13.1*, lançado em 15 de outubro de 2016, você começou a ver bitcoins grátis sendo distribuídos pela rede e transações tentando usar esses bitcoins sendo recusadas por não ter um certo campo *witness* que você não faz ideia de pra que serve. Isso se deve aos mineradores que em sua totalidade aderiram ao *SegWit* e fazem a correta validação de todas as transações segundo as novas regras.

Nós antigos ainda podem usar a rede, fazer transações e receber pagamentos normalmente, apesar de usar um modelo de transação antigo que deixou de ser competitivo com os novos modelos, que pagam menos taxas pela sua otimização.

Respondendo ao título: Eles têm dono, mas nós antigos não sabem disso. Eles são UTXOs que foram criados por transações usando *SegWit*. 

Foi uma boa oportunidade para explorar como o *SegWit* mudou a forma como o Bitcoin funciona. E ainda deu pra falar sobre a história do Bitcoin e dar uma ideia de como funciona BIPs e alterações das [regras de consenso](https://danielloureno1.substack.com/p/bitcoin-nao-e-dinheiro).

As discussões sobre *SegWit* se iniciaram em 2015 e se concretizaram totalmente em 2017, mas a adoção pelas pessoas não foi tão imediata como pode ver pela tabela a seguir mostrando a quantidade de transações feitas com *SegWit* e o número de nós reconhecendo e propagando transações *SegWit*.

```
Data          | % TXs SegWit | % Nodes
--------------|--------------|----------
Ago 2017      | ~10%         | ~60%
Set 2017      | ~12%         | ~65%
Dez 2017      | ~14%         | ~70%
Mar 2018      | ~30%         | ~75%
Dez 2018      | ~40%         | ~80%
2019          | ~50%         | ~85%
2020          | ~60%         | ~90%
2021          | ~70%         | ~92%
2024          | ~85%         | ~95%
```

Mudanças no protocolo são possíveis, mas muito difíceis de serem feitas. Elas exigem a aceitação de quase toda a rede. Bitcoin pode mudar, mas resiste a isso. Acho isso perfeito pois gera a previsibilidade que ele vai continuar com as características que desejamos e amamos enquanto pode se adaptar contra possíveis inimigos como computação quântica ou qualquer outra coisa quem ainda nem imaginamos.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJPYnJpZ2FkbyBwb3IgbGVyISBBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->



Se gostou desse texto, leia outros na mesma pegada:

<!-- substack-cli-node:v1 eyJ0eXBlIjoiZGlnZXN0UG9zdEVtYmVkIiwiYXR0cnMiOnsibm9kZUlkIjoiYmEzZGE0MWUtOGYwNi00OWU4LTg2ZGQtY2U0MzEzMzllOTAzIiwiY2FwdGlvbiI6IkVzdG91IHRlcm1pbmFuZG8gdW1hIGRpc2NpcGxpbmEgZGUgZXN0YXTDrXN0aWNhIHF1ZSBtZSBkw6EgZmVycmFtZW50YXMgcGFyYSBhbmFsaXNhciBwcm9iYWJpbGlkYWRlcyBhc3NvY2lhZGFzIMOgIHZhcmnDoXZlaXMgYWxlYXTDs3JpYXMgY29tIGNlcnRvcyB0aXBvcyBkZSBkaXN0cmlidWnDp8O1ZXMuIE5lc3NlIHRleHRvIHF1ZXJvIGFwbGljYXIgZXNzZSBjb25oZWNpbWVudG8gZW0gdW0gZXhlbXBsbyBkbyBtdW5kbyByZWFsIHBhcmEgc29saWRpZmljYXIgbyBtZXUgYXByZW5kaXphZG8gZSB0cmFiYWxoYXIgZW0gdW0gdGVtYSBxdWUgYWNobyBpbnRlcmVzc2FudGUuIiwiY3RhIjoiUmVhZCBmdWxsIHN0b3J5Iiwic2hvd0J5bGluZXMiOnRydWUsInNpemUiOiJsZyIsImlzRWRpdG9yTm9kZSI6dHJ1ZSwidGl0bGUiOiJNYXRlbcOhdGljYSBwb3IgdHLDoXMgZG8gQXRhcXVlIGRlIDUxJSIsInB1Ymxpc2hlZEJ5bGluZXMiOlt7ImlkIjozOTk2MTQ5MTMsIm5hbWUiOiJEYW5pZWwgTG91cmVuw6dvIiwiYmlvIjoiRXUgc291IGFxdWVsZSBtb2xlcXVlIGRhIHR1cm1hIHF1ZSBlc3RyYW5oYW1lbnRlIGZhbGEgYmFzdGFudGUgcXVhbmRvIHZvY8OqIGludGVyYWdlLiBCYXNpY2FtZW50ZSB1bSBOUEMuICIsInBob3RvX3VybCI6Imh0dHBzOi8vc3Vic3RhY2stcG9zdC1tZWRpYS5zMy5hbWF6b25hd3MuY29tL3B1YmxpYy9pbWFnZXMvMjYxZGQ3MDAtZWExMC00MTQ1LWFhNzgtNjUzM2RjMjNmMGU4XzM5NXg2MTMuanBlZyIsImlzX2d1ZXN0IjpmYWxzZSwiYmVzdHNlbGxlcl90aWVyIjpudWxsfV0sInBvc3RfZGF0ZSI6IjIwMjYtMDEtMjBUMTE6MzQ6NDMuNjczWiIsImNvdmVyX2ltYWdlIjoiaHR0cHM6Ly9zdWJzdGFjay1wb3N0LW1lZGlhLnMzLmFtYXpvbmF3cy5jb20vcHVibGljL2ltYWdlcy82MmMxNjI4MC1lYzAyLTRiMzEtYWIwZi1hYmJkMWFiMjIxZmVfOTU2eDU4Ni5wbmciLCJjb3Zlcl9pbWFnZV9hbHQiOm51bGwsImNhbm9uaWNhbF91cmwiOiJodHRwczovL3N1YnN0YWNrLmNvbS9ob21lL3Bvc3QvcC0xODUxMjI2MDgiLCJzZWN0aW9uX25hbWUiOm51bGwsInZpZGVvX3VwbG9hZF9pZCI6bnVsbCwiaWQiOjE4NTEyMjYwOCwidHlwZSI6Im5ld3NsZXR0ZXIiLCJyZWFjdGlvbl9jb3VudCI6MywiY29tbWVudF9jb3VudCI6MSwicHVibGljYXRpb25faWQiOjY0NjU0MjIsInB1YmxpY2F0aW9uX25hbWUiOiJEYW5pZWwgTG91cmVuw6dvIiwicHVibGljYXRpb25fbG9nb191cmwiOiJodHRwczovL3N1YnN0YWNrY2RuLmNvbS9pbWFnZS9mZXRjaC8kc18hUjlWbyEsZl9hdXRvLHFfYXV0bzpnb29kLGZsX3Byb2dyZXNzaXZlOnN0ZWVwL2h0dHBzJTNBJTJGJTJGc3Vic3RhY2stcG9zdC1tZWRpYS5zMy5hbWF6b25hd3MuY29tJTJGcHVibGljJTJGaW1hZ2VzJTJGMjYxZGQ3MDAtZWExMC00MTQ1LWFhNzgtNjUzM2RjMjNmMGU4XzM5NXg2MTMuanBlZyIsImJlbG93VGhlRm9sZCI6ZmFsc2UsInlvdXR1YmVfdXJsIjpudWxsLCJzaG93X2xpbmtzIjpudWxsLCJmZWVkX3VybCI6bnVsbH19 -->

<!-- substack-cli-node:v1 eyJ0eXBlIjoiZGlnZXN0UG9zdEVtYmVkIiwiYXR0cnMiOnsibm9kZUlkIjoiNjdkODJmNzgtMjk1ZS00OGUwLWI5ZjEtMjdlNzEzZDliMzM3IiwiY2FwdGlvbiI6IkNoYXZlcyBQw7pibGljYXMgZSBQcml2YWRhcyBzw6NvIG8gY29yYcOnw6NvIGRvIEJpdGNvaW4uIEJpdGNvaW5zIHPDo28gcHJvcHJpZWRhZGVzIGRlIENoYXZlcyBQw7pibGljYXMsIHF1ZSBleGVyY2VtIGVzc2EgcHJvcHJpZWRhZGUgYXNzaW5hbmRvIHRyYW5zYcOnw7VlcyBwYXJhIG91dHJhcyBjaGF2ZXMuIEVzc2FzIGFzc2luYXR1cmFzLCBwb3Igc3VhIHZleiwgZGVwZW5kZW0gZGEgQ2hhdmUgUHJpdmFkYS4iLCJjdGEiOiJSZWFkIGZ1bGwgc3RvcnkiLCJzaG93QnlsaW5lcyI6dHJ1ZSwic2l6ZSI6ImxnIiwiaXNFZGl0b3JOb2RlIjp0cnVlLCJ0aXRsZSI6IkNyaXB0b2dyYWZpYSBkZSBDdXJ2YSBFbMOtcHRpY2EiLCJwdWJsaXNoZWRCeWxpbmVzIjpbeyJpZCI6Mzk5NjE0OTEzLCJuYW1lIjoiRGFuaWVsIExvdXJlbsOnbyIsImJpbyI6IkV1IHNvdSBhcXVlbGUgbW9sZXF1ZSBkYSB0dXJtYSBxdWUgZXN0cmFuaGFtZW50ZSBmYWxhIGJhc3RhbnRlIHF1YW5kbyB2b2PDqiBpbnRlcmFnZS4gQmFzaWNhbWVudGUgdW0gTlBDLiAiLCJwaG90b191cmwiOiJodHRwczovL3N1YnN0YWNrLXBvc3QtbWVkaWEuczMuYW1hem9uYXdzLmNvbS9wdWJsaWMvaW1hZ2VzLzI2MWRkNzAwLWVhMTAtNDE0NS1hYTc4LTY1MzNkYzIzZjBlOF8zOTV4NjEzLmpwZWciLCJpc19ndWVzdCI6ZmFsc2UsImJlc3RzZWxsZXJfdGllciI6bnVsbH1dLCJwb3N0X2RhdGUiOiIyMDI2LTAxLTI2VDIwOjA5OjAzLjI4MFoiLCJjb3Zlcl9pbWFnZSI6Imh0dHBzOi8vc3Vic3RhY2stcG9zdC1tZWRpYS5zMy5hbWF6b25hd3MuY29tL3B1YmxpYy9pbWFnZXMvODM1Zjc5ZmEtZWI1ZS00N2ZiLWIyZDMtYzA0ZjI2NWU1NGM0XzEwMjR4ODY4LnBuZyIsImNvdmVyX2ltYWdlX2FsdCI6bnVsbCwiY2Fub25pY2FsX3VybCI6Imh0dHBzOi8vc3Vic3RhY2suY29tL2hvbWUvcG9zdC9wLTE4NTg3OTg4MCIsInNlY3Rpb25fbmFtZSI6bnVsbCwidmlkZW9fdXBsb2FkX2lkIjpudWxsLCJpZCI6MTg1ODc5ODgwLCJ0eXBlIjoibmV3c2xldHRlciIsInJlYWN0aW9uX2NvdW50IjowLCJjb21tZW50X2NvdW50IjowLCJwdWJsaWNhdGlvbl9pZCI6NjQ2NTQyMiwicHVibGljYXRpb25fbmFtZSI6IkRhbmllbCBMb3VyZW7Dp28iLCJwdWJsaWNhdGlvbl9sb2dvX3VybCI6Imh0dHBzOi8vc3Vic3RhY2tjZG4uY29tL2ltYWdlL2ZldGNoLyRzXyFSOVZvISxmX2F1dG8scV9hdXRvOmdvb2QsZmxfcHJvZ3Jlc3NpdmU6c3RlZXAvaHR0cHMlM0ElMkYlMkZzdWJzdGFjay1wb3N0LW1lZGlhLnMzLmFtYXpvbmF3cy5jb20lMkZwdWJsaWMlMkZpbWFnZXMlMkYyNjFkZDcwMC1lYTEwLTQxNDUtYWE3OC02NTMzZGMyM2YwZThfMzk1eDYxMy5qcGVnIiwiYmVsb3dUaGVGb2xkIjpmYWxzZSwieW91dHViZV91cmwiOm51bGwsInNob3dfbGlua3MiOm51bGwsImZlZWRfdXJsIjpudWxsfX0 -->

<!-- substack-cli-node:v1 eyJ0eXBlIjoiZGlnZXN0UG9zdEVtYmVkIiwiYXR0cnMiOnsibm9kZUlkIjoiNzJjMmIxMzAtNzQ1Mi00ODY0LWE3MmMtNWRmNjg1ZTk1YWRlIiwiY2FwdGlvbiI6Ik8gQml0Y29pbiBuw6NvIMOpIHVtYSBkaW5oZWlybyBlbGV0csO0bmljbyBwb250byBhIHBvbnRvLiDDiSB1bSBwcm90b2NvbG8gcXVlIGJ1c2NhIGNvbnNlbnNvIHBvaXMgcXVlciBmdWdpciBkbyBhdXRvcml0YXJpc21vIGRlIHF1YWxxdWVyIGluc3RpdHVpw6fDo28uIEUgaXNzbyB0ZW0gdW0gcHJlw6dvLiIsImN0YSI6IlJlYWQgZnVsbCBzdG9yeSIsInNob3dCeWxpbmVzIjp0cnVlLCJzaXplIjoibGciLCJpc0VkaXRvck5vZGUiOnRydWUsInRpdGxlIjoiQml0Y29pbiBuw6NvIMOpIGRpbmhlaXJvIiwicHVibGlzaGVkQnlsaW5lcyI6W3siaWQiOjM5OTYxNDkxMywibmFtZSI6IkRhbmllbCBMb3VyZW7Dp28iLCJiaW8iOiJFdSBzb3UgYXF1ZWxlIG1vbGVxdWUgZGEgdHVybWEgcXVlIGVzdHJhbmhhbWVudGUgZmFsYSBiYXN0YW50ZSBxdWFuZG8gdm9jw6ogaW50ZXJhZ2UuIEJhc2ljYW1lbnRlIHVtIE5QQy4gIiwicGhvdG9fdXJsIjoiaHR0cHM6Ly9zdWJzdGFjay1wb3N0LW1lZGlhLnMzLmFtYXpvbmF3cy5jb20vcHVibGljL2ltYWdlcy8yNjFkZDcwMC1lYTEwLTQxNDUtYWE3OC02NTMzZGMyM2YwZThfMzk1eDYxMy5qcGVnIiwiaXNfZ3Vlc3QiOmZhbHNlLCJiZXN0c2VsbGVyX3RpZXIiOm51bGx9XSwicG9zdF9kYXRlIjoiMjAyNi0wMS0xMlQyMToyNzo1OC4zNTVaIiwiY292ZXJfaW1hZ2UiOiJodHRwczovL3N1YnN0YWNrLXBvc3QtbWVkaWEuczMuYW1hem9uYXdzLmNvbS9wdWJsaWMvaW1hZ2VzL2MzNWMwMTY3LTdjNDQtNGIxNy05MzczLWMzNGJjYWZjYzA0N18xMDI0eDE1MzYucG5nIiwiY292ZXJfaW1hZ2VfYWx0IjpudWxsLCJjYW5vbmljYWxfdXJsIjoiaHR0cHM6Ly9zdWJzdGFjay5jb20vaG9tZS9wb3N0L3AtMTg0MzY0NjUxIiwic2VjdGlvbl9uYW1lIjpudWxsLCJ2aWRlb191cGxvYWRfaWQiOm51bGwsImlkIjoxODQzNjQ2NTEsInR5cGUiOiJuZXdzbGV0dGVyIiwicmVhY3Rpb25fY291bnQiOjEsImNvbW1lbnRfY291bnQiOjEsInB1YmxpY2F0aW9uX2lkIjo2NDY1NDIyLCJwdWJsaWNhdGlvbl9uYW1lIjoiRGFuaWVsIExvdXJlbsOnbyIsInB1YmxpY2F0aW9uX2xvZ29fdXJsIjoiaHR0cHM6Ly9zdWJzdGFja2Nkbi5jb20vaW1hZ2UvZmV0Y2gvJHNfIVI5Vm8hLGZfYXV0byxxX2F1dG86Z29vZCxmbF9wcm9ncmVzc2l2ZTpzdGVlcC9odHRwcyUzQSUyRiUyRnN1YnN0YWNrLXBvc3QtbWVkaWEuczMuYW1hem9uYXdzLmNvbSUyRnB1YmxpYyUyRmltYWdlcyUyRjI2MWRkNzAwLWVhMTAtNDE0NS1hYTc4LTY1MzNkYzIzZjBlOF8zOTV4NjEzLmpwZWciLCJiZWxvd1RoZUZvbGQiOmZhbHNlLCJ5b3V0dWJlX3VybCI6bnVsbCwic2hvd19saW5rcyI6bnVsbCwiZmVlZF91cmwiOm51bGx9fQ -->
