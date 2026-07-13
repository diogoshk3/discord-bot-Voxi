# Proveniência dos clips de áudio (assets/sfx/)

Registo de origem + licença de cada WAV, para responder "de onde veio este som?"
(compliance — ver `docs/COMPLIANCE-VAGA5.md` · Soundboard). Regra: **só clips livres de
direitos**. Preferir CC0. Nunca commitar áudio de terceiros sem licença compatível
(o repo é AGPL-3.0 público).

## Soundboard (`/sound`)

Todos GERADOS por nós com `tools/gen-sfx.mjs` (tons sintéticos: sine/square/sawtooth +
envelopes). São obra própria → **sem direitos de terceiros / CC0**. Reproduzíveis com
`node tools/gen-sfx.mjs`. Cada chave bate com `src/content/sounds.ts` (o teste
`tests/sounds.test.ts` falha se divergir).

| Ficheiro           | Som                       | Origem                 | Licença            |
| ------------------ | ------------------------- | ---------------------- | ------------------ |
| `airhorn.wav`      | Air horn (2 buzinadas)    | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |
| `ding.wav`         | Ding (sino)               | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |
| `buzzer.wav`       | Buzzer de resposta errada | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |
| `tada.wav`         | Ta-da! (arpejo)           | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |
| `sad-trombone.wav` | Sad trombone (womp womp)  | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |
| `beep.wav`         | Beep                      | gerado (`gen-sfx.mjs`) | CC0 (obra própria) |

## Outros

| Ficheiro   | Uso               | Origem          | Licença |
| ---------- | ----------------- | --------------- | ------- |
| `rizz.wav` | Efeito do `/rizz` | (pré-existente) | —       |

> Ao adicionar um clip CC0 de terceiros (ex. freesound.org CC0): dropar o `.wav` aqui,
> registá-lo nesta tabela com a URL da fonte, e adicionar a entrada em
> `src/content/sounds.ts`. O teste de integridade confirma que registo ↔ ficheiro batem.
