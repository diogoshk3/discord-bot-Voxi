# Resposta a incidentes de segurança — Vozen

Runbook acionável para suspeita de **acesso ou uso não autorizado de dados** (Dados da API
do Discord, base de dados, `.wav` de clones, `.env`). Os Termos de Desenvolvedor do Discord
(§5(c)) **obrigam** a notificar o Discord e os utilizadores afetados imediatamente, no limite
exigido pela lei.

## Se suspeitas de um incidente — pela ordem

1. **Conter (minutos).**
   - Rodar já os segredos expostos: `DISCORD_TOKEN` (Developer Portal → Bot → Reset Token),
     `KOFI_WEBHOOK_TOKEN` (Ko-fi → Webhooks), e qualquer outro em `.env`.
   - Se o VPS estiver comprometido: `sudo systemctl stop vozen.service`, revogar chaves SSH
     suspeitas em `~/.ssh/authorized_keys` (vozen **e** root), rever `ufw status` e `last`/
     `journalctl -u ssh`.
   - Não apagar logs — são prova.

2. **Avaliar o âmbito (o que foi acedido).**
   - Que dados? BD (`tts.db`: IDs de Discord, preferências, stats, hashes de email do Ko-fi),
     `.wav` de clones (**biométrico — o mais sensível**), `.env` (segredos).
   - Como? Cruzar horas: `journalctl` do sshd, acessos ao Caddy (`api.vozen.org`), tamanho/
     mtime da BD e da pasta de clones.
   - Quantos utilizadores? Estimar a partir das tabelas afetadas.

3. **Notificar (obrigatório, ToS §5(c)).**
   - **Discord:** reportar o acesso não autorizado a Dados da API pelos canais do Developer
     Portal / suporte de developers, com o âmbito conhecido.
   - **Utilizadores afetados:** aviso no servidor de suporte + na página do site, descrevendo
     o que aconteceu, que dados, e o que fazer. Se houver dados biométricos (clones) no
     âmbito, o aviso é prioritário.
   - Cumprir prazos legais de notificação de brecha aplicáveis (ex.: RGPD — 72h à autoridade
     de proteção de dados quando aplicável).

4. **Remediar e recuperar.**
   - Repor a partir de backup limpo se a BD foi adulterada; re-emitir todos os segredos.
   - Corrigir a via de entrada (fechar porta, endurecer config, atualizar dependências).
   - Reativar o serviço só depois de a causa estar fechada.

5. **Registar a cronologia** (deteção → contenção → notificação → remediação) para o
   pós-incidente e para prova.

## Reduzir o risco antes de acontecer (estado + plano)

- **Encriptação em repouso (ToS §5(c)).** O disco do VPS não é cifrado ao nível do volume
  (verificado: ext4 puro, sem LUKS). Estado:
  1. **Clones `.wav` (dado biométrico) — FEITO.** Cifrados com AES-256-GCM (`tts/cloneCrypto`);
     `CLONE_KEY` no `.env` de produção; round-trip verificado. Novos clones nascem cifrados.
  2. **BD SQLite — em defer.** Avaliar `better-sqlite3-multiple-ciphers` (SQLCipher) como
     substituto drop-in — **spike isolado primeiro**; a migração da BD de produção precisa de
     **backup + aprovação explícita do operador** (é o passo mais arriscado do plano).
  - **Caveat honesto:** com a chave (`CLONE_KEY`) no `.env` **na mesma máquina** que os
    dados, a cifra protege contra roubo do disco/backup, mas **não** contra quem já tem root
    (a chave está ao lado dos dados). É uma camada, não uma bala de prata.
- **Já feito:** SSH só-chave, ufw deny-in, `.env`/`authorized_keys` a 600, APIs em loopback
  atrás do Caddy, `timingSafeEqual` no webhook, token do Ko-fi rodado, segredos nunca em git.
