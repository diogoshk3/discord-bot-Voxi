import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao e usado no /voice list, mas o import de
// index.ts resolve-o (mesmo padrao do commandsPreview.test.ts).
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import { formatVoiceList } from '../src/language/voiceMap';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import type Database from 'better-sqlite3';

const GUILD = 'g-list';
const USER = 'u-list';

function makeDeps(db: Database.Database, availableModels: string[]): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels,
    limiters: new Map(),
  } as unknown as BotDeps;
}

function makeListInteraction() {
  const replies: string[] = [];
  return {
    commandName: 'voice',
    guildId: GUILD,
    user: { id: USER },
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommandGroup: (_required = false) => null,
      getSubcommand: () => 'list',
      getString: () => null,
      getNumber: () => null,
    },
  };
}

describe('formatVoiceList (agrupamento por lingua)', () => {
  it('agrupa por lingua, com cabecalho amigavel e o id entre parenteses', () => {
    const out = formatVoiceList([
      'en_US-ryan-medium',
      'en_US-amy-medium',
      'pt_PT-tugao-medium',
    ]);
    // Um cabecalho por lingua (autonimo), vozes ordenadas por nome, id copy-pasteavel.
    expect(out).toBe(
      [
        'English (US)',
        '• Amy (en_US-amy-medium)',
        '• Ryan (en_US-ryan-medium)',
        'Português (Portugal)',
        '• Tugao (pt_PT-tugao-medium)',
      ].join('\n'),
    );
  });

  it('locale nao mapeado -> cabecalho cai no proprio locale (nunca esconde a voz)', () => {
    const out = formatVoiceList(['xx_YY-foo-medium']);
    expect(out).toContain('xx_YY');
    expect(out).toContain('(xx_YY-foo-medium)');
  });

  it('modelo sem 2.º segmento -> usa o id cru como nome da voz (guard)', () => {
    const out = formatVoiceList(['en_US']);
    expect(out).toContain('English (US)');
    expect(out).toContain('en_US');
  });
});

describe('/voice list (handler agrupado)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('responde com as vozes AGRUPADAS por lingua e nomes amigaveis', async () => {
    const deps = makeDeps(db, [
      'en_US-amy-medium',
      'en_US-ryan-medium',
      'pt_PT-tugao-medium',
    ]);
    const i = makeListInteraction();

    await handleInteraction(i as any, deps);

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    // Cabecalho i18n (en por defeito) + agrupamento por lingua com nomes humanos.
    expect(out).toContain('Available voices:');
    expect(out).toContain('English (US)');
    expect(out).toContain('Português (Portugal)');
    expect(out).toContain('Amy');
    expect(out).toContain('Tugao');
    // O id cru continua presente (copy-pasteavel para /voice set).
    expect(out).toContain('en_US-amy-medium');
    expect(out).toContain('pt_PT-tugao-medium');
  });

  it('sem modelos instalados responde a mensagem de lista vazia', async () => {
    const deps = makeDeps(db, []);
    const i = makeListInteraction();

    await handleInteraction(i as any, deps);

    expect(i.replies).toHaveLength(1);
    // t('voice.listEmpty', 'en') = '(none installed)'
    expect(i.replies[0]).toContain('none installed');
  });
});
