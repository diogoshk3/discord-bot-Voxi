// src/games/wordChain.ts
//
// 15.º minijogo: CADEIA DE PALAVRAS (inspirado no "Finish The Word" do Roblox).
// Por turnos em ordem fixa, 2 vidas, UMA língua por partida (escolhida no /game play).
// O Vozen dá as boas-vindas na língua da partida, LÊ cada palavra aceite em voz alta e
// anuncia a letra seguinte. As regras da cadeia vivem no núcleo puro (wordchain/core).

import type { Game, GameContext, GameDefinition, GameMessage, GameStartOptions } from './types';
import {
  ChainEngine,
  WORDCHAIN_LANGS,
  type Dictionary,
  type WordChainLang,
  type ValidationReason,
} from './wordchain/core';
import { loadDictionary } from './wordchain/dict';
import { pickVoice } from '../language/voiceMap';

const LOBBY_MS = 20000;
const LIVES = 2;
const WIN_BONUS = 3;

/** Nome amigável da língua (autónimo) para as mensagens de texto. */
const LANG_NAME: Record<WordChainLang, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

/** Boas-vindas FALADAS, na língua da partida (lidas com a voz nativa). */
const WELCOME: Record<WordChainLang, string> = {
  pt: 'Bem-vindos ao jogo da cadeia de palavras!',
  en: 'Welcome to the word chain game!',
  es: '¡Bienvenidos al juego de la cadena de palabras!',
  fr: 'Bienvenue au jeu de la chaîne de mots !',
};

function resolveLang(input?: string): WordChainLang {
  const l = (input ?? '').toLowerCase();
  return (WORDCHAIN_LANGS as readonly string[]).includes(l) ? (l as WordChainLang) : 'en';
}

/** pickVoice espera ISO 639-3 (LANG_TO_PREFIX usa 'por'/'eng'/…), não 2 letras. */
const ISO3: Record<WordChainLang, string> = { pt: 'por', en: 'eng', es: 'spa', fr: 'fra' };

/** Chave i18n do feedback de uma tentativa inválida. */
function badKey(reason: ValidationReason): string {
  switch (reason) {
    case 'wrong-letter':
      return 'game.wordChain.bad.letter';
    case 'too-short':
      return 'game.wordChain.bad.short';
    case 'repeated':
      return 'game.wordChain.bad.repeated';
    case 'not-a-word':
      return 'game.wordChain.bad.word';
    default:
      return 'game.wordChain.bad.latin'; // not-latin / vazio
  }
}

class WordChainGame implements Game {
  readonly id = 'word-chain';
  private readonly lang: WordChainLang;
  private dict: Dictionary | null = null;
  private engine: ChainEngine | null = null;
  private phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  private readonly order: string[] = []; // userIds VIVOS, por ordem de turno
  private readonly names = new Map<string, string>();
  private readonly lives = new Map<string, number>();
  private idx = 0; // índice do jogador atual em `order`
  private turnGen = 0; // geração do turno: um timer de turno obsoleto (gen != atual) é no-op

  constructor(opts?: GameStartOptions) {
    this.lang = resolveLang(opts?.language);
  }

  async start(ctx: GameContext): Promise<void> {
    this.dict = loadDictionary(this.lang);
    if (!this.dict) {
      await ctx.send(ctx.t('game.wordChain.unavailable', { lang: LANG_NAME[this.lang] }));
      ctx.end();
      return;
    }
    await ctx.send(
      ctx.t('game.wordChain.lobby', { lang: LANG_NAME[this.lang], seconds: LOBBY_MS / 1000 }),
    );
    ctx.after(LOBBY_MS, () => this.beginPlay(ctx));
  }

  async onMessage(ctx: GameContext, msg: GameMessage): Promise<void> {
    if (this.phase === 'lobby') {
      this.join(msg);
      return;
    }
    if (this.phase !== 'playing') return;
    // Só a mensagem do jogador ATUAL conta; espectadores são ignorados (turnos limpos).
    if (msg.authorId !== this.order[this.idx]) return;
    await this.handleGuess(ctx, msg);
  }

  private join(msg: GameMessage): void {
    if (this.names.has(msg.authorId)) return;
    this.names.set(msg.authorId, msg.authorName);
    this.lives.set(msg.authorId, LIVES);
    this.order.push(msg.authorId);
  }

