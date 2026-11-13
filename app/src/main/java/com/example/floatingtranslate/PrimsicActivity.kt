package com.example.floatingtranslate

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap

class PrimsicActivity : Activity() {

    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // True hanya saat halaman offline (FotoLive di dalam APK) yang tampil.
    // Jembatan Android tidak boleh dipakai halaman online dari internet.
    @Volatile
    private var offlinePageActive = false
    private var fellBackToOffline = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 9 ke bawah butuh izin tulis untuk menyimpan ke folder Download.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE)
        }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
        }

        webView.addJavascriptInterface(Bridge(), "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                offlinePageActive = url?.startsWith(OFFLINE_PREFIX) == true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (offlinePageActive) {
                    view?.evaluateJavascript(readAsset("bridge.js"), null)
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true && !fellBackToOffline) {
                    showOffline("Server PRIMSIC tidak bisa dibuka, pakai FotoLive offline")
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: WebChromeClient.FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = params?.createIntent()
                if (intent == null) {
                    filePathCallback = null
                    return false
                }
                return try {
                    this@PrimsicActivity.startActivityForResult(intent, REQ_PICK)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        // Unduhan dari server online (http/https) lewat DownloadManager.
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }

        if (SERVER_URL.isNotBlank()) {
            webView.loadUrl(SERVER_URL)
        } else {
            showOffline(null)
        }
    }

    private fun showOffline(message: String?) {
        fellBackToOffline = true
        if (message != null) showToast(message)
        webView.loadUrl(OFFLINE_URL)
    }

    private fun startDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url))
        mimeType?.takeIf { it.isNotBlank() }?.let { request.setMimeType(it) }
        request.setTitle(fileName)
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
        userAgent?.takeIf { it.isNotBlank() }?.let { request.addRequestHeader("User-Agent", it) }
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        getSystemService(DownloadManager::class.java).enqueue(request)
        showToast("Mengunduh $fileName")
    }

    private fun showToast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    // Android 10 ke atas: simpan lewat MediaStore, tanpa izin tambahan.
    private fun saveToMediaStore(part: File, name: String, mime: String) {
        val resolver = contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("insert gagal")
        try {
            resolver.openOutputStream(uri)?.use { out ->
                part.inputStream().use { it.copyTo(out) }
            } ?: throw IllegalStateException("output null")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    // Android 9 ke bawah: tulis langsung ke folder Download.
    @Suppress("DEPRECATION")
    private fun saveLegacy(part: File, name: String) {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        val target = File(dir, name)
        part.copyTo(target, overwrite = true)
        MediaScannerConnection.scanFile(this, arrayOf(target.absolutePath), null, null)
    }

    private fun readAsset(name: String): String =
        assets.open(name).bufferedReader().use { it.readText() }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_PICK) {
            val uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    // Dipanggil dari bridge.js. Semua method menolak panggilan dari halaman online.
    // Method ini jalan di thread terpisah, jadi UI disentuh lewat mainHandler.
    inner class Bridge {
        private val parts = ConcurrentHashMap<String, File>()

        @JavascriptInterface
        fun begin(id: String) {
            if (!offlinePageActive) return
            val file = File(cacheDir, "dl-$id.part")
            file.delete()
            parts[id] = file
        }

        @JavascriptInterface
        fun append(id: String, base64Chunk: String) {
            if (!offlinePageActive) return
            val file = parts[id] ?: return
            val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
            FileOutputStream(file, true).use { it.write(bytes) }
        }

        @JavascriptInterface
        fun finish(id: String, name: String, mime: String) {
            if (!offlinePageActive) return
            val part = parts.remove(id) ?: return
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveToMediaStore(part, name, mime)
                } else {
                    saveLegacy(part, name)
                }
                toast("Tersimpan di folder Download: $name")
            } catch (e: Exception) {
                toast("Gagal menyimpan $name. Izinkan penyimpanan lalu coba lagi.")
            } finally {
                part.delete()
            }
        }

        @JavascriptInterface
        fun toast(message: String) {
            if (!offlinePageActive) return
            mainHandler.post { showToast(message) }
        }

        @JavascriptInterface
        fun close() {
            if (!offlinePageActive) return
            mainHandler.post { this@PrimsicActivity.finish() }
        }
    }

    companion object {
        // Alamat server PRIMSIC yang sudah online, contoh "https://nama-server-kamu.com/".
        // Kosongkan ("") untuk memakai FotoLive offline saja.
        const val SERVER_URL = ""

        private const val REQ_PICK = 1001
        private const val REQ_STORAGE = 1002
        private const val OFFLINE_PREFIX = "file:///android_asset/"
        private const val OFFLINE_URL = "file:///android_asset/fotolive/index.html"
    }
}
