package com.example.floatingtranslate

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

// Review catur untuk game yang sudah selesai. Tampilan ada di assets/catur,
// penilaian memakai Stockfish yang ikut di dalam APK.
class CaturActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var process: Process? = null
    @Volatile private var closed = false
    private var reader: BufferedReader? = null
    private var writer: BufferedWriter? = null

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
                    search(fen, thinkMs.coerceIn(100, 5000))
                } catch (e: Exception) {
                    stopEngine()
                    "ERROR: Engine catur gagal: ${e.message}"
                }
                runOnUiThread {
                    if (!closed) web.evaluateJavascript("onEngine($id, ${JSONObject.quote(reply)})", null)
                }
            }
        }
    }

    private fun search(fen: String, thinkMs: Int): String {
        // FEN hanya boleh berisi karakter FEN, supaya tidak bisa menyisipkan perintah lain.
        require(fen.matches(Regex("[1-8a-hA-HkqrbnpKQRBNPw/ \\-0-9]+"))) { "posisi tidak valid" }
        if (process == null) startEngine()
        send("position fen $fen")
        send("go movetime $thinkMs")
        return readUntil("bestmove")
    }

    private fun startEngine() {
        val binary = File(applicationInfo.nativeLibraryDir, "libstockfish.so")
        check(binary.exists()) { "file engine tidak ada untuk HP ini" }
        val started = ProcessBuilder(binary.absolutePath).redirectErrorStream(true).start()
        process = started
        reader = started.inputStream.bufferedReader()
        writer = started.outputStream.bufferedWriter()
        send("uci")
        readUntil("uciok")
        val threads = max(1, min(4, Runtime.getRuntime().availableProcessors() - 1))
        send("setoption name Threads value $threads")
        send("setoption name Hash value 32")
        send("setoption name MultiPV value 2")
        send("isready")
        readUntil("readyok")
    }

    private fun send(command: String) {
        val out = writer ?: error("engine belum jalan")
        out.write(command)
        out.newLine()
        out.flush()
    }

    private fun readUntil(prefix: String): String {
        val input = reader ?: error("engine belum jalan")
        val text = StringBuilder()
        while (true) {
            val line = input.readLine() ?: error("engine berhenti")
            text.appendLine(line)
            if (line.startsWith(prefix)) return text.toString()
        }
    }

    private fun stopEngine() {
        process?.destroy()
        process = null
        reader = null
        writer = null
    }

    override fun onDestroy() {
        closed = true
        // Mematikan proses juga melepas worker yang sedang menunggu keluaran engine.
        process?.destroy()
        worker.shutdownNow()
        web.destroy()
        super.onDestroy()
    }
}
