/**
 * Botların "beyni": sıradaki görevi seçer.
 *
 * TYPESAFE_API_KEY tanımlıysa kararı TypeSafe'in Jev modeline sorar (tek bir Choice sorusu). Kod kontrolü elinde tutar:
 * hangi görevlerin seçilebileceğine, düşük güvende ne yapılacağına ve görevlerin nasıl yürütüleceğine kod karar verir.
 * Anahtar yoksa ya da çağrı başarısız olursa kural tabanlı seçime döner.
 */
import { choice, TypeSafeClient } from '@typesafe-ai/sdk';

export const TASKS = {
  maden_hatti: 'Bir kaynak düğümüne maden çıkarıcı, bant, eritme fırını, depo ve elektrik kurarak yeni bir hammadde hattı açmak',
  uretim_hucresi: 'Akıllı ayırıcı, alt geçit, birleştirici ve kurucudan oluşan bir üretim hücresi kurup plan olarak kaydetmek',
  plan_stresi: 'Kayıtlı bir üretim hücresi planını döndürerek birkaç kez kopyalayıp fabrikayı hızla büyütmek',
  sivi_hatti: 'Petrol kuyusu, boru, rafineri ve yakıt jeneratöründen oluşan bir sıvı hattı kurmak',
  tren_hatti: 'İki istasyon, kavisli ray ve lokomotiften oluşan bir tren hattı kurup eşya taşıtmak',
  enerji_onarimi: 'Elektrik sorunlarını gidermek: yakıtı biten jeneratörlere yakıt koymak, sigortası atan ağlara jeneratör ekleyip sigortayı sıfırlamak',
  darbogaz_onarimi: 'İstatistikteki darboğazları gidermek: girdisi boş kalan üretim hücresi depolarına girdi koymak, çıkışı tıkanan maden hatlarına ayırıcı ve ek işleme makinesi ekleyerek hattı dengelemek',
  etkilesim: 'Harita işareti, ping, sohbet, elle üretim, kargo açma ve böcek yuvasına saldırı gibi oyuncu etkileşimlerini denemek',
  calkalama: 'Kurulu yapıları söküp yeniden kurarak ve tarif değiştirerek sunucunun durum senkronunu zorlamak',
} as const;

export type TaskId = keyof typeof TASKS;
export const TASK_IDS = Object.keys(TASKS) as TaskId[];

export const TASK_NAMES: Record<TaskId, string> = {
  maden_hatti: 'maden hattı',
  uretim_hucresi: 'üretim hücresi',
  plan_stresi: 'plan stresi',
  sivi_hatti: 'sıvı hattı',
  tren_hatti: 'tren hattı',
  enerji_onarimi: 'enerji onarımı',
  darbogaz_onarimi: 'darboğaz onarımı',
  etkilesim: 'etkileşim',
  calkalama: 'çalkalama',
};

export interface Decision {
  task: TaskId;
  source: 'jev' | 'kural';
  confidence?: number;
  probability?: number;
  ms?: number;
  /** Jev cevap verdi ama güveni eşik altında kaldı */
  lowConfidence?: boolean;
  error?: string;
}

/** Jev'in seçimine güvenmek için gereken en düşük güven (altındaysa kural tabanlı seçim) */
const MIN_CONFIDENCE = 0.3;

export class Brain {
  private client?: TypeSafeClient;
  calls = 0;
  failures = 0;
  totalMs = 0;
  tokens = 0;
  private disabledUntil = 0;

  constructor() {
    if (process.env.TYPESAFE_API_KEY) this.client = new TypeSafeClient({ timeout: 8000 });
  }

  get mode(): 'jev' | 'kural' {
    return this.client ? 'jev' : 'kural';
  }

  /** Sıradaki görev; `allowed` kod tarafından süzülmüş seçenekler, `fallback` kural tabanlı tercih */
  async decide(state: Record<string, unknown>, allowed: TaskId[], fallback: TaskId): Promise<Decision> {
    if (!this.client || allowed.length < 2 || Date.now() < this.disabledUntil) return { task: fallback, source: 'kural' };
    const criteria: Record<string, string> = {};
    for (const id of allowed) criteria[id] = TASKS[id];
    const t0 = Date.now();
    try {
      const res = await this.client.systemOne({
        state: state as never,
        questions: {
          next: choice(
            'Bu bot, çok oyunculu bir fabrika kurma oyununu test eden ve fabrikayı büyüten bir yardımcıdır. ' +
              '`fabrika`, `sorunlar`, `elektrik`, `darbogazlar`, `uretim_acigi` ve `son_gorevler` alanlarındaki duruma bakarak sıradaki en faydalı görev hangisi? ' +
              'Önce çalışmayı engelleyen sorunlar (sigorta, yakıt, enerji) giderilmeli, sonra darboğazlar (girdisi boş hücreler, tıkanan hatlar); yakın zamanda başarısız olan veya az önce yapılan görevlerin tekrarı daha az faydalıdır; ' +
              'henüz hiç denenmemiş sistemleri (sıvı, tren, plan) denemek test için değerlidir.',
            criteria,
          ),
        },
      });
      const ms = Date.now() - t0;
      this.calls++;
      this.totalMs += ms;
      this.tokens += res.usage.input_tokens;
      const ans = res.answers.next;
      const task = ans.choice as TaskId;
      const probability = (ans.probabilities as Record<string, number>)[task];
      if (ans.confidence < MIN_CONFIDENCE || !allowed.includes(task)) {
        return { task: fallback, source: 'kural', confidence: ans.confidence, probability, ms, lowConfidence: true };
      }
      return { task, source: 'jev', confidence: ans.confidence, probability, ms };
    } catch (e) {
      this.failures++;
      // Art arda hatada bir süre Jev'i sorma (ör. ağ yok, kota doldu)
      if (this.failures % 3 === 0) this.disabledUntil = Date.now() + 60_000;
      return { task: fallback, source: 'kural', error: (e as Error).message, ms: Date.now() - t0 };
    }
  }

  stats(): string {
    if (!this.client) return 'beyin: kural';
    const avg = this.calls ? Math.round(this.totalMs / this.calls) : 0;
    return `beyin: Jev (${this.calls} karar, ort. ${avg} ms, ${this.tokens} token${this.failures ? `, ${this.failures} hata` : ''})`;
  }
}
