# Windows acceptance / Windows kullanıcı denemesi

[English README](../README.md) · [Türkçe README](../README.tr.md)

## English

Automated checks and Win32 hook registration do not replace a real desktop test.
Use a Windows x64 computer and a blank local Notepad document. Do not type into
Discord or send messages as part of this test.

1. Open the setup installer or portable package, launch Dosty and select **Mor Kedi (Purple Cat)**.
2. Focus Notepad. Hold W for two seconds: expect one strike. While holding W, press
   A once: expect a new strike. Release both.
3. Type rapidly, then stop: the animation should return to idle without a queue.
4. Press a key while left-clicking, then right-clicking: both hands should work.
5. Hold the visible desktop character and drag, without opening its controls or
   enabling move mode. Release it and restart Dosty: the position should persist.
6. Click the character over another window: ordinary clicks should reach that
   window. The underlying window may also receive a drag; click-through is retained.
7. Check a fullscreen app or game separately. Exclusive fullscreen, protected
   desktops and some games may prevent capture or overlay visibility.
8. Optionally import four PNGs or a 2×2 sheet and add a blink PNG. Restart Dosty;
   the character should remain available even after removing the source images.

When reporting a failure, include the Dosty version, Windows version, setup versus
portable package and the failing step. Do not include private typed text or artwork.

## Türkçe

Otomatik kontroller ve Win32 giriş kancalarının başlaması gerçek masaüstü denemesinin
yerini tutmaz. Windows x64 bilgisayarda boş bir yerel Not Defteri belgesi kullanın.
Deneme sırasında Discord'a yazmayın veya mesaj göndermeyin.

1. Kurulum dosyasını veya taşınabilir paketi açın; Dosty'de Mor Kedi'yi seçin.
2. Not Defteri'ni öne alın. W'yi iki saniye tutun: tek vuruş olmalı. W basılıyken
   A'ya bir kez basın: yeni vuruş başlamalı. İkisini de bırakın.
3. Hızlı yazıp durun: animasyon birikmeden beklemeye dönmeli.
4. Bir tuşa basarken sol, sonra sağ tıklayın: iki el birlikte çalışmalı.
5. Kontrolleri veya taşıma modunu açmadan masaüstündeki karakterin görünür kısmından
   tutup sürükleyin. Bırakıp Dosty'yi yeniden açın: konum korunmalı.
6. Karakterin üzerinden alttaki pencereye tıklayın: normal tıklama alta ulaşmalı.
   Tıklama geçirgenliği korunduğundan alttaki pencere sürüklemeyi de alabilir.
7. Tam ekran uygulama veya oyunu ayrıca deneyin. Özel tam ekran, korumalı masaüstleri
   ve bazı oyunlar girişi veya karakterin görünmesini engelleyebilir.
8. İsterseniz dört PNG veya 2×2 görsel yükleyip göz kırpma PNG'si ekleyin. Dosty'yi
   yeniden açın; kaynak görselleri kaldırsanız da karakter kullanılabilmeli.

Sorun bildirirken Dosty sürümünü, Windows sürümünü, kurulum/taşınabilir paket seçimini
ve çalışmayan adımı belirtin. Özel yazışmaları veya kişisel görselleri eklemeyin.
