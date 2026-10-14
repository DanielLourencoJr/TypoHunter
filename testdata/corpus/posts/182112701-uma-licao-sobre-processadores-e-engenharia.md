---
title: Uma lição sobre processadores e engenharia
subtitle: "Não existe almoço grátis, sempre existe um efeito colateral ou letrinha miúda."
slug: uma-licao-sobre-processadores-e-engenharia
audience: everyone
publication_id: 6465422
id: 182112701
---

Na faculdade tenho uma matéria chamada Estruturas de Dados onde aprendemos diversas formas de organizar os dados para que o computador possa usá-los de forma eficiente.

O mais básico de tudo é uma lista homogênea de dados que chamamos vetores. A propriedade mais importante dos vetores é que eles são espaços seguidos de memória que guardam valores com o mesmo tamanho.

A melhor analogia que consigo pensar é a de uma sala de aula com mapeamento dos assentos. Na minha escola nossas posições na sala eram fixas. Se eu queria achar meu amigo eu não precisava vasculhar a sala inteira com o olhar, eu poderia olhar diretamente para a cadeira dele.

Vetores funcionam da mesma forma. Se eu sei a posição, eu acho a informação quase instantaneamente.

Mas novas informações são adicionadas o tempo todo em posições vazias. Informações velhas são apagadas e dão lugar a novas informações. Por isso nem sempre você sabe a posição de uma informação dentro de um vetor. Você vai precisar olhar em cada posição e verificar se a informação naquela posição é a que você deseja.

Isso é bem ineficiente, visto que eu vou precisar repetir isso para todas as posições do vetor, que pode ser bem grande.

### Vetor ordenado

Ao invés de olhar todas as posições até achar, eu posso ordenar o vetor de forma crescente. Assim eu não preciso olhar todas as posições, só do começo até o primeiro elemento que for maior que o desejado. Se mesmo assim não encontrar, tenho certeza que ele não está na parte restante que não procurei.

Por outro lado, se o que estiver procurando for maior que todos os elementos do vetor, ainda vai ter bastante trabalho que poderia ser evitado com outra técnica.

### Busca binária

Consiste em olhar o elemento no meio do vetor. Se o vetor está ordenado e o elemento central é maior que a informação procurada, posso descartar — em 100% dos casos — metade do vetor. Procurando na outra metade, utilizo a mesma técnica e descarto metade da metade.

Isso significa que mesmo que o vetor cresça e fique duas vezes maior, o meu trabalho para procurar qualquer elemento vai aumentar uma mísera comparação.

Já chegamos no estado da arte. Não existe nada melhor que não envolta colocar restrições e condições. A busca binária, de forma geral, funciona para qualquer tipo de vetor. A única condição é que o vetor esteja ordenado.

### O problema

Parece uma pequena condição, uma letrinha miúda de um contrato, mas o problema é maior do que parece. Num raciocínio direto, sem truques, ordenar os elementos de um vetor significa pegar um elemento qualquer e colocar todos os menores à esquerda, maiores à direita. E você vai precisar repetir isso para cada elemento.

Se o vetor tinha N elementos, isso significa mudar quase N elementos de posição, N vezes. São necessários cerca de N² operações para ordenar um vetor, aparentemente.

Porém, existem técnicas para fazer isso ligeiramente melhor.

### Ordenação de vetores

Existem inúmeros algoritmos para ordenar vetores, uns melhores, uns piores.

Em geral queremos saber como o algoritmo se comporta na maioria dos casos. Existem algoritmos que demoram sempre o mesmo tempo para executar em vetores do mesmo tamanho. Existem outros que executam mais rápido caso o vetor esteja mais bagunçado, ou menos.

O ideal é aquele que seja mais rápido quando o vetor é totalmente caótico. Não preciso de um algoritmo rápido para ordenar um vetor já ordenado.

Por isso precisamos analisar o comportamento dos algoritmos no pior e no melhor caso. E analisar de qual deles o caso médio está mais próximo.

### Bubble Sort

Um dos algoritmos mais simples de ordenação de um vetor.

Algoritmo:

1. Verifique se o elemento atual é maior que o próximo

2. Caso seja, troque os dois de posição

3. Repita até o último elemento

4. Faça isso N vezes