  private voiceModel(ctx: GameContext): string {
    return pickVoice(ISO3[this.lang], ctx.availableModels, ctx.defaultVoice);
  }

  private beginPlay(ctx: GameContext): void {
    if (this.phase !== 'lobby') return;
    if (this.order.length < 2) {
      void ctx.send(ctx.t('game.wordChain.notEnough'));
      ctx.end();
      return;
    }
    this.phase = 'playing';
    this.engine = new ChainEngine(this.dict!, ctx.seed);
    // Boas-vindas faladas na língua da partida (voz nativa).
    void ctx.say(WELCOME[this.lang], { model: this.voiceModel(ctx) });
    const roster = this.order.map((id) => this.names.get(id)).join(', ');
    void ctx.send(ctx.t('game.wordChain.begin', { players: roster, lang: LANG_NAME[this.lang] }));
    this.announceTurn(ctx);
  }

  /** Anuncia o turno atual e arma o timer (com guarda de geração). */
  private announceTurn(ctx: GameContext): void {
    const gen = ++this.turnGen;
    const id = this.order[this.idx];
    const e = this.engine!;
    void ctx.send(
      ctx.t('game.wordChain.turn', {
        name: this.names.get(id) ?? '?',
        letter: e.requiredLetter.toUpperCase(),
        hearts: '❤️'.repeat(this.lives.get(id) ?? 0),
        seconds: Math.round(e.turnMs / 1000),
      }),
    );
    ctx.after(e.turnMs, () => {
      if (this.turnGen === gen && this.phase === 'playing') this.onTimeout(ctx);
    });
  }

  private async handleGuess(ctx: GameContext, msg: GameMessage): Promise<void> {
    const e = this.engine!;
    const res = e.validate(msg.content);
    if (!res.ok) {
      // Tentativa inválida: feedback, MAS o timer continua a correr (tentativas
      // ilimitadas dentro do turno) — não re-armamos nem avançamos.
      await ctx.send(
        ctx.t(badKey(res.reason), { letter: e.requiredLetter.toUpperCase(), min: e.minLength }),
      );
      return;
    }
    e.accept(res.normalized);
    ctx.award(msg.authorId, 1);
    // Lê a palavra aceite em voz alta (voz da língua) — o coração do jogo no Vozen.
    void ctx.say(res.normalized, { model: this.voiceModel(ctx) });
    await ctx.send(
      ctx.t('game.wordChain.accepted', {
        word: res.normalized,
        letter: e.requiredLetter.toUpperCase(),
      }),
    );
    // Próximo jogador (bumpa turnGen -> o timer do turno anterior fica obsoleto).
    this.idx = (this.idx + 1) % this.order.length;
    this.announceTurn(ctx);
  }

  private onTimeout(ctx: GameContext): void {
    const id = this.order[this.idx];
    const left = (this.lives.get(id) ?? 1) - 1;
    this.lives.set(id, left);
    if (left <= 0) {
      void ctx.send(ctx.t('game.wordChain.eliminated', { name: this.names.get(id) ?? '?' }));
      this.order.splice(this.idx, 1); // remove o atual; o próximo passa a ocupar `idx`
      this.lives.delete(id);
      if (this.order.length === 1) {
        this.declareWinner(ctx);
        return;
      }
      if (this.idx >= this.order.length) this.idx = 0; // wrap
    } else {
      void ctx.send(
        ctx.t('game.wordChain.timeout', {
          name: this.names.get(id) ?? '?',
          hearts: '❤️'.repeat(left),
        }),
      );
      this.idx = (this.idx + 1) % this.order.length;
    }
    this.announceTurn(ctx);
  }

  private declareWinner(ctx: GameContext): void {
    this.phase = 'ended';
    const id = this.order[0];
    ctx.award(id, WIN_BONUS);
    void ctx.send(
      ctx.t('game.wordChain.winner', {
        name: this.names.get(id) ?? '?',
        chain: this.engine?.chainLength ?? 0,
      }),
    );
    ctx.end();
  }
}

export const wordChainDef: GameDefinition = {
  id: 'word-chain',
  nameKey: 'game.wordChain.name',
  descKey: 'game.wordChain.descr',
  needsVoice: false, // a voz é um BÓNUS; o jogo funciona só em texto se não houver call
  premium: true, // 💎 Premium (Plus do próprio OU Premium do servidor) — gate em handleGame
  usesLanguage: true,
  create: (opts) => new WordChainGame(opts),
};
