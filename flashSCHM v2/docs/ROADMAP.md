# Roadmap flashSCHM

## Scelte di prodotto

- L'app continua a funzionare aprendo `index.html` con doppio clic, senza backend.
- Il salvataggio delle programmazioni è manuale. Le versioni salvate restano nel progetto aperto; l'XLSX esportato è la copia durevole da reimportare alla sessione successiva.
- La programmazione corrente resta modificabile. Una versione salvata è una copia indipendente: modifiche successive, inclusi spostamenti manuali sulla timeline, non la alterano.
- Il catalogo attori è distinto dagli attori del piano del giorno. Selezionare un attore dal catalogo copia i suoi dati abituali nel piano, senza collegare retroattivamente le due copie.
- I vincoli obbligatori dello scheduler restano tali anche durante gli esperimenti di ottimizzazione.

## 1. READY globale

**Stato: completato.**

**Risultato:** un campo `READY predefinito` per i nuovi attori e un comando esplicito `Applica a tutti` per quelli già nel piano. Il READY di ogni attore rimane modificabile. Ripetere `Applica a tutti` sostituisce i valori individuali, come indicato dal comando.

**Interventi:** aggiungere il valore alle impostazioni del progetto, aggiornare la creazione degli attori e i controlli UI, includerlo nell'import/export.

**Verifica:** nuovi attori ereditano il READY; un'eccezione individuale resta invariata finché non si riapplica il valore globale; l'XLSX reimportato mantiene i READY effettivi.

## 2. Versioni salvate e XLSX leggibile

**Stato: completato.**

**Risultato:** `Salva programmazione` crea una versione con ID, nome e data di salvataggio. Una lista permette di aprire ed eliminare le versioni. L'app segnala modifiche non ancora esportate. Non c'è salvataggio automatico né archivio separato nel browser.

**Interventi:** conservare nel progetto una lista di copie complete dello stato di pianificazione, senza includere ricorsivamente la lista stessa. Ogni copia comprende attori, READY, attività, professionisti, regole, orari generati e modifiche manuali. L'apertura di una versione crea una nuova copia modificabile.

L'export XLSX aggiunge una sola scheda visibile `Programmazioni`, con una riga per attività e colonne per versione, attore, READY, arrivo, reparto, inizio, fine e professionista. I dati completi delle versioni restano nei metadati del progetto per l'importazione. La scheda `Actors` continua a rappresentare il piano corrente. Il nuovo formato importa anche i progetti precedenti, senza modificare i file originali.

**Verifica:** salvare, modificare, riaprire e riesportare non altera le copie già salvate; reimportare l'XLSX ripristina tutte le versioni; la scheda `Programmazioni` è leggibile senza consultare il JSON. Controllare anche un XLSX reale con la versione di SheetJS usata dall'app.

## 3. Catalogo attori

**Stato: completato.**

**Nota successiva:** il file di catalogo separato descritto qui è stato sostituito dal progetto XLSX unico nella fase 3.1. I vecchi file di solo catalogo restano importabili.

**Risultato:** importare un file XLSX di catalogo, cercare e selezionare più attori, aggiungerli al piano con il READY predefinito. Il catalogo registra almeno un ID stabile, nome e durate abituali. Una funzione di export permette di aggiornare e conservare il catalogo come file separato.

**Interventi:** distinguere l'ID della scheda catalogo dall'ID dell'attore nel piano; mostrare un'anteprima dell'importazione e gestire gli ID duplicati prima di applicarla. Le regole specifiche e i valori aggiuntivi si aggiungono solo quando emerge un caso concreto.

**Verifica:** importare due volte non crea duplicati silenziosi; un attore aggiunto al piano conserva le proprie modifiche anche se il catalogo viene aggiornato; un catalogo esportato si reimporta senza perdere gli ID.

## 3.1. Import/export XLSX unificato

**Stato: completato.**

**Risultato:** un solo controllo di importazione e uno di esportazione. L'XLSX esportato contiene il piano corrente, le versioni salvate e il catalogo; `Actors`, `Programmazioni` e `Catalogo` sono schede visibili. Il progetto completo si apre dopo un'anteprima. Le modifiche alla scheda `Catalogo` sono applicate all'importazione. I precedenti file di solo catalogo si importano dallo stesso controllo, con la scelta esplicita per gli ID già presenti; non si esportano più file separati.

**Verifica:** round trip del progetto completo e del catalogo modificato con SheetJS, importazione dei formati precedenti, interfaccia funzionante tramite `file://` e nessuna perdita silenziosa di versioni o schede.

## 4. Esperimenti di scheduling

**Prima decisione:** definire cosa misuriamo con “tempo di preparazione in testa”: intervallo tra la prima attività e READY, attesa tra attività, oppure un'altra misura. Fissare anche il ruolo della priorità attore nel confronto.

**Risultato:** mantenere l'algoritmo attuale come riferimento e aggiungere una strategia sperimentale selezionabile. Confrontare sui medesimi casi fattibilità, attesa media, attesa massima e tempo di calcolo. Le versioni salvate consentono di conservare i risultati dei tentativi.

**Interventi:** costruire un piccolo insieme di casi rappresentativi, separare punteggio e vincoli, poi provare ordini degli attori e assegnazioni dei professionisti diversi. Valutare un solver più complesso solo se i casi mostrano un beneficio che giustifica il costo.

**Verifica:** nessuna sovrapposizione o violazione dei vincoli obbligatori; risultati riproducibili; confronto numerico con l'algoritmo attuale sui casi concordati.

## 5. Collegamento futuro con Flash Suite

Le versioni esportate mantengono ID di piano, versione e attore, data del piano, READY e attività con inizio/fine. Questo prepara un adattatore per gli orari di preparazione dell'ordine del giorno. Il formato di scambio e l'eventuale ID attore di Flash Suite si definiscono quando è disponibile un esempio reale dei suoi dati; l'integrazione non blocca le fasi precedenti.

## Regola di rilascio

Ogni fase termina con build aggiornata, test automatici pertinenti, prova dell'interfaccia aperta con doppio clic e controllo di import/export quando il formato cambia. Le modifiche restano circoscritte alla fase: un risultato utilizzabile viene completato prima di iniziare la successiva.
