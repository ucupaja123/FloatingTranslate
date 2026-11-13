package com.example.floatingtranslate

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var spinScreenSrc: Spinner
    private lateinit var spinScreenTgt: Spinner

    private val notifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { checkOverlayThenStart() }

    private val overlayLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { checkOverlayThenStart() }

    private val screenNotifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { startScreenFlow() }

    private val screenOverlayLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { startScreenFlow() }

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            val intent = Intent(this, ScreenTranslateService::class.java)
                .putExtra(ScreenTranslateService.EXTRA_RESULT_CODE, result.resultCode)
                .putExtra(ScreenTranslateService.EXTRA_DATA, data)
                .putExtra(ScreenTranslateService.EXTRA_SRC, spinScreenSrc.selectedItemPosition)
                .putExtra(ScreenTranslateService.EXTRA_TGT, spinScreenTgt.selectedItemPosition)
            ContextCompat.startForegroundService(this, intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        spinScreenSrc = findViewById<Spinner>(R.id.spinScreenSrc)
        spinScreenTgt = findViewById<Spinner>(R.id.spinScreenTgt)
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, Langs.ALL.map { it.first })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinScreenSrc.adapter = adapter
        spinScreenTgt.adapter = adapter
        spinScreenSrc.setSelection(1)
        spinScreenTgt.setSelection(0)

        findViewById<Button>(R.id.btnScreenStart).setOnClickListener { startScreenFlow() }
        findViewById<Button>(R.id.btnScreenStop).setOnClickListener {
            stopService(Intent(this, ScreenTranslateService::class.java))
        }

        findViewById<Button>(R.id.btnStart).setOnClickListener { startWithPermissions() }
        findViewById<Button>(R.id.btnStop).setOnClickListener {
            stopService(Intent(this, FloatingService::class.java))
        }

        findViewById<Button>(R.id.btnPrimsic).setOnClickListener {
            startActivity(Intent(this, PrimsicActivity::class.java))
        }
    }

    private fun startWithPermissions() {
        val needsNotif = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        if (needsNotif) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        else checkOverlayThenStart()
    }

    private fun checkOverlayThenStart() {
        if (!Settings.canDrawOverlays(this)) {
            overlayLauncher.launch(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            )
        } else {
            ContextCompat.startForegroundService(this, Intent(this, FloatingService::class.java))
        }
    }

    private fun startScreenFlow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            screenNotifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            screenOverlayLauncher.launch(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            )
            return
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mpm.createScreenCaptureIntent())
    }
}
