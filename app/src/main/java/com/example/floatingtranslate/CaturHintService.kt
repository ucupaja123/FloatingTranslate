package com.example.floatingtranslate

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

// Scan layar terus-menerus mencari papan catur: kalau posisi berhenti berubah
// (giliran lawan selesai), gambarnya dibaca AI jadi FEN lalu dihitung Stockfish
// yang ikut di dalam APK. Saran langkah tampil di kartu mengambang, seperti
// fitur Scan Soal tapi untuk catur dan tanpa OCR (papan catur tidak ada teks).
class CaturHintService : Service() {

    private val wm by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val handler = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var width = 0
    private var height = 0

    private var card: ScanCard? = null

    private var frame: Bitmap? = null
    private var previousHash: ByteArray? = null
    private var answeredHash: ByteArray? = null
    private var lastPlacement: String? = null
    private var whiteToMove = true
    private var asking = false
    private var force = false
    private var nextRequestAt = 0L
    private var destroyed = false

    private val loop = object : Runnable {
        override fun run() {
            scanOnce()
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null || intent.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        createChannel()
        ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        )
        if (projection != null) return START_NOT_STICKY

        val code = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
        if (code != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = mpm.getMediaProjection(code, data)
        if (proj == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf()
            }
        }, handler)
        projection = proj

