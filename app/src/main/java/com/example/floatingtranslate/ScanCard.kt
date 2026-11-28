package com.example.floatingtranslate

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.min

// Kartu jawaban mengambang: bisa digeser dan diciutkan menjadi bulatan.
class ScanCard(
    private val context: Context,
    private val onRescan: () -> Unit,
    private val onStop: () -> Unit,
    private val startText: String = "Buka soalnya, jawaban muncul di sini.",
    private val extraIcon: Pair<String, () -> Unit>? = null
) {
    enum class State { READY, THINKING, ERROR }

    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val root = FrameLayout(context)
    private val dot = View(context)
    private val status = label("Scan aktif", 12f, Ui.MUTED)
    private val main = label(startText, 14f, Ui.TEXT)
    private val detail = label("", 13f, Ui.MUTED)
    private val bubble = label("AI", 14f, Ui.TEXT)
    private val card = LinearLayout(context)
    private val pulse = ObjectAnimator.ofFloat(dot, View.ALPHA, 1f, 0.2f).apply {
        duration = 600
        repeatCount = ValueAnimator.INFINITE
        repeatMode = ValueAnimator.REVERSE
    }

    private val scroll = object : ScrollView(context) {
        // Tinggi mengikuti isi, tetapi dibatasi supaya kartu tetap ringkas.
        override fun onMeasure(widthSpec: Int, heightSpec: Int) {
            super.onMeasure(widthSpec, MeasureSpec.makeMeasureSpec(dp(160), MeasureSpec.AT_MOST))
        }
    }

    private val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = dp(12)
        y = (context.resources.displayMetrics.heightPixels * 0.62f).toInt()
    }

    init {
        main.typeface = Typeface.DEFAULT_BOLD
        detail.visibility = View.GONE
        detail.setPadding(0, dp(6), 0, 0)

        val title = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).apply { rightMargin = dp(8) })
            addView(status)
        }
        draggable(title) {}

        val header = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(title, LinearLayout.LayoutParams(0, dp(32), 1f))
            if (extraIcon != null) addView(icon(extraIcon.first) { extraIcon.second() })
            addView(icon("↻") { onRescan() })
            addView(icon("–") { collapse(true) })
            addView(icon("✕") { onStop() })
        }
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(main)
            addView(detail)
        }
        scroll.addView(body)

        card.orientation = LinearLayout.VERTICAL
        card.background = Ui.box(context, Ui.CARD, 18, Ui.LINE)
        card.setPadding(dp(14), dp(6), dp(8), dp(12))
        card.addView(header)
        card.addView(scroll)

        bubble.gravity = Gravity.CENTER
        bubble.typeface = Typeface.DEFAULT_BOLD
        bubble.visibility = View.GONE
        draggable(bubble) { collapse(false) }

        val screen = context.resources.displayMetrics
        val cardWidth = min(dp(280), min(screen.widthPixels, screen.heightPixels) - dp(24))
        root.addView(card, FrameLayout.LayoutParams(cardWidth, FrameLayout.LayoutParams.WRAP_CONTENT))
        root.addView(bubble, FrameLayout.LayoutParams(dp(48), dp(48)))
        setState(State.READY, "Scan aktif")
    }

    fun show() = wm.addView(root, params)

    fun remove() {
        pulse.cancel()
        wm.removeView(root)
    }

    // Area yang ditempati kartu di layar, supaya tidak ikut di-scan.
    fun bounds(): Rect {
        val location = IntArray(2)
        root.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + root.width, location[1] + root.height)
    }

    fun setState(state: State, text: String) {
        val color = when (state) {
            State.READY -> Ui.GREEN
            State.THINKING -> Ui.PURPLE
            State.ERROR -> Ui.RED
        }
        status.text = text
        dot.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
        bubble.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR, intArrayOf(Ui.PURPLE, Ui.BLUE)
        ).apply {
            shape = GradientDrawable.OVAL
            setStroke(dp(3), color)
        }
        if (state == State.THINKING) {
            if (!pulse.isStarted) pulse.start()
        } else {
            pulse.cancel()
            dot.alpha = 1f
        }
    }

    // Baris pertama balasan ditonjolkan sebagai jawaban, sisanya penjelasan.
    fun showAnswer(reply: String) {
        val lines = reply.trim().split("\n", limit = 2)
        main.text = lines[0].trim()
        val rest = lines.getOrElse(1) { "" }.trim()
        detail.text = rest
        detail.visibility = if (rest.isEmpty()) View.GONE else View.VISIBLE
        scroll.scrollTo(0, 0)
        collapse(false)
    }

    private fun collapse(small: Boolean) {
        card.visibility = if (small) View.GONE else View.VISIBLE
        bubble.visibility = if (small) View.VISIBLE else View.GONE
    }

    private fun dp(value: Int) = Ui.dp(context, value)

    private fun label(value: String, size: Float, color: Int) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
    }

    private fun icon(symbol: String, action: () -> Unit) = label(symbol, 16f, Ui.MUTED).apply {
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(dp(32), dp(32))
        setOnClickListener { action() }
    }

    private fun draggable(view: View, onTap: () -> Unit) {
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        view.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x; startY = params.y
                    touchX = e.rawX; touchY = e.rawY
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - touchX
                    val dy = e.rawY - touchY
                    if (abs(dx) > dp(6) || abs(dy) > dp(6)) moved = true
                    if (moved) {
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        wm.updateViewLayout(root, params)
                    }
                }
                MotionEvent.ACTION_UP -> if (!moved) onTap()
            }
            true
        }
    }
}
