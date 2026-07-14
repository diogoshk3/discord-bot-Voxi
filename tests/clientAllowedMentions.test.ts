import { describe, it, expect } from 'vitest';
import { createClient } from '../src/bot/client';

// DISCORD-01 (auditoria de segurança): o Client tem de ter um default global
// allowedMentions:{parse:[]} — senão conteúdo postado pelo bot que ecoa texto do
// utilizador (jogos, /8ball, /randomizer) pode fazer o bot pingar <@id>/@everyone,
// que é um vetor de mass-mention e risco de ban da conta do bot.
describe('createClient — endurecimento anti mass-mention', () => {
  it('define allowedMentions a { parse: [] } por defeito (sem pings de @everyone/@here/role/user do conteúdo)', () => {
    const c = createClient();
    try {
      expect(c.options.allowedMentions).toEqual({ parse: [] });
    } finally {
      void c.destroy();
    }
  });
});
