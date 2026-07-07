import { t } from '../i18n/index';
import type { GameDefinition } from './types';
import { guessLanguageDef } from './guessLanguage';
import { mathDef } from './math';
import { skipCountDef } from './skipCount';
import { spellingDef } from './spelling';
import { spellOutDef } from './spellOut';
import { fastSpeechDef } from './fastSpeech';
import { accentSwapDef } from './accentSwap';
import { reflexesDef } from './reflexes';
import { vozenSaysDef } from './vozenSays';
import { rouletteDef } from './roulette';
import { hangmanDef } from './hangman';
import { wordleDef } from './wordle';
import { tictactoeDef } from './tictactoe';
import { chessDef } from './chess';

/**
 * Registo de todos os minijogos do /game. Adicionar um jogo novo = criar o ficheiro
 * (com o seu GameDefinition) e acrescenta-lo aqui — o comando, o autocomplete e o
 * /game list derivam TUDO desta lista, por isso nada mais precisa de mudar.
 */
export const GAME_DEFS: readonly GameDefinition[] = [
  guessLanguageDef,
  mathDef,
  skipCountDef,
  spellingDef,
  spellOutDef,
  fastSpeechDef,
  accentSwapDef,
  reflexesDef,
  vozenSaysDef,
  rouletteDef,
  hangmanDef,
  wordleDef,
  tictactoeDef,
  chessDef,
];

/** Procura um jogo pelo id (o value do autocomplete). undefined se nao existir. */
export function gameById(id: string): GameDefinition | undefined {
  return GAME_DEFS.find((g) => g.id === id);
}

/**
 * Choices do autocomplete da opcao `game` do /game play: nome do jogo NA LINGUA do
 * utilizador (o `locale` do cliente Discord, via t()), value = id. Filtra pelo que o
 * utilizador escreve (case-insensitive, pelo nome traduzido OU pelo id), limitado a
 * 25 (cap do Discord). PURA/testavel. `locale` deve ja vir na forma base ('pt', 'fr').
 */
export function filterGameChoices(query: string, locale: string): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  return GAME_DEFS.map((g) => ({ name: t(g.nameKey, locale), value: g.id }))
    .filter((c) => c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
    .slice(0, 25);
}
