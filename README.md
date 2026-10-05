# Fabrika

Tarayıcıda oynanan, 4 kişilik, Satisfactory benzeri ortak üretim hattı oyunu.
2D kuşbakışı grid, yetkili (authoritative) Node.js sunucu, WebSocket ile gerçek zamanlı çok oyunculu.

## Hızlı başlangıç

### Docker ile (önerilen)

```bash
cd fabrika
docker compose up -d --build
```

Tarayıcıda `http://localhost:3000` adresini aç. Dünyalar `fabrika-saves` volume'unda saklanır.

### Node.js ile

Node.js **22.5+** gerekir (yerleşik `node:sqlite` kullanılır).

```bash
cd fabrika
npm install
npm run build
npm start            # http://localhost:3000
```

Geliştirme modu (iki terminal):

```bash
npm run dev:server   # sunucu, kod değişince yeniden başlar (port 3000)
npm run dev:client   # Vite, http://localhost:5173 (WebSocket'i 3000'e yönlendirir)
```

### Arkadaşlarla oynamak

1. Sunucuyu çalıştıran kişi oyunu açar ve **Yeni Dünya Oluştur**'a basar. Sol üstte 5 haneli **oda kodu** görünür (tıklayınca kopyalanır).
2. Arkadaşlar aynı adrese girip kodu yazar ve **Katıl**'a basar.
   - Aynı ağdaysanız: `http://<bilgisayarın-yerel-IP>:3000`
   - İnternet üzerinden: `ngrok http 3000` veya `cloudflared tunnel --url http://localhost:3000` ile çıkan linki paylaşın.
3. Bir odada aynı anda en fazla 4 oyuncu olur. Tarayıcı karakterini hatırlar; çıkıp tekrar girdiğinde envanterin ve konumun yerinde olur.
4. Dünya her 60 saniyede bir ve son oyuncu çıktığında otomatik kaydedilir. Odada kimse yokken oyun durur.

## Nasıl oynanır

| Tuş | İşlev |
| --- | --- |
| `WASD` / oklar | Hareket |
| `E` (basılı tut) | Cevher topla, ağaç kes, yakındaki binayı aç |
| Sol tık | Bina aç / topla / saldır · inşa modunda yerleştir |
| Sağ tık / `Esc` | Modu iptal et / paneli kapat |
| `Q` | İnşa menüsü |
| `1`–`9` | Hızlı inşa çubuğu |
| `R` (`Shift+R`) | Döndür |
| `F` | Söküm modu (malzemeler iade edilir) |
| `Tab` / `I` | Envanter ve elle üretim |
| `H` | HUB kademeleri |
| `P` | Üretim istatistikleri ve darboğazlar |
| `B` | Plan (blueprint) kütüphanesi |
| `M` | Büyük harita ve işaretler |
| `G` | Farenin olduğu yere ping at |
| `Boşluk` | Saldır |
| `Enter` | Sohbet (`/yardim`) |
| Fare tekerleği | Yakınlaştır / uzaklaştır |

**Oyun döngüsü**

1. Başlangıç bölgesindeki demir, bakır ve kireçtaşı düğümlerinden elle cevher topla, ağaç keserek yaprak ve odun al.
2. HUB'ın yanında envanterden (`Tab`) elle külçe, plaka ve çubuk üret.
3. HUB'a (`H`) teslimat yaparak kademe aç. Kademeler takımın ortak ilerlemesidir.
4. Maden çıkarıcıyı bir düğümün üzerine kur, bantları sürükleyerek çiz, fırın ve kurucularda tarif seç.
5. Biyokütle veya kömür jeneratörü ve elektrik direkleriyle güç ağı kur. Tüketim üretimi aşarsa sigorta atar; bir direkten veya jeneratörden sıfırlanır.
6. Haritayı keşfet: sis yürüdükçe açılır, düşmüş kargolardan değerli parçalar çıkar, kükürt/kuvars/boksit/petrol düğümleri uzaklardadır. Patlayıcıyla kayalık alanları açabilirsin.
7. Petrol Çağı'nda borularla su ve petrol taşı, rafineride plastik/kauçuk/yakıt üret.
8. Lojistik Ağı'nda raylar döşe, istasyonları Yükle/Boşalt moduna al ve trenlerle uzak bölgeleri bağla.
9. Böcek yuvalarından uzak dur ya da yuvaları yok et. Ölürsen eşyaların öldüğün yerde bir sandıkta kalır.
10. Dokuz kademeyi tamamlayıp **Fabrika Ustası** ol!

**Bina portları:** Önizlemede yeşil ok giriş, turuncu ok çıkıştır. Bant, girişe doğru bakmalıdır. Mavi daireler sıvı portlarıdır (boru bağlanır).

**Takım araçları:**
- **Planlar (B):** Bir alanı seçip kaydet; takımın herkesi planı döndürerek tek tıkla kurabilir. Tarifler ve filtreler de kopyalanır.
- **İstatistik (P):** Eşya başına dakikalık üretim/tüketim, makine verimi ve "girdi yetersiz / çıkış dolu / enerji yok" uyarıları.
- **Harita (M) ve ping (G):** Haritaya ikonlu işaret koy, takım arkadaşlarına bir yeri göster.

