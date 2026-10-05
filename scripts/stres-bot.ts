/**
 * Fabrika stres test botu (terminal sürümü). Aynı botlar oyun içinden de çağrılabilir: Botlar paneli veya /bot komutu.
 *
 * Kullanım:
 *   npm start                                   (normal sunucu yeterli; botların kendi hileleri vardır)
 *   npx tsx scripts/stres-bot.ts [ODA_KODU] [--bot 2] [--sure 10] [--url ws://localhost:3000/ws]
 *
 * Not: Terminalden bağlanan botlar sunucunun gizli bot anahtarını bilmediği için sunucu CHEATS=1 ile açılmalıdır.
 */
import { BotRun, LogKind } from '../server/src/bot/stressBot';

// ---------------------------------------------------------------- argümanlar

const args = process.argv.slice(2);
function opt(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  // `npm run stres --bot 2` (veya PowerShell'in `--` işaretini yuttuğu durumlar) npm'in ayar değişkenine düşer
  const env = process.env[`npm_config_${name}`];
  if (env && env !== 'true') return env;
  return def;
}
/** Oda kodu 5 karakterlik büyük harf/rakamdır; diğer serbest argümanlar yok sayılır */
const ROOM = args.find((a, i) => /^[A-Za-z0-9]{5}$/.test(a) && !/^\d+$/.test(a) && !args[i - 1]?.startsWith('--'))?.toUpperCase();
const BOTS = Math.max(1, Math.min(4, parseInt(opt('bot', '1'), 10) || 1));
const MINUTES = Math.max(0.5, parseFloat(opt('sure', '10')) || 10);
const URL = opt('url', 'ws://localhost:3000/ws');

// ---------------------------------------------------------------- günlük

const C = { gray: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', mag: '\x1b[35m', bold: '\x1b[1m', off: '\x1b[0m' };
const BOT_COLORS: Record<string, string> = { Bot1: C.yellow, Bot2: C.cyan, Bot3: C.green, Bot4: C.mag };
const KIND: Record<LogKind, string> = { info: '', ok: C.green, warn: C.yellow, err: C.red };
const t0 = Date.now();
function stamp(): string {
  const s = Math.floor((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function log(who: string, msg: string, kind: LogKind) {
  console.log(`${C.gray}[${stamp()}]${C.off} ${BOT_COLORS[who] ?? ''}${who.padEnd(6)}${C.off} ${KIND[kind]}${msg}${C.off}`);
}

async function main() {
  console.log(`${C.bold}Fabrika stres botu${C.off} · ${BOTS} bot · ${MINUTES} dk · ${URL}`);
  const run = new BotRun({
    url: URL,
    count: BOTS,
    minutes: MINUTES,
    room: ROOM,
    log,
    onSummary: (line, warn) => console.log(`${C.gray}[${stamp()}]${C.off} ${warn ? C.red + '⚠ ' : C.bold}${line}${C.off}`),
  });
  try {
    const room = await run.connect(Array.from({ length: BOTS }, (_, i) => `Bot${i + 1}`));
    if (!ROOM) console.log(`${C.bold}Yeni dünya oluşturuldu. İzlemek için tarayıcıda oda kodu: ${room}${C.off}`);
  } catch (e) {
    console.error(`${C.red}Bağlanamadı: ${(e as Error).message}. Sunucu açık mı, oda kodu doğru mu, oda dolu mu?${C.off}`);
    process.exit(1);
  }
  const finish = () => {
    run.stop();
    const t = run.ctx.totals;
    const b0 = run.bots[0];
    console.log(`\n${C.bold}Bitti · ${stamp()} · modül ✔${t.modulesOk} ✘${t.modulesFail} · ${b0?.buildings.size ?? 0} yapı · ${b0?.trains ?? 0} tren${C.off}`);
    if (t.toasts.size) {
      console.log('Sunucu uyarıları:');
      for (const [msg, n] of [...t.toasts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} × ${msg}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', finish);
  await run.run();
  finish();
}

main();
