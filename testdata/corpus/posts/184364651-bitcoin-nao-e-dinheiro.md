---
title: Bitcoin não é dinheiro
subtitle: Ele é um protocolo
slug: bitcoin-nao-e-dinheiro
audience: everyone
publication_id: 6465422
id: 184364651
---

O Bitcoin não é uma dinheiro eletrônico ponto a ponto. É um protocolo que busca consenso pois quer fugir do autoritarismo de qualquer instituição. E isso tem um preço.

A maior dificulade do Bitcoin não era dar valor à um token digital. Não era criar carteiras, multisig ou qualquer besteira parecida. A maior dificuldade do Bitcoin foi resolver o gasto duplo, parece algo simples, mas exige algo que vem por padrão em qualquer sistema centralizado: Consenso.

Essa é a essência do Bitcoin: **Consenso**. 

Como Satoshi resolveu o gasto duplo? **Consenso**. 

Como o Bitcoin garante que os blocos não são adulterados pelos mineradores? **Consenso**. 

Como o Bitcoin resistirá à computação quantica? **Consenso**.

Como a sua adoção só aumenta há 16 anos? **Consenso**.

Como ele pode criar adições e melhorias num sistema que parece tão intrincado e complexo? **Consenso**.

Consenso é uma caracteristica obrigatória para um sistema descentralizado. O oposto de uma pessoa mandando é todos mandando. Todos são soberanos, logo ninguém é soberano.

Eu posso alterar a blockchain e criar uma versão onde todos os bitcoins foram minerados para endereços meus, mas ninguém aceitaria essa nova versão a menos que eu fizesse o trabalho de minerar cada bloco, mesmo que de forma anacrônica.

O *SHA-256* é responsável pelos hashes dos blocos. Existem versões do Bitcoin que usam outras, mais modernas, mais seguras, mais resistentes prontas para serem adotadas, mas elas não serão até que seja necessário.

O dinheiro estatal é um acordo onde concordamos em valorizar papel. O Bitcoin é um acordo onde **valorizamos as regras**, um protocolo de comunicação.

O Bitcoin tem regras que todos concordam, mesmo que tacitamente. Entre elas o número de bitcoins que existem e vão existir. E como isso é consenso de toda a rede, é a realidade, é difícil de mudar, é previsível. 

Enquanto o governo valoriza mais índices diversos — como dívida externa e sonegação de imposto, por exemplo — do que o valor da moeda, os indivíduos se preocupam principalmente com seu poder de compra. E qualquer coisa que o preserve será igualmente valorizado.

**Regra n°0: Criar um bloco deve custar energia ao minerador.** Isso é o que chamamos de Prova de Trabalho(PoW). É feito descobrindo uma assinatura(hash) que torne o bloco válido. Se o bloco for inválido — não seguir todas as regras em consenso na rede — será ignorado e o minerador terá desperdiçado tempo, que significa dinheiro, e energia elétrica.

Em uma instituição centralizada como bancos, você não precisa saber como a tecnologia funciona. Só precisa saber das politicas da autoridade, como ela age.

O Bitcoin não tem uma autoridade que age, mas um sistema de regras que foram acordadas e que você tacitamente concorda quando usa a rede como ela está arranjada hoje. E por isso é necessário se ater ao funcionamento da tecnologia, mesmo que de forma superficial. Senão a tecnologia, pelo menos as regras e em que situações elas podem mudar. Sim, elas podem mudar.

E é disso que quero falar: das regras do Bitcoin e do consenso.

### Transações

**Regra n°1: As transações devem ser válidas.**

Óbvio. Mas o que significa uma transação ser válida? Significa que um bitcoin existente será gasto com a assinatura do dono.

Verificar existência de um bitcoin e a assinatura do dono são coisas triviais que qualquer participante da rede faz quando recebe um bloco. Algo não bateu? Rejeita. Tudo certo? Adiciona à sua cópia local da blockchain.

Vamos ver como exatamente essa verificação é feita. Um detalhe meramente técnico: não existem bitcoins a serem gastos, mas outputs não gastos(UTXO) que são consumidos virando o input de uma transação. 

Uma UTXO que já virou input de uma transação registrada na blockchain não pode ser usado, resolvendo o gasto duplo. E é muito fácil procurar a transação onde esse output foi criado. Assim, é fácil rastrear qualquer UTXO atual até sua criação.

Se todos os blocos que contêm essas transações fazem parte da blockchain, então aquele bitcoin “existe”.

> Assinar uma transação é provar que você sabe um segredo sem jamais colocá-lo em risco.

O segredo é a Chave Privada, isso nunca deve estar na internet. Por meio de uma *Schnorr Signature* você pode verificar se uma assinatura veio do possuidor da Chave Privada sem nunca conhecê-la.

A “mágica” funciona por causa da *Criptografia de Curva Elíptica(ECC)*. Um ponto da curva pode ser obtido fazendo uma operação simples com o ponto inicial. Repita esse processo um número bem específico de vezes. Esse número é sua Chave Privada e o ponto na curva obtido é a Chave Pública. É quase impossível saber que número levou até esse ponto.

