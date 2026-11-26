package com.example.floatingtranslate

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import kotlin.math.min

// Scanner soal: kamera langsung, arahkan soal ke dalam kotak, lalu tekan Scan.
class SoalActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var answer: TextView
    private lateinit var scanButton: Button
    private var busy = false

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera() else showMessage("Izin kamera ditolak. Aktifkan di pengaturan aplikasi.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val pad = (12 * resources.displayMetrics.density).toInt()
        val match = LinearLayout.LayoutParams.MATCH_PARENT
        val wrap = LinearLayout.LayoutParams.WRAP_CONTENT

        previewView = PreviewView(this).apply {
            // Mode TextureView supaya isi preview bisa diambil sebagai bitmap.
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        val camera = FrameLayout(this).apply {
            addView(previewView, FrameLayout.LayoutParams(match, match))
            addView(FrameBox(this@SoalActivity), FrameLayout.LayoutParams(match, match))
        }

        scanButton = Button(this).apply {
            text = "Scan"
            setOnClickListener { scan() }
        }
        val keyButton = Button(this).apply {
            text = "API key"
            setOnClickListener { askKey() }
        }
        val buttons = LinearLayout(this).apply {
            addView(scanButton, LinearLayout.LayoutParams(0, wrap, 1f))
            addView(keyButton, LinearLayout.LayoutParams(wrap, wrap))
        }

        answer = TextView(this).apply {
            textSize = 16f
            setPadding(pad, pad, pad, pad)
            setTextIsSelectable(true)
            text = "Arahkan soal ke dalam kotak, lalu tekan Scan."
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(camera, LinearLayout.LayoutParams(match, 0, 3f))
            addView(buttons, LinearLayout.LayoutParams(match, wrap))
            addView(
                ScrollView(this@SoalActivity).apply { addView(answer) },
                LinearLayout.LayoutParams(match, 0, 2f)
            )
        })

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
        if (Gemini.prefs(this).getString("key", "").isNullOrBlank()) askKey()
    }

    private fun showMessage(message: String) {
        answer.text = message
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build()
                preview.setSurfaceProvider(previewView.surfaceProvider)
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview)
            } catch (e: Exception) {
                answer.text = "Kamera gagal dibuka: ${e.message}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun scan() {
        if (busy) return
        val full = previewView.bitmap
        if (full == null) {
            answer.text = "Kamera belum siap."
            return
        }
        // Potong sesuai kotak supaya hanya soalnya yang dikirim.
        val box = frameFor(full.width.toFloat(), full.height.toFloat())
        val cropped = Bitmap.createBitmap(
            full, box.left.toInt(), box.top.toInt(), box.width().toInt(), box.height().toInt()
        )
        busy = true
        scanButton.isEnabled = false
        answer.text = "Lagi mikir..."
        val app = applicationContext
        Thread {
            val text = Gemini.ask(app, cropped)
            runOnUiThread {
                answer.text = text
                busy = false
                scanButton.isEnabled = true
            }
        }.start()
    }

    private fun askKey() {
        val prefs = Gemini.prefs(this)
        val input = EditText(this).apply {
            hint = "Tempel API key Gemini"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString("key", ""))
        }
        AlertDialog.Builder(this)
            .setTitle("API key")
            .setView(input)
            .setPositiveButton("Simpan") { _, _ ->
                prefs.edit().putString("key", input.text.toString().trim()).apply()
            }
            .setNegativeButton("Batal", null)
            .show()
    }
}

private fun frameFor(width: Float, height: Float): RectF {
    val margin = min(width, height) * 0.05f
    return RectF(margin, margin, width - margin, height - margin)
}

private class FrameBox(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.GREEN
        style = Paint.Style.STROKE
        strokeWidth = 3 * resources.displayMetrics.density
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRoundRect(frameFor(width.toFloat(), height.toFloat()), 24f, 24f, paint)
    }
}
