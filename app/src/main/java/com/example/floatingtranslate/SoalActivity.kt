package com.example.floatingtranslate

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
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
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        keyInput = EditText(this).apply {
            hint = "API key Gemini"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(Gemini.prefs(this@SoalActivity).getString("key", ""))
        }
        root.addView(keyInput)
        root.addView(button("Mulai scan layar") {
            save()
            if (keyInput.text.isBlank()) keyInput.setError("Isi dulu API key")
            else startScan(askNotification = true)
        })
        root.addView(button("Hentikan scan") { stopService(Intent(this, SoalService::class.java)) })
        root.addView(TextView(this).apply {
            text = "Setelah dimulai, buka soalnya. Jawaban muncul otomatis di panel bawah."
        })
        setContentView(root)
    }

    override fun onPause() {
        save()
        super.onPause()
    }

    private fun button(label: String, action: (View) -> Unit) = Button(this).also {
        it.text = label
        it.setOnClickListener(action)
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
