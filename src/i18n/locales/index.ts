/**
 * Registry de ficheiros de traducao POR-LOCALE (arquitetura para 34 linguas).
 *
 * Porque nao inline no catalog.ts? Com 34 linguas × 137 chaves seriam milhares de
 * linhas num so ficheiro. Em vez disso:
 *  - `catalog.ts` continua a ser a BASE: `en` (fonte de verdade) + `pt` inline.
 *  - Cada OUTRA lingua vive em `src/i18n/locales/<code>.ts`, exportando um
 *    `Record<string, string>` (chave -> traducao). Fica isolada e revisavel.
 *
 * Este `locales` e o LOADER: um mapa ESTATICO `locale -> traducoes`. Nao usamos
 * `fs.readdir`/`import()` dinamico de proposito. O `t()` (em ../index) consulta
 * este mapa PRIMEIRO na sua cadeia de resolucao.
 *
 * FASE B: as 32 linguas de voz (alem de en/pt inline) estao aqui registadas.
 * Adicionar/rever uma lingua: editar o respetivo `locales/<code>.ts`.
 */
import ar from './ar';
import ca from './ca';
import cs from './cs';
import cy from './cy';
import da from './da';
import de from './de';
import el from './el';
import es from './es';
import fa from './fa';
import fi from './fi';
import fr from './fr';
import hu from './hu';
import is from './is';
import it from './it';
import ka from './ka';
import kk from './kk';
import lb from './lb';
import lv from './lv';
import ne from './ne';
import nl from './nl';
import pl from './pl';
import ro from './ro';
import ru from './ru';
import sk from './sk';
import sl from './sl';
import sr from './sr';
import sv from './sv';
import sw from './sw';
import tr from './tr';
import uk from './uk';
import vi from './vi';
import zh from './zh';

export const locales: Record<string, Record<string, string>> = {
  ar, ca, cs, cy, da, de, el, es, fa, fi, fr, hu, is, it, ka, kk,
  lb, lv, ne, nl, pl, ro, ru, sk, sl, sr, sv, sw, tr, uk, vi, zh,
};