E o vetor está ordenado. Eu vasculhei o vetor do inicio ao fim N vezes. O vetor tem N elementos. Logo NxN = N².

Em outras palavras, o que o algoritmo Bubble Sort faz é levar o maior elemento para o lugar certo, o final. Depois ele pega o segundo maior e leva até a penúltima posição e assim por diante.

O algoritmo realiza duas ações repetidamente. Verificar qual é maior entre dois elementos e trocá-los de posição. Ambos tem um custo de processamento, pequeno, mas diferente de zero.

A verificação é feita sempre. A troca não. Se queremos o melhor caso, o vetor em que o algoritmo trabalha menos, é aquele que não precisa fazer nenhuma troca. Ou seja, o melhor caso é o vetor ordenado de forma crescente.

E o pior caso? É aquele com mais trocas. Se o algoritmo move os maiores elementos para o final, mais trocas significam que o maior está no começo. Então o pior caso é um vetor ordenado de forma decrescente.

Porém, de toda forma ainda precisa fazer N² checagens, então o número de operações ainda está nessa ordem de grandeza.

- Se o vetor estiver bagunçado, vou precisar fazer N² operações

- Se o vetor estiver ordenado de forma decrescente, N²

- Se for de forma crescente (já tá da forma que queremos!), ainda assim N²

Se você se lembrar das parábolas da matemática básica, vai lembrar que ela cresce mais rápido que uma linha reta. Ainda podemos melhorar esse algoritmo.

### Bubble Sort Melhorado

Já entendemos que fazemos mais verificações do que trocas. Só precisamos descobrir como fazer menos verificações. Para isso você só precisa saber que a cada vez que o programa vasculha o vetor, alguma troca é feita. Se nenhuma troca tiver sido feita, significa que o vetor já está ordenado.

Resumindo: Quando as trocas pararem de acontecer, paramos de verificar e encerramos o algoritmo, pois atingimos o objetivo.

Após essa melhoria:

- Um vetor bagunçado leva algo entre N e N² operações

- Um vetor decrescente leva N² operações

- Um vetor crescente (já ordenado) leva N operações

É uma melhoria, mas não significativa. Note que no por caso ainda demora N² operações para ordenar o vetor e casos próximos do melhor caso (vetor quase ordenado) são raros.

Se eu só precisar ordenar vetores decrescentes, esse é tão ruim quanto o original, por exemplo.

Mas isso não é nem sobre o que eu quero falar. E finalmente chegamos no tema central desse post.

### Complexidade de Algoritmo

Complexidade é esse comportamento do algoritmo que buscamos analisar no tópico anterior.

Como ele se comporta no melhor caso, no pior, e principalmente no caso médio.

O caso médio — ou seja, mais provável — é um vetor completamente bagunçado e caótico. E nesse caso, a complexidade do algoritmo é maior que N e menor que N².

A ideia é que analisando o caso médio e você possa decidir qual o melhor algoritmo. E para isso você precisa analisar o **funcionamento interno** do algoritmo. Ou foi o que me disseram em sala de aula.

E aqui nasce a ideia desse artigo:

> Será possível descobrir melhor e pior caso de um algoritmo sem saber como ele funciona?
> 
> E se eu usar o próprio algoritmo para descobrir seu comportamento na prática?
> 
> E se eu tirar a média de todas as permutações possíveis de um vetor?

### Desafios

Perguntei ao meu professor se seria possível executar o algoritmo de ordenação para todos os vetores possíveis e ver aquele que deu mais trabalho ao computador, aquele que demorou mais tempo para ordenar.

Ele disse que eram muitas possibilidades de vetores e que esse trabalho seria inviável de realizar de forma prática e seguiu a aula, mas essa dúvida me seguiu até em casa e cá estamos.

De fato, o custo de testar todas as possibilidades de um vetor é proibitiva. O que eu quero fazer é ordenar todas as permutações possíveis de um vetor.

Se eu tenho o vetor com os elementos 1 e 2. Ou seja, [1, 2] que é a forma mais usual de representar vetores. Então ele tem duas permutações. [1, 2] e [2, 1].

Um vetor com 3 elementos teria 6 permutações. 4 elementos, 24 permutações. O número de permutações que precisamos testar é exatamente N!(fatorial de N) isso é bem pior do que N². Muito, MUITO PIOR.