*Schnorr Signatures* não foram usadas desde o começo. Antes o Protocolo Bitcoin usava *ECDSA*. Esse é um exemplo de regras mudando. A regra que dizia como fazer assinaturas. Nesse caso foi uma alteração para otimização da matemática, uma mera tecnicalidade das mais pequenas. O Bitcoin já passou por dezenas de alterações parecidas e existem centenas de propostas de melhoria (BIP’s) que não foram adotadas.

Existem regras que são alteradas com o consenso total da rede. Outro exemplo é o *SegWit*, que basicamente era uma técnica nova para segregar as assinaturas no final do bloco, ao invés de intercaladas com as transações em si. Estou falando de forma bem superficial, claro. Quase toda mudança tem seus prós e contras.

Porém, existem casos onde as mudanças nas regras não mudam o consenso da rede. É o que chamamos de *fork*, quando a rede se divide. *Bitcoin Cash* é um exemplo. Os blocos do Bitcoin tem tamanho limitado em bytes, e como só um bloco é gerado a cada dez minutos o número de transações em determinado tempo é limitado. Houve bastante discussão sobre aumentar o tamanho dos blocos, já que o tempo entre blocos não podia ser diminuído por motivos que falarei adiante. Resultado: uma parte da rede alterou a regra para blocos maiores, outra parte não. Na prática havia dois protocolos quase idênticos sendo executados e usados por pessoas diferentes. Tratamos *Bitcoin Cash* como uma moeda diferente porque ainda existe uma outra versão mais usada, o Bitcoin padrão, mas caso uma alteração no consenso de toda a rede acontecesse não seria um *fork*, mas uma transformação do próprio padrão.

### Blockchain

**Regra n°2: Os blocos devem demorar 10 minutos para serem minerados.**

Se a quantidade ou a eficiência dos mineradores aumentar, a regra diz que as pessoas devem exigir um hash mais difícil de se obter nos próximos blocos. Essa regra pode parecer arbitrária, mas é consequência de um sistema descentralizado e da próxima regra.

**Regra n°3: A blockchain oficial é a mais longa. **Ou seja, aquela com mais provas de trabalho(PoW).

Em tese, qualquer pessoa pode adicionar blocos válidos à blockchain, por isso podem acontecer situações estranhas onde pessoas têm blockchains diferentes com o mesmo número de blocos em locais diferentes. Quando um nó da rede recebe dois blocos diferentes estendendo a sua corrente atual isso cria uma bifurcação que não pode ser resolvida. Podem ser que as duas correntes formadas sejam legítimas ou uma delas seja uma tentativa de substituir a cadeia legitima.

Se o nó receber um bloco que estenda uma das correntes, essa tem mais trabalho acumulado e por isso é mais confiável. Pode acontecer de duas correntes serem estendidas paralelamente. Parte da rede vai receber uma dessas correntes, parte receberá a outra, e a maioria vai receber ambas. Todos os nós mineradores vão tentar estender a maior cadeia de blocos, e no caso de empate vão escolher a que receberam primeiro. Eventualmente uma cadeia vai se estender mais e colapsar a bifurcação.

Isso é um evento inevitável em uma rede descentralizada. É um caso onde o consenso não é sobre as regras, mas sobre qual a versão verdadeira do registro público global de transações(Blockchain).

Pra que isso seja resolvido da forma mais suave possível, devemos dar tempo pra que a extensão da blockchain alcance a maioria dos nós. Por isso o tempo entre nós deve ser algo entre 10 minutos. Caso o tempo entre blocos fosse menor, bifurcações longas de dezenas de blocos se formaria, gerando incerteza sobre quais transações estão realmente escritas em pedra. É melhor esperar dois blocos de 10 minutos para que o consenso sobre qual cadeia escolher se forme do que vinte blocos de 5 minutos.

Mas como venho dizendo nesse texto inteiro, nenhuma regra está escrita em pedra. Pode haver um momento no futuro onde tudo está ainda mais conectado do que nos dias de hoje. Talvez internet por satélite como a StarLink ou alguma outra coisa inesperada. Caso isso aconteça, a rede poderá atingir o consenso de forma mais rápida justificando reduzir o tempo entre blocos.

Apesar de tudo, existem regras que provavelmente nunca serão mudadas, como o número máximo de 21 milhões de bitcoins. Enquanto outras muito provavelmente vão mudar, como a função hash *SHA-256*.

O Bitcoin nasceu com uma filosofia bem clara, definida pelo seu criador. Mas ele não é um sistema fechado, um programa. É um protocolo que está se desenvolvendo e evoluindo. Um protocolo sem forma final e definitiva.

<!-- substack-cli-node:v1 eyJ0eXBlIjoiYnV0dG9uIiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJBc3NpbmUgYWdvcmEiLCJhY3Rpb24iOm51bGwsImNsYXNzIjpudWxsfX0 -->
