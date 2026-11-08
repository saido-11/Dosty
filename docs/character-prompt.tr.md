# Dosty için karakter oluşturma promptu

[English](character-prompt.en.md) · [Türkçe README](../README.tr.md)

Aşağıdaki metni kopyalayıp görsel oluşturma destekli ChatGPT'ye yapıştırın. Köşeli parantezleri doldurun, varsa referans görsellerinizi ekleyin.

```text
Masaüstünde klavye ve fare hareketlerine tepki veren bir uygulama için tutarlı bir karakter görsel seti oluştur.

KARAKTERİM: [İstediğin karakteri veya görünüşünü buraya yaz.]
POZ SAYISI: [4 veya 5 seç. Varsayılan 4.]
ÇIKTI: [Ayrı PNG dosyaları veya 2×2 görsel seç. Varsayılan ayrı PNG.]

REFERANS GÖRSELLER
Karakterimin fotoğrafını veya çizimini eklediysem yüzünü, saçını, renklerini, kıyafetini ve ayırt edici özelliklerini temel al. Referans eklemediysem karakter tarifimi kullan.
İkinci bir görselde klavye ve fare başında örnek bir karakter varsa onu çizim tarzı, kadraj ve yerleşim referansı olarak kullan. Karakterimin kimliğini ilk görselden al.

GÖRÜNÜŞ VE YERLEŞİM
Özenli, sevimli ve zarif bir 2D chibi karakter çiz. Büyük baş, küçük üst gövde, temiz dış çizgiler ve yumuşak gölgelendirme kullan. Küçük boyutta da anlaşılır olsun.
Karakter önden görülsün. Yüzü ve iki eli veya patisi görünür olsun. Ağzı kapalı, ifadesi hafif gülümseyen olsun.
Klavye görüntünün sol ve orta ön bölümünde, fare görüntünün sağ ön bölümünde dursun. Görüntünün solundaki el klavyeyi, sağındaki el fareyi kullansın.
Karakter, klavye ve fare bütünüyle kadrajda kalsın. Tüm çevrede en az %5 boşluk bırak.

DOSYALAR VE POZLAR

1. idle.png — Gözler açık. Klavye eli tuşların hemen üzerinde, basmaya hazır şekilde hafifçe kalkık. Fare eli farenin üzerinde rahatça duruyor.
2. keyboard.png — Yalnızca klavye eli aşağı inmiş ve tuşa basıyor. Fare eli bekleme pozunda.
3. mouse.png — Klavye eli bekleme pozunda. Fare elinin parmağı veya patisi fare düğmesine basıyor.
4. both.png — Klavye eli ve fare eli aynı anda basıyor.
5. blink.png — Yalnızca 5 poz seçildiyse oluştur. idle.png ile aynı poz, gözler doğal biçimde kapalı.

HİZALAMA
Önce idle.png tasarımını oluştur ve diğer pozları aynı çizimin bölgesel düzenlemeleri olarak üret.
Her pozda tuval, kamera, ölçek, karakterin konumu, baş, gövde, saç, kıyafet, klavye ve fare aynı yerde kalsın. Yalnızca ilgili el, parmak, pati veya gözler değişsin.
El hareketleri küçük ama açıkça görülebilir olsun. Fare tıklaması gerçek bir parmak veya pati hareketiyle anlaşılsın.
Görseller arasında otomatik kırpma, yeniden ortalama veya yakınlaştırma yapma.

TEKNİK ÇIKTI
Ayrı dosyalar seçildiyse her pozu 1024×1024 piksel, gerçek alfa şeffaflığı olan ayrı PNG olarak üret. Dosyaların tuvalleri ve hizaları aynı olsun.
2×2 seçildiyse 2048×2048 piksel tek şeffaf PNG üret. Dört eşit 1024×1024 hücrenin sırası sol üst bekleme, sağ üst klavye, sol alt fare, sağ alt ikisi birlikte olsun. Beşinci poz isteniyorsa blink.png dosyasını ayrıca ver.
Tam ölçüyü veya ayrı dosyaları sağlayamıyorsan bunu belirt. Tek seferde bir görsel üretebiliyorsan önce idle pozunu üret ve kalan pozları aynı görseli düzenleyerek sırayla sürdür.

Arka plan tamamen şeffaf olsun. Dama deseni, düz renk fon, oda, masa yüzeyi, metin, etiket, filigran, panel çizgileri, hareket çizgileri veya tıklama efektleri ekleme. Şeffaf alanı görselin içine çizme.
```