5! = 120

6! = 720

7! = 5040

8! = 40 mil

E por ai vai. Cresce, e cresce cada vez mais rápido. Problemas onde o custo em cálculos e tempo aumenta exponencialmente são uma pedra no sapato mesmo para supercomputadores, como expliquei [nesse artigo](https://substack.com/@danielloureno1/p-181350395).

Ao mesmo tempo, vetores pequenos (N < 100) são bem rápidos de se ordenar e o tempo necessário é bem pequeno. Pequeno o suficiente para ter muito ruído.

O processador é uma máquina bem rápida, mas ele só consegue fazer uma coisa por vez. Imagine que você tivesse que parar de andar para piscar, para respirar, para pensar. Isso faria você demorar mais para completar seu trajeto. Isso também se aplica para o processador.

Nos dias de hoje os processadores tem de 2 a 16 núcleos. Esses núcleos, para todos os efeitos, são como um processador próprio capaz de executar programas. Mas o número de programas que rodam num desktop moderno está na casa das centenas.

Você mesmo já deve ter aberto mais de 20 programas (ou abas do navegador) ao mesmo tempo alguma vez<!-- substack-cli-inline:v1 eyJ0eXBlIjoiZm9vdG5vdGVBbmNob3IiLCJhdHRycyI6eyJudW1iZXIiOjF9fQ -->. Para dar a impressão de que tudo isso está rodando ao mesmo tempo os processadores aplicam uma técnica chamada concorrência.

Paralelismo faz dois núcleos executarem dois programas diferentes ao mesmo tempo. Concorrência é quando um núcleo executa dois programas diferentes “ao mesmo tempo”.

O que ele faz é intercalar qual programa ele está executando à uma frequência altíssima ao custo de demorar mais. Demorará o tempo de execução de cada programa isoladamente mais um atraso de trocar entre eles constantemente, para ser preciso. Se o aumento do tempo não é perceptivo, é porque era uma tarefa muito rápida de completar.

E o processador está sempre parando de executar seus programas para executar pequenas tarefas da forma mais imperceptível possível. Estamos falando de milésimos de milésimos de milésimos de segundos. Mas que fazem diferença para o que estamos tentando medir: a ordenação de vetores pequenos.

Vetores pequenos sofrem de ruído do processador<!-- substack-cli-inline:v1 eyJ0eXBlIjoiZm9vdG5vdGVBbmNob3IiLCJhdHRycyI6eyJudW1iZXIiOjJ9fQ -->. Vetores grandes fazem o teste em todas as permutações muito demorado. Qual a solução?

O melhor a se fazer não é medir o tempo, mas o número de operações que o algoritmo executa para ordenar os vetores. Assim eliminamos o ruído e podemos testar ordenar vetores pequenos. Porém, isso cria outro problema.

Se eu quero manter o algoritmo como uma caixa preta e testá-lo sem saber como funciona, não posso usar esse método.

Pois contar o número de passos envolve:

- Ler o código do algoritmo de ordenação
- Entender quais passos são relevantes em questão lógica e de custo
- Adicionar um contador que aumenta junto com esses passos (alterar o código)

Seria a melhor forma de entender, se não fosse pela restrição que quero explorar.

Então só resta um único caminho para mim: Medir o tempo tentando eliminar o ruído, mas isso tem um custo.

A técnica a ser usada aqui é uma média simples. O programa, em teoria, executaria sempre no mesmo tempo em um processador completamente livre e ocioso, mas o que temos é o tempo de execução mais um ruído variável. A média será o tempo de execução do algoritmo mais um ruído pequeno.

Mais do que chegar ao tempo absoluto de execução para o algoritmo de ordenação, queremos a diferença em proporção entre o tempo de execução em duas permutações diferentes. E para isso a média é suficiente.

Você deve saber muito bem que não existe almoço grátis. A média significa refazer o teste múltiplas vezes, *o que significa demorar múltiplas vezes*.

Cada vez mais, a cada desafio superado, vejo que meu professor tinha razão desde o início. E vejo que minha “preguiça” teve um valor. Esse experimento me fez pensar nos desafios envolvidos e soluções engenhosas ou gambiarrentas.

### Normalização

Uma última coisa a se fazer é normalizar os resultados. Normalizar significa mudar a escala dos dados para facilitar a leitura e interpretação. Na prática significa dividir todos os tempos pelo menor dos tempos.

Assim o “tempo” do melhor resultado, que no caso do Bubble Sort é o vetor já ordenado, será 1. Os outros resultados serão múltiplos desse tempo.

Isso é melhor pois me é mais útil saber que determinado vetor leva 1,5 vezes o tempo de ordenar o vetor mais fácil do que saber que esse vetor leva 684 nanossegundos enquanto o vetor mais fácil leva 456 nanossegundos.

### Conclusão

Nesse experimento consolidei meus conhecimentos sobre vetores, busca e ordenação. Aprendi sobre paralelismo e concorrência. Pratiquei escrita de código para rodar os algoritmos citados. Resolvi problemas que apareciam no caminho. Pensei em executar testes mais robustos usando mais tempo. Tudo isso e mais um pouco.

No fim não cheguei a uma conclusão ou resultados dignos de nota. Se tivesse que fazer alguma observação, diria que na prática os resultados pareceram mais aleatórios do que o desejável, mas com certos padrões. 

O texto ficou mais longo do que eu gostaria, mas gostei do resultado final. Se você leu até aqui deve ter interesse pelo tema. Você é da área de TI ou um curioso de internet? Me manda uma mensagem aqui nos comentários.

Sinceramente só queria expor meu raciocínio e publicar o quanto antes, apesar de ter faltado falar de algumas coisas.

Acontece que perdi muito tempo montando os testes e rodando eles. E no fim não nem pude mostrar nada sobre eles.

![Ozen Dev IA](https://substack-post-media.s3.amazonaws.com/public/images/f7497881-e972-46fc-8ead-7d4f5692aa64_700x1050.png "Literalmente eu nesse fim de ano")

<!-- substack-cli-node:v1 eyJ0eXBlIjoic3Vic2NyaWJlV2lkZ2V0IiwiYXR0cnMiOnsidXJsIjoiJSVjaGVja291dF91cmwlJSIsInRleHQiOiJTdWJzY3JpYmUiLCJsYW5ndWFnZSI6ImVuIn0sImNvbnRlbnQiOlt7InR5cGUiOiJjdGFDYXB0aW9uIiwiY29udGVudCI6W3sidHlwZSI6InRleHQiLCJ0ZXh0IjoiT2JyaWdhZG8gcG9yIGxlciBhdMOpIG8gZmltLiBUZSB2ZWpvIHNlbWFuYSBxdWUgdmVtPyJ9XX1dfQ -->



<!-- substack-cli-node:v1 eyJ0eXBlIjoiZm9vdG5vdGUiLCJhdHRycyI6eyJudW1iZXIiOjF9LCJjb250ZW50IjpbeyJ0eXBlIjoicGFyYWdyYXBoIiwiY29udGVudCI6W3sidHlwZSI6InRleHQiLCJ0ZXh0IjoiR2VyYWxtZW50ZSB1bWEgYXBsaWNhdGl2byBvdSBwcm9ncmFtYSBjb21wbGV4byB0ZW0gbWFpcyBkZSB1bSBwcm9jZXNzbyBleGVjdXRhbmRvIGFvIG1lc21vIHRlbXBvLiBWb2PDqiBwb2RlIGZhemVyIG8gdGVzdGUgYWJyaW5kbyBvIGdlcmVuY2lhZG9yIGRlIHRhcmVmYXMuIn1dfV19 -->

<!-- substack-cli-node:v1 eyJ0eXBlIjoiZm9vdG5vdGUiLCJhdHRycyI6eyJudW1iZXIiOjJ9LCJjb250ZW50IjpbeyJ0eXBlIjoicGFyYWdyYXBoIiwiY29udGVudCI6W3sidHlwZSI6InRleHQiLCJ0ZXh0IjoiTsOjbyBow6EgbXVpdG8gYSBzZXIgZmVpdG8sIGrDoSBxdWUgaXNzbyDDqSBjb250cm9sYWRvIHBlbG8gU2lzdGVtYSBPcGVyYWNpb25hbC4ifV19XX0 -->
