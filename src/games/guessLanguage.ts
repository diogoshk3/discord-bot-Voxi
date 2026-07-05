import { LOCALE_DISPLAY_NAMES } from '../i18n/index';
import type { GameContext, GameDefinition } from './types';
import { QuizGame, type QuizRound } from './quizGame';
import { LANGUAGE_PHRASES } from './content/languagePhrases';
import { baseCodeOf, localizedLanguageName, normalizeAnswer, seededShuffle } from './util';

/** Rondas por partida e tempo-limite de cada ronda. */
const ROUNDS = 5;
const ROUND_MS = 25_000;

interface Candidate {
  base: string;
  model: string;
  phrase: string;
}

/**
 * Linguas jogaveis: as que tem AO MESMO TEMPO uma voz instalada E uma frase. Uma
 * entrada por base (a 1a voz encontrada para essa lingua), preservando a ordem de
 * availableModels. PURA.
 */
export function guessableLanguages(availableModels: string[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const model of availableModels) {
    const base = baseCodeOf(model);
    if (seen.has(base)) continue;
    const phrase = LANGUAGE_PHRASES[base];
    if (!phrase) continue;
    seen.add(base);
    out.push({ base, model, phrase });
  }
  return out;
}

/**
 * Conjunto de respostas ACEITES para a lingua `base`, no `locale` da guild: o codigo
 * base ('de'), o autonimo ('Deutsch'), o nome no locale do servidor ('Alemão' num
 * servidor PT) e o nome em ingles ('German'). Tudo normalizado (sem acentos, minusc.)
 * para comparacao tolerante. PURA.
 */
export function acceptableAnswers(base: string, locale: string): Set<string> {
  const set = new Set<string>();
  const add = (s: string | undefined): void => {
    if (s) set.add(normalizeAnswer(s));
  };
  add(base);
  add((LOCALE_DISPLAY_NAMES as Record<string, string>)[base]); // autonimo, se suportado
  add(localizedLanguageName(base, locale)); // nome no locale da guild
  add(localizedLanguageName(base, 'en')); // nome em ingles
  add(localizedLanguageName(base, base)); // autonimo via ICU (cobre bases nao-suportadas)
  return set;
}

/**
 * "Adivinha a Lingua" — o Voxi le uma frase numa lingua aleatoria (das que tem voz
 * instalada) e o 1o a escrever o nome da lingua ganha o ponto. Best-of-5 rondas.
 * Assenta na base QuizGame (loop de rondas, timeout, placar, resumo final); aqui so
 * vive o CONTEUDO: escolher as linguas e reconhecer o nome da lingua.
 */
class GuessLanguageGame extends QuizGame {
  readonly id = 'guess-language';
  protected roundMs = ROUND_MS;
  private order: Candidate[] = [];
  private rounds = 0;

  protected prepare(ctx: GameContext): number {
    this.order = seededShuffle(guessableLanguages(ctx.availableModels), ctx.seed);
    this.rounds = Math.min(ROUNDS, this.order.length);
    return this.rounds;
  }

  protected emptyMessage(ctx: GameContext): string {
    return ctx.t('game.guessLanguage.noLanguages');
  }

  protected intro(ctx: GameContext, rounds: number): string {
    return ctx.t('game.guessLanguage.intro', { rounds });
  }

  protected makeRound(ctx: GameContext, index: number): QuizRound {
    const cand = this.order[index];
    const answers = acceptableAnswers(cand.base, ctx.locale);
    const language = localizedLanguageName(cand.base, ctx.locale);
    return {
      speak: { text: cand.phrase, opts: { model: cand.model } },
      announce: ctx.t('game.guessLanguage.round', { n: index + 1, total: this.rounds }),
      accept: (raw) => answers.has(normalizeAnswer(raw)),
      onCorrect: (user) => ctx.t('game.guessLanguage.correct', { user, language }),
      onTimeout: () => ctx.t('game.guessLanguage.timeout', { language }),
    };
  }
}

export const guessLanguageDef: GameDefinition = {
  id: 'guess-language',
  nameKey: 'game.guessLanguage.name',
  descKey: 'game.guessLanguage.desc',
  needsVoice: true,
  create: () => new GuessLanguageGame(),
};
