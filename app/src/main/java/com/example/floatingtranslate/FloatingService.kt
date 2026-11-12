package com.example.floatingtranslate

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlin.math.abs

class FloatingService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var bubble: TextView
    private lateinit var panel: View
    private lateinit var bubbleLp: WindowManager.LayoutParams
    private lateinit var panelLp: WindowManager.LayoutParams
    private var panelShown = false

    private var translator: Translator? = null
    private var currentPair: Pair<String, String>? = null

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        createChannel()
        ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        )
        setupBubble()
        setupPanel()
    }

    private fun setupBubble() {
        bubble = TextView(this).apply {
            text = "TR"
            textSize = 14f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#1E88E5"))
            }
            elevation = 8f
        }

        bubbleLp = WindowManager.LayoutParams(
            56.dp, 56.dp,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 200.dp
        }

        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false

        bubble.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = bubbleLp.x; startY = bubbleLp.y
                    touchX = e.rawX; touchY = e.rawY
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - touchX
                    val dy = e.rawY - touchY
                    if (abs(dx) > 10 || abs(dy) > 10) moved = true
                    bubbleLp.x = startX + dx.toInt()
                    bubbleLp.y = startY + dy.toInt()
                    wm.updateViewLayout(bubble, bubbleLp)
                }
                MotionEvent.ACTION_UP -> if (!moved) togglePanel()
            }
            true
        }

        wm.addView(bubble, bubbleLp)
    }

    private fun setupPanel() {
        panel = LayoutInflater.from(this).inflate(R.layout.floating_panel, null)

        val spinSrc = panel.findViewById<Spinner>(R.id.spinSrc)
        val spinTgt = panel.findViewById<Spinner>(R.id.spinTgt)
        val etInput = panel.findViewById<EditText>(R.id.etInput)
        val tvOutput = panel.findViewById<TextView>(R.id.tvOutput)

        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, LANGS.map { it.first })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinSrc.adapter = adapter
        spinTgt.adapter = adapter
        spinSrc.setSelection(0)
        spinTgt.setSelection(1)

        panel.findViewById<Button>(R.id.btnSwap).setOnClickListener {
            val s = spinSrc.selectedItemPosition
            spinSrc.setSelection(spinTgt.selectedItemPosition)
            spinTgt.setSelection(s)
        }

        panel.findViewById<Button>(R.id.btnClose).setOnClickListener { togglePanel() }

        panel.findViewById<Button>(R.id.btnPaste).setOnClickListener {
            val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            val clip = cm.primaryClip
            if (clip != null && clip.itemCount > 0) {
                etInput.setText(clip.getItemAt(0).coerceToText(this))
            }
        }

        panel.findViewById<Button>(R.id.btnTranslate).setOnClickListener {
            val text = etInput.text.toString().trim()
            if (text.isEmpty()) return@setOnClickListener
            translate(
                text,
                LANGS[spinSrc.selectedItemPosition].second,
                LANGS[spinTgt.selectedItemPosition].second,
                tvOutput
            )
        }

        panel.findViewById<Button>(R.id.btnCopy).setOnClickListener {
            val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("hasil", tvOutput.text))
            Toast.makeText(this, "Disalin", Toast.LENGTH_SHORT).show()
        }

        panelLp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP
            y = 80.dp
        }
    }

    private fun togglePanel() {
        if (panelShown) {
            wm.removeView(panel)
            bubble.visibility = View.VISIBLE
        } else {
            wm.addView(panel, panelLp)
            bubble.visibility = View.GONE
        }
        panelShown = !panelShown
    }

    private fun translate(text: String, src: String, tgt: String, out: TextView) {
        out.text = "Menerjemahkan…"
        val t = getTranslator(src, tgt)
        t.downloadModelIfNeeded(DownloadConditions.Builder().build())
            .addOnSuccessListener {
                t.translate(text)
                    .addOnSuccessListener { out.text = it }
                    .addOnFailureListener { out.text = "Gagal: ${it.message}" }
            }
            .addOnFailureListener { out.text = "Gagal unduh model: ${it.message}" }
    }

    private fun getTranslator(src: String, tgt: String): Translator {
        if (translator == null || currentPair != (src to tgt)) {
            translator?.close()
            translator = Translation.getClient(
                TranslatorOptions.Builder()
                    .setSourceLanguage(src)
                    .setTargetLanguage(tgt)
                    .build()
            )
            currentPair = src to tgt
        }
        return translator!!
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "Floating Translate", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Floating Translate aktif")
            .setContentText("Ketuk bubble TR untuk menerjemahkan")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (panelShown) wm.removeView(panel)
        wm.removeView(bubble)
        translator?.close()
        super.onDestroy()
    }

    companion object {
        private const val NOTIF_ID = 1
        private const val CHANNEL_ID = "floating_translate"
        private val LANGS = listOf(
            "Indonesia" to TranslateLanguage.INDONESIAN,
            "Inggris" to TranslateLanguage.ENGLISH,
            "Jepang" to TranslateLanguage.JAPANESE,
            "Korea" to TranslateLanguage.KOREAN,
            "Mandarin" to TranslateLanguage.CHINESE,
            "Arab" to TranslateLanguage.ARABIC,
            "Prancis" to TranslateLanguage.FRENCH,
            "Jerman" to TranslateLanguage.GERMAN,
            "Spanyol" to TranslateLanguage.SPANISH,
        )
    }
}
