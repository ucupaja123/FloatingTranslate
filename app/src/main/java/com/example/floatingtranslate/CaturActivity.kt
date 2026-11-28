package com.example.floatingtranslate

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.Executors

// Review catur untuk game yang sudah selesai. Tampilan ada di assets/catur,
// penilaian memakai Stockfish yang ikut di dalam APK (lewat StockfishEngine).
class CaturActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Ui.BG
        window.navigationBarColor = Ui.BG
        web = WebView(this).apply {
            setBackgroundColor(Ui.BG)
            settings.javaScriptEnabled = true
            // Halaman hanya dari dalam APK, tanpa akses internet.
            settings.blockNetworkLoads = true
            addJavascriptInterface(Bridge(), "Android")
            loadUrl("file:///android_asset/catur/index.html")
        }
        setContentView(web)
    }

    inner class Bridge {
        @JavascriptInterface
        fun analyze(id: Int, fen: String, thinkMs: Int) {
            if (closed) return
            worker.execute {
                val reply = try {
                    StockfishEngine.search(applicationContext, fen, thinkMs).raw
                } catch (e: Exception) {
                    StockfishEngine.stop()
                    "ERROR: Engine catur gagal: ${e.message}"
                }
                runOnUiThread {
                    if (!closed) web.evaluateJavascript("onEngine($id, ${JSONObject.quote(reply)})", null)
                }
            }
        }
    }

    override fun onDestroy() {
        closed = true
        // Mematikan proses juga melepas worker yang sedang menunggu keluaran engine.
        StockfishEngine.stop()
        worker.shutdownNow()
        web.destroy()
        super.onDestroy()
    }
}
