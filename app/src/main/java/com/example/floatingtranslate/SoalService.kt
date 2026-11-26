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
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

// Scan layar terus-menerus: teks layar dibaca di HP, dan kalau muncul soal baru
// gambarnya dikirim ke AI. Jawaban tampil di kartu mengambang.
class SoalService : Service() {

    private val wm by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val handler = Handler(Looper.getMainLooper())
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var width = 0
    private var height = 0

    private var card: ScanCard? = null

    private var frame: Bitmap? = null
    private var previousWords: Set<String> = emptySet()
    private var answeredWords: Set<String> = emptySet()
    private var reading = false
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
            "ScanSoal", width, height, m.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, null
        )
        card = ScanCard(this, onRescan = {
            force = true
            nextRequestAt = 0L
        }, onStop = { stopSelf() }).also { it.show() }
        handler.postDelayed(loop, INTERVAL_MS)
        return START_NOT_STICKY
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
        if (reading || asking) return
        resizeIfRotated()
        // Kalau layar tidak berubah tidak ada frame baru, jadi frame terakhir dipakai lagi.
        grab()?.let { frame = it }
        val full = frame ?: return
        val view = card ?: return

        // Status bar dibuang dan area kartu ditutup, supaya jawaban sendiri tidak ikut di-scan.
        val top = Ui.dp(this, 32)
        if (full.height - top < 50) return
        val area = Bitmap.createBitmap(full.width, full.height - top, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(area)
        canvas.drawBitmap(full, 0f, -top.toFloat(), null)
        val hidden = view.bounds()
        hidden.offset(0, -top)
        canvas.drawRect(hidden, Paint().apply { color = Color.GRAY })

        reading = true
        recognizer.process(InputImage.fromBitmap(area, 0))
            .addOnSuccessListener { result ->
                reading = false
                if (!destroyed) check(area, result.text)
            }
            .addOnFailureListener {
                reading = false
                if (!destroyed) card?.setState(ScanCard.State.ERROR, "Gagal baca layar")
            }
    }

    private fun check(area: Bitmap, text: String) {
        val words = text.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.toSet()
        // Tunggu layar diam (misalnya selesai digulir) sebelum bertanya ke AI.
        val stable = similarity(words, previousWords) > 0.8f
        previousWords = words
        if (text.length < MIN_TEXT) {
            card?.setState(ScanCard.State.READY, "Menunggu soal")
            return
        }
        if (!force) {
            if (!stable) return
            if (similarity(words, answeredWords) > 0.85f) return
        }
        if (SystemClock.elapsedRealtime() < nextRequestAt) return

        force = false
        asking = true
        card?.setState(ScanCard.State.THINKING, "Berpikir…")
        val app = applicationContext
        Thread {
            val reply = Gemini.ask(app, area)
            handler.post { if (!destroyed) onReply(reply, words) }
        }.start()
    }

    private fun onReply(reply: String, words: Set<String>) {
        asking = false
        val failed = listOf("Gagal", "Error", "Kuota", "Isi API").any { reply.startsWith(it) }
        // Jeda antar permintaan supaya kuota tidak cepat habis; lebih lama kalau gagal.
        nextRequestAt = SystemClock.elapsedRealtime() + if (reply.startsWith("Kuota")) 30000L else if (failed) 8000L else 3000L
        if (!failed) answeredWords = words
        card?.showAnswer(reply)
        if (failed) card?.setState(ScanCard.State.ERROR, "Gagal, dicoba lagi nanti")
        else card?.setState(ScanCard.State.READY, "Jawaban")
    }

    private fun similarity(a: Set<String>, b: Set<String>): Float {
        val total = a.union(b).size
        return if (total == 0) 0f else a.intersect(b).size.toFloat() / total
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
        recognizer.close()
        super.onDestroy()
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Scan soal", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Scan soal aktif")
        .setContentText("Layar sedang dibaca untuk mencari soal")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .addAction(
            0, "Hentikan",
            PendingIntent.getService(
                this, 0,
                Intent(this, SoalService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE
            )
        )
        .build()

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "projection_data"
        private const val ACTION_STOP = "com.example.floatingtranslate.STOP_SOAL"
        private const val CHANNEL_ID = "scan_soal"
        private const val NOTIF_ID = 3
        private const val INTERVAL_MS = 800L
        private const val MIN_TEXT = 15
    }
}
