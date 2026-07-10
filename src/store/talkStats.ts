import type Database from 'better-sqlite3';

// "Tagarelas do servidor": conta quantas mensagens de cada pessoa o Vozen LEU (auto-read)
// por-(guild,user) e um STREAK de dias seguidos com pelo menos uma mensagem lida. Alimenta
// o /topspeakers. O streak baseia-se no dia LOCAL do servidor (chave 'YYYY-MM-DD').

export interface TalkRow {
  userId: string;
  count: number;
  streak: number;
  bestStreak: number;
}

interface DbRow {
  user_id: string;
  spoken_count: number;
  streak: number;
  best_streak: number;
  last_date: string;
}

/** Chave de dia LOCAL 'YYYY-MM-DD' de uma Date. PURA. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Chave do dia `n` dias ANTES de `d` (DST-safe: usa componentes, não subtração de ms). PURA. */
export function dayKeyMinus(d: Date, n: number): string {
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

/** Chave do dia ANTERIOR a `d` (DST-safe). PURA. */
export function prevDateKey(d: Date): string {
  return dayKeyMinus(d, 1);
}

/**
 * Streak VIVO no dia de referência `now` (regras estilo Duolingo). O `streak` guardado só
 * é atualizado quando a pessoa fala (`bumpTalk`), por isso entre mensagens fica ESTÁTICO —
 * esta função corrige-o para o valor REAL de hoje:
 *  - falou hoje, ontem OU anteontem (1 dia falhado, dentro do "freeze") => streak intacto;
 *  - 3+ dias sem falar (2 dias SEGUIDOS falhados) => 0 (perdido para sempre).
 * Simétrico do `bumpTalk`: este continua o streak para gaps <= 2 e reinicia para gaps >= 3.
 * PURA.
 */
export function effectiveStreak(lastDate: string, storedStreak: number, now: Date): number {
  const today = dateKey(now);
  const y1 = dayKeyMinus(now, 1);
  const y2 = dayKeyMinus(now, 2);
  return lastDate === today || lastDate === y1 || lastDate === y2 ? storedStreak : 0;
}

/** Resultado de `bumpTalk`: se esta foi a PRIMEIRA mensagem do dia (para o aviso de
 * streak 🔥) e o streak ATUAL de dias seguidos. */
export interface TalkBump {
  firstOfDay: boolean;
  streak: number;
}

/**
 * Regista UMA mensagem lida de `userId` no dia `now`: +1 na contagem e atualiza o streak
 * — mantém-se se já falou hoje, +1 se falou ontem, reinicia a 1 caso contrário. Atualiza
 * também o melhor streak. UPSERT (cria a linha na primeira mensagem). `now` injetável.
 * Devolve `{ firstOfDay, streak }` — o chamador usa-o para o aviso de streak (só na 1.ª
 * mensagem de cada dia).
 */
export function bumpTalk(
  db: Database.Database,
  guildId: string,
  userId: string,
  now: Date,
): TalkBump {
  const today = dateKey(now);
  const y1 = dayKeyMinus(now, 1); // ontem
  const y2 = dayKeyMinus(now, 2); // anteontem (== 1 dia falhado -> freeze)
  const row = db
    .prepare(
      'SELECT spoken_count, streak, best_streak, last_date FROM talk_stats WHERE guild_id = ? AND user_id = ?',
    )
    .get(guildId, userId) as Omit<DbRow, 'user_id'> | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO talk_stats (guild_id, user_id, spoken_count, streak, best_streak, last_date)
       VALUES (?, ?, 1, 1, 1, ?)`,
    ).run(guildId, userId, today);
    return { firstOfDay: true, streak: 1 };
  }

  // firstOfDay = ainda não tinha falado HOJE (a última mensagem é de outro dia).
  const firstOfDay = row.last_date !== today;
  // Regras Duolingo: falhar 1 dia NÃO parte o streak (freeze — o dia falhado não conta,
  // mas o de hoje soma +1); falhar 2 dias SEGUIDOS (gap >= 3) perde tudo -> recomeça a 1.
  let streak: number;
  if (row.last_date === today)
    streak = row.streak; // já contou hoje
  else if (row.last_date === y1 || row.last_date === y2)
    streak = row.streak + 1; // dia seguido OU 1 dia falhado (freeze) -> continua
  else streak = 1; // 2+ dias seguidos falhados (ou datas do futuro) -> perde
  const best = Math.max(row.best_streak, streak);

  db.prepare(
    `UPDATE talk_stats
     SET spoken_count = spoken_count + 1, streak = ?, best_streak = ?, last_date = ?
     WHERE guild_id = ? AND user_id = ?`,
  ).run(streak, best, today, guildId, userId);
  return { firstOfDay, streak };
}

/**
 * Top `limit` do leaderboard de STREAKS desta guild: ranqueado por DIAS de streak VIVO
 * (`effectiveStreak` em `now`) desc, desempate por contagem de mensagens desc. Um streak
 * MORTO (3+ dias sem falar) conta como 0 e afunda — o leaderboard mostra o standing ATUAL,
 * não valores obsoletos. Busca todas as linhas da guild e ordena em JS (o streak vivo
 * depende de `now`, não dá para ordenar em SQL). `now` injetável para testes.
 */
export function getTopSpeakers(
  db: Database.Database,
  guildId: string,
  now: Date,
  limit = 10,
): TalkRow[] {
  const rows = db
    .prepare(
      `SELECT user_id, spoken_count, streak, best_streak, last_date FROM talk_stats
       WHERE guild_id = ?`,
    )
    .all(guildId) as DbRow[];
  return rows
    .map((r) => ({
      userId: r.user_id,
      count: r.spoken_count,
      streak: effectiveStreak(r.last_date, r.streak, now),
      bestStreak: r.best_streak,
    }))
    .sort((a, b) => b.streak - a.streak || b.count - a.count)
    .slice(0, limit);
}
