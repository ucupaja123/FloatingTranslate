package com.example.floatingtranslate

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

class ScreenTranslateService : Service() {

    private val wm by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val handler = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var overlay: OverlayView? = null
    private var recognizer: TextRecognizer? = null
    private var translator: Translator? = null
    private var busy = false
    private var screenWidth = 0
    private var screenHeight = 0
    private var screenDpi = 0

    private val captureTask = object : Runnable {
        override fun run() {
            captureOnce()
            handler.postDelayed(this, CAPTURE_INTERVAL_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        )

        if (intent == null || intent.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
        if (resultCode != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startCapture(
            resultCode,
            data,
            intent.getIntExtra(EXTRA_SRC, 1),
            intent.getIntExtra(EXTRA_TGT, 0)
        )
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        overlay?.let { wm.removeView(it) }
        overlay = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        projection?.stop()
        projection = null
        recognizer?.close()
        recognizer = null
        translator?.close()
        translator = null
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun startCapture(resultCode: Int, data: Intent, srcIdx: Int, tgtIdx: Int) {
        val srcCode = Langs.ALL[srcIdx].second
        val tgtCode = Langs.ALL[tgtIdx].second
        if (srcCode == tgtCode) {
            Toast.makeText(this, "Bahasa sumber dan tujuan harus beda", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }

        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = mpm.getMediaProjection(resultCode, data)
        if (proj == null) {
            stopSelf()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            proj.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stopSelf()
                }
            }, handler)
        }
        projection = proj

        val dm = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(dm)
        screenWidth = dm.widthPixels
        screenHeight = dm.heightPixels
        screenDpi = dm.densityDpi

        val reader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        virtualDisplay = proj.createVirtualDisplay(
            "ScreenTranslate",
            screenWidth,
            screenHeight,
            screenDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            null
        )

        recognizer = when (srcCode) {
            TranslateLanguage.JAPANESE -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
            TranslateLanguage.KOREAN -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
            TranslateLanguage.CHINESE -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
            else -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        }

        val t = Translation.getClient(
            TranslatorOptions.Builder()
                .setSourceLanguage(srcCode)
                .setTargetLanguage(tgtCode)
                .build()
        )
        translator = t

        val view = OverlayView(this)
        overlay = view
        wm.addView(
            view,
            WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            )
        )

        t.downloadModelIfNeeded(DownloadConditions.Builder().build())
            .addOnSuccessListener { handler.post(captureTask) }
            .addOnFailureListener {
                Toast.makeText(this, "Gagal unduh model: ${it.message}", Toast.LENGTH_LONG).show()
                stopSelf()
            }
    }

    private fun captureOnce() {
        val reader = imageReader ?: return
        if (busy) return
        busy = true
        // Sembunyikan overlay sebentar supaya terjemahan sendiri tidak ikut dibaca.
        overlay?.visibility = View.INVISIBLE
        handler.postDelayed({ onFrameReady(grabBitmap(reader)) }, HIDE_DELAY_MS)
    }

    private fun onFrameReady(bitmap: Bitmap?) {
        overlay?.visibility = View.VISIBLE
        if (bitmap == null) {
            busy = false
            return
        }
        recognize(bitmap)
    }

    private fun grabBitmap(reader: ImageReader): Bitmap? {
        val image = reader.acquireLatestImage() ?: return null
        return try {
            val plane = image.planes[0]
            val rowPadding = plane.rowStride - plane.pixelStride * image.width
            val padded = Bitmap.createBitmap(
                image.width + rowPadding / plane.pixelStride,
                image.height,
                Bitmap.Config.ARGB_8888
            )
            padded.copyPixelsFromBuffer(plane.buffer)
            Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
        } catch (e: Exception) {
            null
        } finally {
            image.close()
        }
    }

    private fun recognize(bitmap: Bitmap) {
        val rec = recognizer
        if (rec == null) {
            busy = false
            return
        }
        rec.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { result ->
                val blocks = result.textBlocks.mapNotNull { b ->
                    val box = b.boundingBox
                    if (box != null && b.text.isNotBlank()) Pair(Rect(box), b.text) else null
                }
                translateBlocks(blocks)
            }
            .addOnFailureListener { busy = false }
    }

    private fun translateBlocks(blocks: List<Pair<Rect, String>>) {
        val t = translator
        if (t == null || blocks.isEmpty()) {
            overlay?.setItems(emptyList())
            busy = false
            return
        }
        val results = MutableList(blocks.size) { "" }
        var remaining = blocks.size
        blocks.forEachIndexed { i, block ->
            t.translate(block.second)
                .addOnSuccessListener { results[i] = it }
                .addOnFailureListener { results[i] = block.second }
                .addOnCompleteListener {
                    remaining--
                    if (remaining == 0) {
                        overlay?.setItems(
                            blocks.mapIndexed { j, b -> OverlayView.Item(b.first, results[j]) }
                        )
                        busy = false
                    }
                }
        }
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, "Terjemahan layar", NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, ScreenTranslateService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Terjemahan layar aktif")
            .setContentText("Teks di layar diterjemahkan otomatis")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .addAction(0, "Hentikan", stopIntent)
            .build()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "projection_data"
        const val EXTRA_SRC = "src_index"
        const val EXTRA_TGT = "tgt_index"
        private const val ACTION_STOP = "com.example.floatingtranslate.STOP_SCREEN"
        private const val CHANNEL_ID = "screen_translate"
        private const val NOTIF_ID = 2
        private const val CAPTURE_INTERVAL_MS = 2500L
        private const val HIDE_DELAY_MS = 150L
    }
}
