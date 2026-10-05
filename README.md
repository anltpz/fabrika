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
| `Boşluk` | Saldır |
| `Enter` | Sohbet (`/yardim`) |
| Fare tekerleği | Yakınlaştır / uzaklaştır |

**Oyun döngüsü**

1. Başlangıç bölgesindeki demir, bakır ve kireçtaşı düğümlerinden elle cevher topla, ağaç keserek yaprak ve odun al.
2. HUB'ın yanında envanterden (`Tab`) elle külçe, plaka ve çubuk üret.
3. HUB'a (`H`) teslimat yaparak kademe aç. Kademeler takımın ortak ilerlemesidir.
4. Maden çıkarıcıyı bir düğümün üzerine kur, bantları sürükleyerek çiz, fırın ve kurucularda tarif seç.
5. Biyokütle veya kömür jeneratörü ve elektrik direkleriyle güç ağı kur. Tüketim üretimi aşarsa sigorta atar; bir direkten veya jeneratörden sıfırlanır.
6. Böcek yuvalarından uzak dur ya da yuvaları yok et. Ölürsen eşyaların öldüğün yerde bir sandıkta kalır.
7. Altı kademeyi tamamlayıp **Fabrika Ustası** ol!

**Bina portları:** Önizlemede yeşil ok giriş, turuncu ok çıkıştır. Bant, girişe doğru bakmalıdır.

## İçerik

- **Kaynaklar:** demir/bakır cevheri, kireçtaşı, kömür (saf olmayan / normal / saf düğümler), ağaçlar
- **Parçalar:** külçeler, çelik, plaka, çubuk, vida, tel, kablo, beton, güçlendirilmiş plaka, rotor, modüler çerçeve, çelik kiriş/boru, stator, motor
- **Binalar:** HUB, Çalışma Tezgahı, Maden Çıkarıcı Mk1/Mk2, Eritme Fırını, Dökümhane, Kurucu, Montajcı, Biyokütle ve Kömür Jeneratörü, Elektrik Direği, Bant Mk1/Mk2, Ayırıcı, Birleştirici, Depo
- **Kademeler:** HUB Kurulumu → Temel Otomasyon → Montaj Hattı → Çelik Çağı → Endüstri → Fabrika Ustası

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

Hile modu (geliştirme): `CHEATS=1 npm start` ile sohbette `/ver <eşya|hepsi> <adet>`, `/kademe`, `/tp <x> <y>` komutları açılır.
Test botu: `npx tsx scripts/bot.ts <ODA_KODU>`
