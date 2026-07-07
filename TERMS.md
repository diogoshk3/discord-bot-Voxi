# Termos de Serviço — Vozen

> _type it, hear it._

**Última atualização:** 2026-07-04

O Vozen é um bot de Text-to-Speech (TTS) para Discord, **open-source** e **self-host**: cada instância é corrida por um **operador** independente. Ao usar uma instância do Vozen, concordas com estes Termos. Como o software é self-host, o **operador da instância** é o responsável pelo seu funcionamento e pelo cumprimento das regras aplicáveis.

---

## 1. Uso aceitável

Ao usar o Vozen concordas em **não**:

- Usar o bot para **assédio**, intimidação, discurso de ódio ou para visar pessoas.
- Enviar **spam** ou abusar do serviço (ex.: contornar os limites de mensagens/caracteres, sobrecarregar a instância de propósito).
- Sintetizar ou difundir **conteúdo ilegal**, ou qualquer conteúdo que viole leis aplicáveis.
- Violar os [Termos de Serviço do Discord](https://discord.com/terms) ou as [Diretrizes da Comunidade do Discord](https://discord.com/guidelines).

O operador da instância e os administradores de cada servidor podem aplicar regras adicionais (blocklist, limites, restrição por role, kill-switch) e podem remover o acesso ao bot.

---

## 2. Sem garantias

O Vozen é fornecido **"tal como está" ("as is")**, sem garantias de qualquer tipo, expressas ou implícitas, incluindo (mas não limitado a) garantias de comerciabilidade, adequação a um fim específico, disponibilidade, ou ausência de erros. Sendo self-host, **não há qualquer garantia de disponibilidade (uptime)**, de qualidade da síntese de voz, nem de preservação de dados — o serviço depende inteiramente da instância que cada operador corre.

---

## 3. Limitação de responsabilidade

Na medida máxima permitida por lei, **os autores do projeto Vozen não são responsáveis** por quaisquer danos diretos, indiretos, incidentais ou consequentes resultantes do uso ou da impossibilidade de uso do software, nem pelo conteúdo gerado, processado ou difundido por qualquer instância. O **operador de cada instância** é o único responsável pela forma como a corre, pelos dados que processa e pelo cumprimento das leis e dos termos de terceiros (Discord e, se aplicável, OpenAI).

---

## 4. Responsabilidade do operador

Quem corre uma instância do Vozen (o **operador**) é responsável por:

- Cumprir os Termos de Serviço e a Política de Programador do Discord.
- Garantir o tratamento adequado dos dados que a instância guarda (ver [PRIVACY.md](PRIVACY.md)).
- Cumprir os termos de terceiros que ative — em particular os da **Google** se usar `TTS_ENGINE=gtts` ou `router` (o texto a ler é enviado ao Google Translate TTS), e os da **OpenAI** se usar `TTS_ENGINE=neural`.
- Disponibilizar um contacto e responder a pedidos razoáveis dos utilizadores sobre os seus dados.

---

## 5. Licença

O Vozen é software livre distribuído sob a licença **GNU AGPL-3.0** (ficheiro [`LICENSE`](LICENSE); declarada no campo `license` do `package.json`). O uso, cópia, modificação e distribuição do código-fonte regem-se por essa licença. Em particular, a AGPL exige que quem **corra uma versão modificada acessível pela rede** disponibilize o respetivo código-fonte aos utilizadores.

---

## 6. Alterações

Estes Termos podem ser atualizados. A versão em vigor é a presente neste repositório. O uso continuado do bot após alterações implica a aceitação dos novos Termos.

---

## Note (EN)

_Vozen is a self-hosted, open-source Discord TTS bot. Each instance is run by an independent operator. Acceptable use: no harassment, spam, or illegal content; respect Discord's Terms and Community Guidelines. The software is provided "as is" with no warranties (no uptime/quality/data guarantees). To the maximum extent permitted by law, the project authors are not liable for any damages or for content processed by any instance. The instance operator is solely responsible for running it lawfully, for the data it stores (see PRIVACY.md), and for complying with third-party terms (Discord; Google if `TTS_ENGINE=gtts`/`router`; OpenAI if `TTS_ENGINE=neural`). Licensed under GNU AGPL-3.0 (see LICENSE / package.json)._
