(function () {
  if (window.__fotoBridgeReady) return;
  window.__fotoBridgeReady = true;

  // WebView tidak bisa mengunduh blob: URL, jadi simpan Blob-nya saat dibuat
  // lalu kirim isinya ke Kotlin lewat Android.append() per potongan.
  var blobs = new Map();
  var realCreate = URL.createObjectURL.bind(URL);
  var realRevoke = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    var url = realCreate(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    realRevoke(url);
  };

  function saveBlob(blob, name) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var CHUNK = 512 * 1024;
    var offset = 0;
    Android.begin(id);

    function next() {
      if (offset >= blob.size) {
        Android.finish(id, name, blob.type || 'application/octet-stream');
        return;
      }
      var part = blob.slice(offset, offset + CHUNK);
      offset += CHUNK;
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result);
        Android.append(id, s.slice(s.indexOf(',') + 1));
        next();
      };
      reader.onerror = function () {
        Android.toast('Gagal menyimpan ' + name);
      };
      reader.readAsDataURL(part);
    }
    next();
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!a) return;
    var url = a.href;
    if (!url || url.indexOf('blob:') !== 0) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    var name = a.getAttribute('download') || 'fotolive-unduhan';
    var blob = blobs.get(url);
    if (blob) {
      saveBlob(blob, name);
      return;
    }
    fetch(url)
      .then(function (r) { return r.blob(); })
      .then(function (b) { saveBlob(b, name); })
      .catch(function () { Android.toast('Gagal menyimpan ' + name); });
  }, true);
})();