**Lojistik ipuçları:**
- **Alt Geçit:** Giriş ve aynı yöne bakan çıkış arasında 5 tile'a kadar eşyalar engellerin altından geçer.
- **Akıllı Ayırıcı:** Her çıkışa belirli eşya, herhangi, tanımsız diğerleri, taşma veya kapalı filtresi verilir.
- **Bant, ray ve boru** sürükleyerek çizilir.

## İçerik

- **Kaynaklar:** demir/bakır cevheri, kireçtaşı, kömür, kükürt, kuvars, boksit, ham petrol, su (saf olmayan / normal / saf düğümler), ağaçlar
- **Parçalar:** külçeler, çelik, alüminyum, plaka, çubuk, vida, tel, kablo, beton, güçlendirilmiş plaka, rotor, modüler çerçeve, çelik kiriş/boru, stator, motor, siyah barut, patlayıcı, kuvars kristali, silika, plastik, kauçuk, devre kartı, bilgisayar
- **Binalar:** HUB, Çalışma Tezgahı, Maden Çıkarıcı Mk1/Mk2, Eritme Fırını, Dökümhane, Kurucu, Montajcı, Rafineri, Biyokütle/Kömür/Yakıt Jeneratörü, Elektrik Direği, Bant Mk1/Mk2, Alt Geçit, Ayırıcı, Akıllı Ayırıcı, Birleştirici, Depo, Su Çıkarıcı, Petrol Kuyusu, Boru, Sıvı Deposu, Tren Rayı, Tren İstasyonu, Lokomotif
- **Kademeler:** HUB Kurulumu → Temel Otomasyon → Montaj Hattı → Çelik Çağı → Endüstri → Petrol Çağı → Lojistik Ağı → Yüksek Teknoloji → Fabrika Ustası

Tüm veriler `shared/src/` altında (`items.ts`, `recipes.ts`, `buildings.ts`, `milestones.ts`). Yeni içerik eklemek için bu dosyalar düzenlenir.

## Mimari

```
fabrika/
  shared/   ortak veri ve mantık: eşyalar, tarifler, binalar, kademeler, harita üretimi, protokol
  server/   Node.js + ws: oda yönetimi, 20 TPS simülasyon, SQLite kayıt
  client/   Vite + PixiJS: çizim, arayüz (DOM), girdi, istemci tarafı hareket tahmini
  scripts/  bot.ts: test için otomatik üretim hattı kuran bot
```

- Sunucu tek doğruluk kaynağıdır. İstemci yalnızca girdi gönderir; sunucu doğrular ve değişiklikleri yayınlar.
- Harita seed'den deterministik üretilir; istemci de aynı haritayı kendisi üretir, bu yüzden ağ üzerinden harita gönderilmez.
- Kendi karakterinin hareketi istemcide tahmin edilir ve sunucu konumuyla uzlaştırılır.

### Görseller

Grafikler şu an kodla çiziliyor. Üretilmiş sprite'lar `client/public/sprites/items/<eşya_id>.png` olarak eklenebilir ve
`client/public/sprites/manifest.json` içine `{"items": ["iron_plate", ...]}` şeklinde listelenirse arayüz ikonları otomatik olarak bunlarla değişir.

## Test

```bash
npm test          # simülasyon testleri (Vitest)
npm run typecheck
```

### Stres test botu

Sunucuyu hileler açık ve istersen hızlandırılmış başlat (`GAME_SPEED` 1–4; tüm simülasyon o kadar hızlı akar):

```bash
CHEATS=1 GAME_SPEED=2 npm start          # Windows PowerShell: $env:CHEATS=1; $env:GAME_SPEED=2; npm start
npm run stres -- --bot 2 --sure 10      # yeni dünya oluşturur ve oda kodunu yazar
npm run stres -- ABCDE --bot 3          # var olan odaya katılır (tarayıcıdan izleyebilirsin)
```

Parametreler: `--bot` 1–4 bot, `--sure` dakika, `--url` sunucu adresi.
Botlar tüm kademeleri açar ve döngü halinde maden hatları, akıllı ayırıcı/alt geçitli üretim hücreleri, plan kopyaları,
petrol/su hatları ve tren hatları kurar; işaret, ping, sohbet, kargo, yuva saldırısı ve sök/yeniden kur ile sunucuyu zorlar.
Konsola her adımı ve 5 saniyede bir özet yazar: yapı/bant/tren sayısı, sunucu tick hızı (beklenen `20 × GAME_SPEED`),
en uzun tick boşluğu, gelen veri (KB/sn), ping ve başarılı/başarısız modül sayısı. Tick hızı düşerse ⚠ ile uyarır.

Hile modu (geliştirme): `CHEATS=1 npm start` ile sohbette `/ver <eşya|hepsi> <adet>`, `/kademe`, `/tp <x> <y>` komutları açılır.
Test botu: `npx tsx scripts/bot.ts <ODA_KODU>`
