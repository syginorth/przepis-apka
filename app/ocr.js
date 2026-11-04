/* Odczyt tekstu ze zrzutów na telefonie (Tesseract), gdy AI nie odpowiada. Bez internetu do Google. */
(function (root) {
  'use strict';

  const DIR = new URL('vendor/tesseract-7.0.0/', document.baseURI).href;
  let library = null;

  function loadLibrary() {
    library ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DIR + 'tesseract.min.js';
      script.onload = () => resolve(root.Tesseract);
      script.onerror = () => { library = null; reject(new Error('Nie udało się wczytać odczytu tekstu. Sprawdź internet.')); };
      document.head.append(script);
    });
    return library;
  }

  /**
   * Odczytuje tekst z obrazów (Blob). onProgress dostaje liczbę 0–1.
   * Pierwszy raz pobiera ok. 6 MB (program + język polski), potem działa z pamięci telefonu.
   */
  async function readImages(blobs, onProgress = () => {}, signal) {
    const Tesseract = await loadLibrary();
    let index = 0;
    const worker = await Tesseract.createWorker('pol', 1, {
      workerPath: DIR + 'worker.min.js',
      corePath: DIR,
      langPath: DIR,
      workerBlobURL: false,
      logger: m => { if (m.status === 'recognizing text') onProgress((index + m.progress) / blobs.length); }
    });
    const stop = () => worker.terminate().catch(() => {});
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const texts = [];
      for (; index < blobs.length; index++) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const { data } = await worker.recognize(blobs[index]);
        texts.push(data.text);
      }
      return texts.join('\n');
    } finally {
      signal?.removeEventListener('abort', stop);
      worker.terminate().catch(() => {});
    }
  }

  root.MamaOcr = { readImages };
})(globalThis);
