package com.example.floatingtranslate

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
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
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

// Scan layar terus-menerus: teks layar dibaca di HP, dan kalau muncul soal baru
// gambarnya dikirim ke AI. Jawaban tampil di panel bilah bawah.
class SoalService : Service() {

    private val wm by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val handler = Handler(Looper.getMainLooper())
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var width = 0
    private var height = 0

    private var panel: LinearLayout? = null
    private lateinit var scroll: ScrollView
    private lateinit var answer: TextView
    private lateinit var status: TextView
    private var small = false

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

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

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
        addPanel()
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
        updatePanelSize()
    }

    private fun scanOnce() {
        if (reading || asking) return
        resizeIfRotated()
        // Kalau layar tidak berubah tidak ada frame baru, jadi frame terakhir dipakai lagi.
        grab()?.let { frame = it }
        val full = frame ?: return
        val view = panel ?: return

        // Hanya bagian di atas panel yang dibaca, supaya jawaban sendiri tidak ikut di-scan.
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val top = 32.dp
        val bottom = minOf(location[1], full.height)
        if (bottom - top < 50) return
        val area = Bitmap.createBitmap(full, 0, top, full.width, bottom - top)

        reading = true
        recognizer.process(InputImage.fromBitmap(area, 0))
            .addOnSuccessListener { result ->
                reading = false
                if (!destroyed) check(area, result.text)
            }
            .addOnFailureListener {
                reading = false
                if (!destroyed) status.setText("Gagal baca layar: ${it.message}")
            }
    }

    private fun check(area: Bitmap, text: String) {
        val words = text.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.toSet()
        // Tunggu layar diam (misalnya selesai digulir) sebelum bertanya ke AI.
        val stable = similarity(words, previousWords) > 0.8f
        previousWords = words
        if (text.length < MIN_TEXT) {
            status.text = "Menunggu soal..."
            return
        }
        if (!force) {
            if (!stable) return
            if (similarity(words, answeredWords) > 0.85f) return
        }
        if (SystemClock.elapsedRealtime() < nextRequestAt) return

        force = false
        asking = true
        status.text = "Lagi mikir..."
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
        nextRequestAt = SystemClock.elapsedRealtime() + if (failed) 30000L else 5000L
        if (!failed) answeredWords = words
        answer.text = reply
        scroll.scrollTo(0, 0)
        status.text = if (failed) "Gagal, dicoba lagi nanti" else "Scan aktif"
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

    private fun addPanel() {
        status = TextView(this).apply {
            text = "Scan aktif"
            textSize = 12f
            setTextColor(Color.DKGRAY)
        }
        answer = TextView(this).apply {
            text = "Buka soalnya di bagian atas layar."
            textSize = 15f
            setTextColor(Color.BLACK)
        }
        scroll = ScrollView(this).apply { addView(answer) }

        val buttons = LinearLayout(this).apply {
            addView(panelButton("Scan ulang") {
                force = true
                nextRequestAt = 0L
            }, LinearLayout.LayoutParams(0, 44.dp, 1f))
            addView(panelButton("Kecil/Besar") {
                small = !small
                scroll.visibility = if (small) View.GONE else View.VISIBLE
                updatePanelSize()
            }, LinearLayout.LayoutParams(0, 44.dp, 1f))
            addView(panelButton("Stop") { stopSelf() }, LinearLayout.LayoutParams(0, 44.dp, 1f))
        }

        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(8.dp, 4.dp, 8.dp, 4.dp)
            addView(status)
            addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(buttons)
        }
        panel = box
        wm.addView(box, panelParams())
    }

    private fun panelButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 12f
        setOnClickListener { action() }
    }

    private fun panelParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        if (small) WindowManager.LayoutParams.WRAP_CONTENT else (metrics().heightPixels * 0.32f).toInt(),
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply { gravity = Gravity.BOTTOM }

    private fun updatePanelSize() {
        panel?.let { wm.updateViewLayout(it, panelParams()) }
    }

    override fun onDestroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        panel?.let { wm.removeView(it) }
        panel = null
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
        private const val INTERVAL_MS = 1500L
        private const val MIN_TEXT = 15
    }
}