        val m = metrics()
        val r = newReader(m)
        display = proj.createVirtualDisplay(
            "ScanCatur", width, height, m.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, null
        )
        card = ScanCard(
            this,
            onRescan = { force = true; nextRequestAt = 0L },
            onStop = { stopSelf() },
            startText = "Buka papan caturnya, saran langkah muncul di sini.",
            extraIcon = "⇄" to { flipTurn() }
        ).also { it.show() }
        handler.postDelayed(loop, INTERVAL_MS)
        return START_NOT_STICKY
    }

    // Kalau AI salah menebak giliran siapa jalan, pemain bisa membalik sendiri
    // tanpa perlu tanya ulang ke AI: posisi bidak yang sama, engine dihitung ulang.
    private fun flipTurn() {
        val placement = lastPlacement ?: return
        whiteToMove = !whiteToMove
        card?.setState(ScanCard.State.THINKING, "Berpikir…")
        Thread {
            val reply = computeHint(placement, whiteToMove)
            handler.post { if (!destroyed) { card?.showAnswer(reply); card?.setState(ScanCard.State.READY, "Saran") } }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun metrics() = DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }

    private fun newReader(m: DisplayMetrics): ImageReader {
        width = m.widthPixels
        height = m.heightPixels
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = r
        return r
    }

    // Layar diputar: ukuran tangkapan dan panel ikut disesuaikan.
    private fun resizeIfRotated() {
        val m = metrics()
        if (m.widthPixels == width && m.heightPixels == height) return
        val old = reader
        val r = newReader(m)
        display?.resize(width, height, m.densityDpi)
        display?.setSurface(r.surface)
        old?.close()
        frame = null
    }

    private fun scanOnce() {
        if (asking) return
        resizeIfRotated()
        // Kalau layar tidak berubah tidak ada frame baru, jadi frame terakhir dipakai lagi.
        grab()?.let { frame = it }
        val full = frame ?: return
        val view = card ?: return

        // Status bar dibuang dan area kartu ditutup, supaya kartu sendiri tidak ikut di-scan.
        val top = Ui.dp(this, 32)
        if (full.height - top < 50) return
        val area = Bitmap.createBitmap(full.width, full.height - top, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(area)
        canvas.drawBitmap(full, 0f, -top.toFloat(), null)
        val hidden = view.bounds()
        hidden.offset(0, -top)
        canvas.drawRect(hidden, Paint().apply { color = Color.GRAY })

        check(area)
    }

    private fun check(area: Bitmap) {
        val hash = grayHash(area)
        // Tunggu layar diam dulu (lawan selesai jalan) sebelum bertanya ke AI.
        val stable = previousHash?.let { diff(it, hash) < STABLE_THRESHOLD } ?: false
        previousHash = hash
        if (!force) {
            if (!stable) return
            answeredHash?.let { if (diff(it, hash) < STABLE_THRESHOLD) return }
        }
        if (SystemClock.elapsedRealtime() < nextRequestAt) return

        force = false
        asking = true
        card?.setState(ScanCard.State.THINKING, "Membaca papan…")
        val app = applicationContext
        Thread {
            val placement = Gemini.ask(app, area, Gemini.CATUR_PROMPT).trim()
            handler.post { if (!destroyed) onBoardRead(placement, hash) }
        }.start()
    }

    private fun onBoardRead(placement: String, hash: ByteArray) {
        val valid = placement.matches(Regex("[1-8a-hA-HkqrbnpKQRBNP/]+")) &&
            placement.count { it == '/' } == 7
        if (!valid) {
            asking = false
            // Belum ada papan catur terbaca (atau AI bilang tidak terbaca / API key kosong / kuota habis).
            val msg = when {
                placement.isBlank() || placement == "TIDAK_TERBACA" -> "Belum ada papan catur terlihat"
                placement.startsWith("Isi") -> placement
                placement.startsWith("Kuota") -> placement.also { nextRequestAt = SystemClock.elapsedRealtime() + 30000L }
                placement.startsWith("Gagal") || placement.startsWith("Error") ->
                    placement.also { nextRequestAt = SystemClock.elapsedRealtime() + 8000L }
                else -> "Belum ada papan catur terlihat"
            }
            card?.setState(ScanCard.State.READY, "Menunggu")
            card?.showAnswer(msg)
            return
        }
        lastPlacement = placement
        Thread {
            val reply = computeHint(placement, whiteToMove)
            handler.post {
                asking = false
                if (destroyed) return@post
                nextRequestAt = SystemClock.elapsedRealtime() + 3000L
                answeredHash = hash
                card?.showAnswer(reply)
                card?.setState(ScanCard.State.READY, "Saran")
            }
        }.start()
    }

    // Susun FEN lengkap (giliran ditebak/dipilih manual lewat tombol ⇄, status kastel
    // dan en passant diasumsikan masih mungkin) lalu minta Stockfish lokal mencari langkah terbaik.
    private fun computeHint(placement: String, white: Boolean): String {
        val turn = if (white) "w" else "b"
        val fen = "$placement $turn KQkq - 0 1"
        return try {
            val result = StockfishEngine.search(applicationContext, fen, THINK_MS)
            val who = if (white) "Putih" else "Hitam"
            val scoreLine = result.scoreText?.let { if (it.startsWith("mate")) "Mat dalam ${it.removePrefix("mate ")} langkah" else "Evaluasi $it" }
            "Saran ($who jalan): ${result.bestMove}" + if (scoreLine != null) "\n$scoreLine. Giliran salah? Ketuk ⇄." else "\nGiliran salah? Ketuk ⇄."
        } catch (e: Exception) {
            StockfishEngine.stop()
            "Gagal: engine catur error (${e.message})"
        }
    }

    // Hash perseptual sederhana: gambar diperkecil jadi grid abu-abu untuk dibandingkan antar-frame
    // (dipakai untuk mendeteksi papan berhenti berubah, bukan untuk membaca posisi bidak).
    private fun grayHash(bitmap: Bitmap): ByteArray {
        val size = 24
        val small = Bitmap.createScaledBitmap(bitmap, size, size, true)
        val out = ByteArray(size * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                val p = small.getPixel(x, y)
                val gray = (Color.red(p) + Color.green(p) + Color.blue(p)) / 3
                out[y * size + x] = gray.toByte()
            }
        }
        small.recycle()
        return out
    }

    // Jumlah selisih abu-abu per kotak grid; dibagi skala supaya ambangnya masuk akal.
    private fun diff(a: ByteArray, b: ByteArray): Int {
        var total = 0
        for (i in a.indices) total += kotlin.math.abs((a[i].toInt() and 0xFF) - (b[i].toInt() and 0xFF))
        return total / a.size
    }

    private fun grab(): Bitmap? {
        val image = reader?.acquireLatestImage() ?: return null
        return try {
            val plane = image.planes[0]
            val padded = Bitmap.createBitmap(
                plane.rowStride / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888
            )
            padded.copyPixelsFromBuffer(plane.buffer)
            Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
        } catch (e: Exception) {
            null
        } finally {
            image.close()
        }
    }

    override fun onDestroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        card?.remove()
        card = null
        display?.release()
        display = null
        reader?.close()
        reader = null
        projection?.stop()
        projection = null
        super.onDestroy()
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Hint catur", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Hint catur aktif")
        .setContentText("Layar sedang dipantau untuk papan catur")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .addAction(
            0, "Hentikan",
            PendingIntent.getService(
                this, 0,
                Intent(this, CaturHintService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE
            )
        )
        .build()

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "projection_data"
        private const val ACTION_STOP = "com.example.floatingtranslate.STOP_CATUR_HINT"
        private const val CHANNEL_ID = "catur_hint"
        private const val NOTIF_ID = 4
        private const val INTERVAL_MS = 900L
        private const val THINK_MS = 700
        // Ambang rata-rata beda abu-abu (skala 0-255) grid 24x24: di bawah ini dianggap sama persis.
        private const val STABLE_THRESHOLD = 6
    }
}
