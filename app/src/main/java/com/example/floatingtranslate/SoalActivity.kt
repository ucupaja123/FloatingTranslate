package com.example.floatingtranslate

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class SoalActivity : AppCompatActivity() {

    private lateinit var keyInput: EditText

    private val notifPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { startScan(askNotification = false) }

    private val overlayPermission = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { if (Settings.canDrawOverlays(this)) startScan(askNotification = false) }

    private val projection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            ContextCompat.startForegroundService(
                this,
                Intent(this, SoalService::class.java)
                    .putExtra(SoalService.EXTRA_RESULT_CODE, r.resultCode)
                    .putExtra(SoalService.EXTRA_DATA, data)
            )
            moveTaskToBack(true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Ui.BG
        window.navigationBarColor = Ui.BG

        val logo = text("AI", 20f, Ui.TEXT).apply {
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
            background = Ui.gradient(this@SoalActivity, 20)
        }
        keyInput = EditText(this).apply {
            hint = "Tempel API key Gemini"
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            background = Ui.box(this@SoalActivity, Ui.FIELD, 14, Ui.LINE)
            setPadding(dp(16), 0, dp(16), 0)
            setText(Gemini.prefs(this@SoalActivity).getString("key", ""))
        }
        val start = button("Mulai scan") {
            save()
            if (keyInput.text.isBlank()) keyInput.setError("Isi dulu API key")
            else startScan(askNotification = true)
        }
        start.background = Ui.gradient(this, 14)
        val stop = button("Hentikan") { stopService(Intent(this, SoalService::class.java)) }
        stop.background = Ui.box(this, Ui.BG, 14, Ui.LINE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            addView(logo, LinearLayout.LayoutParams(dp(64), dp(64)))
            addView(text("Scan Soal", 26f, Ui.TEXT).apply {
                typeface = Typeface.DEFAULT_BOLD
                setPadding(0, dp(16), 0, dp(4))
            })
            addView(text("Buka soalnya, jawaban muncul otomatis.", 14f, Ui.MUTED))
            addView(keyInput, row(32))
            addView(start, row(12))
            addView(stop, row(10))
        }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Ui.BG)
            addView(root)
        })
    }

    private fun dp(value: Int) = Ui.dp(this, value)

    private fun row(top: Int) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, dp(52)
    ).apply { topMargin = dp(top) }

    private fun text(value: String, size: Float, color: Int) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        gravity = Gravity.CENTER
    }

    override fun onPause() {
        save()
        super.onPause()
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 15f
        isAllCaps = false
        setTextColor(Ui.TEXT)
        stateListAnimator = null
        setOnClickListener { action() }
    }

    private fun save() {
        Gemini.prefs(this).edit().putString("key", keyInput.text.toString().trim()).apply()
    }

    private fun startScan(askNotification: Boolean) {
        if (askNotification && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else if (!Settings.canDrawOverlays(this)) {
            overlayPermission.launch(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            )
        } else {
            val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection.launch(mpm.createScreenCaptureIntent())
        }
    }
}
