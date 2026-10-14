---
title: Carteiras Bitcoin
subtitle: "Afinal, o que são as 12 palavras mágicas?"
slug: carteiras-bitcoin
audience: everyone
publication_id: 6465422
id: 188910872
---

O Bitcoin funciona à base de *Chaves Públicas(PubKey)* e *Chaves Privadas(PrivKey)*. Você recebe em um endereço, usa a *Chave Privada* para assinar uma transação gastando os bitcoins naquele endereço e a *Chave Pública* é usada para provar que a assinatura é realmente válida. Porém isso é uma simplificação. Não existem bitcoins naquele endereço. 

Na verdade, todos esses termos que acabei de falar são apenas números com algumas dezenas de dígitos na base decimal ou 256 dígitos na base binária. Os bitcoins não está em um endereço (hash da *Chave Pública*) ou *Chave Pública*, muito menos numa *Chave Privada*. **Todos os bitcoins** estão na *blockchain*.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJBc3NpbmUgZ3JhdHVpdGFtZW50ZSBwYXJhIHJlY2ViZXIgbm92b3MgcG9zdHMgZSBhcG9pYXIgbWV1IHRyYWJhbGhvLiJ9XX1dfQ -->

### Blockchain

---

Essencialmente, a *blockchain* é um registro contábil. Nela estão registradas todas as transações feitas com bitcoin deste 2009. Fazer uma transação na camada principal do Bitcoin é pedir para todos os *full nodes*<!-- substack-cli-inline:v1 eyJ0eXBlIjoiZm9vdG5vdGVBbmNob3IiLCJhdHRycyI6eyJudW1iZXIiOjF9LCJtYXJrcyI6W3sidHlwZSI6ImVtIn1dfQ --> do mundo inteiro guardem aquela informação por toda a eternidade. Imagine uma planilha com [1 bilhão de linhas](https://exame.com/future-of-money/bitcoin-supera-mais-de-1-bilhao-transacoes-processadas-no-blockchain/), cada nova transação feita é uma nova linha nessa planilha onde todos os usuários da rede tem uma cópia em um formato resistente à mudanças: **a blockchain**.

O resultado real de uma transação ser incluída na *blockchain* é a criação de um novo output(UTXO) no nome de um endereço. O que isso significa? Significa que você criou esse output com uma condição de gasto. A condição normalmente é “Quem quer que tenha a *Chave Privada* da *Chave Pública* que criou esse endereço pode gastar esse output” e isso é feito com o que chamamos de `scriptPubKey`  em uma linguagem de pilha usada pelo Bitcoin chamada simplesmente de `Script`.

### Script

---

`Script` é uma linguagem baseada em **pilha**, isso significa que as informações e dados que um script dessa linguagem recebe **só podem entrar ou sair pelo topo** dessa estrutura. Isso limita a linguagem e a torna mais previsível.

#### Locking script (scriptPubKey)

É o script que fica na **saída (output)** de uma transação. Ele define as condições que precisam ser satisfeitas para que aquele Bitcoin possa ser gasto no futuro. Funciona como um cadeado.

Exemplo clássico (P2PKH — Pay to Public Key Hash):

```plaintext
OP_DUP OP_HASH160 <hash da chave pública> OP_EQUALVERIFY OP_CHECKSIG
```

Traduzindo: “Para gastar isso, prove que você tem a chave pública correspondente a esse hash **e** assine com a chave privada.”

#### Unlocking script (scriptSig)

Enquanto o output da transação é “travado” pelo `scriptPubKey`, ao virar o input de uma nova transação é preciso destravar, ou seja, atender as condições definidas pelo `scriptPubKey`. No exemplo P2PKH, é simples assim:

```plaintext
<assinatura> <chave pública>
```

Observação: Tanto `scriptPubKey` quanto `scriptSig` são incluídos na transação que vai para a *blockchain*. Eis a importância de ser simples, compacto e de comportamento previsível.

#### Como a pilha funciona na validação

Quando um nó valida a transação, ele **concatena** os dois scripts e os executa em sequência sobre uma pilha vazia:

```plaintext
[scriptSig]  +  [scriptPubKey]
```

Passo a passo para P2PKH:

1. <assinatura> → empilha a assinatura
2. <chave pública> → empilha a chave pública
3. OP_DUP → duplica o topo da pilha (copia a chave pública)
4. OP_HASH160 → aplica HASH160 no topo (hash da chave pública)
5. <hash esperado> → empilha o hash do scriptPubKey
6. OP_EQUALVERIFY → compara os dois hashes; falha se diferentes
7. OP_CHECKSIG → verifica a assinatura com a chave pública; empilha TRUE

Se ao final restar **TRUE** no topo da pilha, a transação é válida e os bitcoins podem ser gastos. O passo 6 verifica se a *Chave Pública* que você deu é a mesma do endereço original. Agora só resta a assinatura e a *Chave Pública* — dona do endereço, portanto, dos fundos — na pilha. É hora de verificar se a assinatura realmente foi feita pela *Chave Privada* correspondente. [Nesse artigo](https://danielloureno1.substack.com/p/criptografia-de-curva-eliptica) eu explico a matemática que permite a validação de assinaturas.

```plaintext
OUTPUT (criado por quem pagou)    INPUT (quem gasta depois)
┌─────────────────────┐           ┌─────────────────────┐
│   scriptPubKey     │    ←──    │     scriptSig        │
│   (cadeado)        │           │     (chave)          │
└─────────────────────┘           └─────────────────────┘
```

### Carteiras Bitcoin

---

Agora que passamos pela introdução, você deve estar se perguntando “O que tudo isso tem a ver com carteiras Bitcoin?”. Se você prestou atenção na explicação, entendeu que existem dois processos entre uma *Chave Privada* e gastar os bitcoins: A <!-- substack-cli-inline:v1 eyJ0eXBlIjoidGV4dCIsInRleHQiOiJDcmlwdG9ncmFmaWEgZGUgQ3VydmEgRWzDrXB0aWNhKEVDQykiLCJtYXJrcyI6W3sidHlwZSI6ImxpbmsiLCJhdHRycyI6eyJocmVmIjoiaHR0cHM6Ly9kYW5pZWxsb3VyZW5vMS5zdWJzdGFjay5jb20vcC9jcmlwdG9ncmFmaWEtZGUtY3VydmEtZWxpcHRpY2EiLCJ0YXJnZXQiOiJfYmxhbmsiLCJyZWwiOiJub29wZW5lciBub3JlZmVycmVyIG5vZm9sbG93IiwiY2xhc3MiOm51bGx9fSx7InR5cGUiOiJlbSJ9XX0 --> que gera a *Chave Pública* e o *SHA-256* que gera o endereço. 

Apesar do nome, é uma boa prática expor sua *Chave Pública* uma única vez, somente na hora de gastar os bitcoins controlados por aquela chave e depois nunca mais usá-la novamente. A lógica por trás disso é que você recebe bitcoins num endereço e ninguém sabe qual a *Chave Pública* daquele endereço. Uma vez que você gasta aqueles bitcoins (revelando sua PubKey) e continua recebendo naquele endereço, alguém pode tentar via força bruta adivinhar sua PrivKey. Esse tipo de ataque é impossível com a tecnologia atual, mas o Bitcoin opera na lógica de longo prazo. Expor algo significa expor eternamente para um atacante imaginário que nunca esquece, nunca descansa e nunca se revela. Caso você não volte a usar aquele endereço e par de chaves, você ficou exposto apenas entre o tempo de propagar sua transação na internet até a inclusão dela na *blockchain*.

Porém isso cria outro problema. Como gerenciar todas as suas chaves se você só pode usar cada par uma única vez? Esse é o trabalho das carteiras Bitcoin.

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJJbnNjcmV2YS1zZSIsImxhbmd1YWdlIjoicHQtYnIifSwiY29udGVudCI6W3sidHlwZSI6ImN0YUNhcHRpb24iLCJjb250ZW50IjpbeyJ0eXBlIjoidGV4dCIsInRleHQiOiJBc3NpbmUgcGFyYSByZWNlYmVyIG5vdm9zIHRleHRvcyBjb21vIGVzc2UhIn1dfV19 -->

### Dos primórdios até Seed Phrases

---

Quando o Bitcoin foi criado pelo Satoshi, havia somente o programa Bitcoin Core criado pelo mesmo. Era o único programa que sabia usar o [protocolo do Bitcoin](https://danielloureno1.substack.com/p/bitcoin-nao-e-dinheiro), diferente de hoje, onde Bitcoin deixou de ser um programa e se tornou uma linguagem que uma infinidade de softwares usam para se comunicar e transferir valor real 24/7.

Sendo assim, o Bitcoin Core precisava ser completo, fazer tudo ao mesmo tempo:

- Validar e propagar transações
- Minerar
- Gerenciar chaves/ser uma carteira

Para receber pagamentos, uma nova *Chave Privada* era criada — entenda escolher entre as quase infinitas que existem — a *Chave Pública* era derivada e só. Nem mesmo endereços existiam naquela época. Cada chave tinha que ser armazenada. Perder ela significaria perder os fundos.

Todas as chaves eram guardadas em um arquivo para que você fizesse backup. Todos os seus fundos estavam em um cofre **impenetrável**, mas as chaves estavam em um **efêmero** arquivo `.txt` ou `.dat`.

Exemplo de `wallet.dat`:

```plaintext
Chave 1:

  Privada: 5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF

  Pública:  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa

  Label: “”

Chave 2:

  Privada: 5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf

  Pública:  1XPTuPXXuW727z92mJvEAsXj75xT3bN4x

  Label: “Duas pizzas”

Chave 3:

  Privada: 5JYkZjmN7PVMjJUfJWfRFwtuXTGB439XV6faajeHPAM2Z6ptgqe

  Pública:  1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp

  Label: “”

Chave 4:

  Privada: 5KYZdUEo39z3FPrtuX2QbbwGnNP5zTd7yyr2SC1j299sBCnWjss

  Pública:  1AJbsFZ64EpEfS5UAjAfcUG8pH8Jn3rn1F

  Label: “Troco tx 2f3a...”
```

#### Carteiras Hierárquicas Determinísticas (HD Wallets)

A ideia do BIP 32 era criar uma forma de derivar todas as chaves a partir de uma Chave Mestra. É determinístico porque você sempre vai derivar as mesmas chaves na mesma ordem. 

É hierárquico pois segue uma estrutura de derivações que suporta alterações. Quer criar outra conta com uma cadeia inteira de novos endereços? Você consegue. Quer criar endereços para SegWit, Taproot ou modelos antigos? Você consegue. Chaves para outras moedas? Também é possível.

A estrutura de derivação é a seguinte:

```plaintext
MasterKey/Purpose’/CoinType’/Account’/Change/AddressIndex
```

- A Chave Mestra é fixa e nunca muda. A partir dela você desbloqueia toda a árvore de derivações.
- O propósito é o tipo de endereço a ser criado, pode ser Legacy, SegWit, Taproot etc.
- Tipo de moeda pode ser BTC, ETH e por aí vai.
- Conta é uma questão de organização, para o usuário separar como bem entender.
- Troco serve para separar pagamentos de retornos, pode ser 0 ou 1, booleano.
- O index é um número de 0 até 4 bilhões. Cada um representa um conjunto diferente formado por chaves pública e privada + endereço.

A sequência de derivação `m/84’/0’/0’/0/5` sempre vai gerar o mesmo par de chaves, não importa qual software eu use nem o momento, nem se algum novo BIP foi adotado.

Considerando que você pode ter 4 bilhões de contas diferentes, são muitos endereços para uma Chave Mestra de míseros 256 bits (o mesmo tamanho de uma PrivKey).

#### Seed Phrases

Em seguida veio o BIP 39 que convertia essa Chave Mestra em uma sequência de palavras fáceis de memorizar. Sem muito segredo aqui. Criaram uma lista de 2048 palavras padronizadas em várias línguas, onde cada palavra representa 11 bits de informação.

O processo funciona assim: uma sequência aleatória de 128 a 256 bits é gerada (dependendo se você quer 12, 18 ou 24 palavras). Um checksum é adicionado ao final para detectar erros de digitação. Essa sequência é então dividida em pedaços de 11 bits, e cada pedaço corresponde a uma palavra da lista.

Por exemplo, uma seed de 12 palavras representa 128 bits de entropia + 4 bits de checksum = 132 bits totais, divididos em 12 grupos de 11 bits. Já uma seed de 24 palavras oferece 256 bits de entropia + 8 bits de checksum. Essas palavras, através de uma função criptográfica chamada PBKDF2, geram a Chave Mestra Estendida de 512 bits que desbloqueia toda a árvore HD.

Com seed phrases você pode guardar todos os seus endereços anotando ou memorizando **uma informação, uma única vez.**

#### Chaves Estendidas (Extended keys)

A Chave Mestra Estendida, **também conhecida como Chave Privada Estendida(xprv)**, é dividida em dois blocos de 256 bits. O primeiro é a *Chave Privada Mestra(m)* enquanto o segundo é a *Master Chain Code*. Esse último é necessário para derivar as chaves filhas na árvore.

Você pode usar `m` para derivar a *Chave Pública*, juntar com a *Master Chain Code* para obter a *Chave Pública Estendida*(famosa *xpub*) para derivar as PubKeys filhas e os endereços.

#### Derivação normal vs hardened

Com a derivação normal é possível derivar as PubKeys e endereços filhos somente com a *Chave Pública Estendida*. Com a derivação hardened, é necessário também a *Chave Privada Estendida* para derivar qualquer coisa dos filhos

Com a derivação normal, caso a PrivKey de um dos filhos seja descoberta é possível, usando a *Chave Pública Estendida* do pai, descobrir as chaves de todos os irmãos, comprometendo uma camada inteira da árvore. Ao exigir a *xprv*, a derivação hardened impede que outras camadas acima sejam comprometidas também. 

Essa proteção extra foi propositalmente deixada de lado para as últimas camadas da árvore de derivação para permitir carteiras *watch-only* e servidores que podem gerar endereços novos para pagamentos online sem comprometer a *xprv* de nenhuma camada ao mesmo tempo que têm acesso a *xpub*.

Geralmente a notação usada pelos softwares de carteiras para a árvore de derivação usa um apóstrofo para representar as camadas protegidas pela derivação hardened:

```plaintext
MasterKey/Purpose’/CoinType’/Account’/Change/AddressIndex
```

Digamos que a *xpub* da sua conta esteja em um servidor em um website gerando novos endereços diariamente para pagamentos online. Imagine que algum bug no software ou uma invasão ocorra no sistema de forma que um atacante tenha acesso as chaves privadas dos `AddressIndex`. Ele conseguiria então descobrir a *xprv* da camada superior por meio de um cálculo matemático simples. Ele poderia continuar subindo camadas enquanto tivesse a *xpub* da camada superior. Como a camada de contas é de forma padronizada protegida por derivação hardened, o risco de ter suas outras contas ou seed descobertas é eliminado completamente.

Ativar derivação hardened para todas as camadas é possível, mas ao custo das vantagens que falei antes. O comportamento padrão de softwares de carteiras Bitcoin modernas é de usar derivação normal para índices de 0 até 2³¹-1(2.147.483.647) e derivação hardened para 2³¹ até 2³²-1 (2.147.483.648 a 4.294.967.295) totalizando os 4 bilhões de índices que falei antes.

### Conclusão

---

Saímos de chaves avulsas, independentes e aleatórias para carteiras com uma estrutura bem definida e geração de chaves repetível. Esse foi um dos maiores saltos em quesito experiência de usuário(UX) desde a criação do Bitcoin. Permitiu gerenciar todos os fundos de uma pessoa sob um único dado e o transformou em uma sequência de palavras memorizável.

Mas há algo mais profundo acontecendo aqui. Toda essa complexidade, Scripts, pilhas, derivações hierárquicas, checksums, existe para resolver um problema que o sistema financeiro tradicional nunca precisou resolver: **como dar a uma pessoa soberania real sobre o próprio dinheiro, sem depender de ninguém para guardar, autorizar ou validar nada.**

Em uma rede descentralizada onde ninguém é soberano, ninguém pode validar sua identidade ou posse. Isso tem que ser feito através da matemática da *Criptografia de Curva Elíptica* com suas Chaves Públicas e Privadas. O que é bem complicado quando você precisa gerenciar múltiplos endereços. Por isso as carteiras precisaram evoluir para lidar com o peso desse gerenciamento e foi exatamente isso que o BIP 32 e o BIP 39 fizeram.

Quem tem a seed, tem os fundos, sem intermediários, sem permissão, sem horário de funcionamento. O preço dessa soberania é a responsabilidade. Doze palavras escritas num papel são, ao mesmo tempo, a coisa mais simples e mais poderosa que existe no sistema. Não existe suporte para recuperar o acesso caso você as perca. Não existe seguro. Não existe recurso.

*”Not your keys, not your coins.”* Simples assim.

<!-- substack-cli-node:v1 eyJ0eXBlIjoiZm9vdG5vdGUiLCJhdHRycyI6eyJudW1iZXIiOjF9LCJjb250ZW50IjpbeyJ0eXBlIjoicGFyYWdyYXBoIiwiY29udGVudCI6W3sidHlwZSI6InRleHQiLCJ0ZXh0IjoiUGVzc29hcyBxdWUgcGFydGljaXBhbSBkYSByZWRlIGFybWF6ZW5hbmRvIGEgIn0seyJ0eXBlIjoidGV4dCIsIm1hcmtzIjpbeyJ0eXBlIjoiZW0ifV0sInRleHQiOiJibG9ja2NoYWluIn0seyJ0eXBlIjoidGV4dCIsInRleHQiOiIsIHByb3BhZ2FuZG8gdHJhbnNhw6fDtWVzIHJlY2ViaWRhcyBlIGV2ZW50dWFsbWVudGUgbWluZXJhbmRvIn1dfSx7InR5cGUiOiJwYXJhZ3JhcGgifV19 -->
