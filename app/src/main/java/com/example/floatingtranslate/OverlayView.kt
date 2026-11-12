package com.example.floatingtranslate

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.text.TextPaint
import android.view.View

class OverlayView(context: Context) : View(context) {

    data class Item(val rect: Rect, val text: String)

    private var items: List<Item> = emptyList()
    private val bgPaint = Paint().apply { color = Color.argb(250, 255, 255, 255) }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    fun setItems(newItems: List<Item>) {
        items = newItems
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (items.isEmpty()) return

        // Koordinat OCR mengikuti layar penuh, sedangkan view ini bisa bergeser
        // (misalnya karena status bar), jadi geser canvas supaya cocok.
        val loc = IntArray(2)
        getLocationOnScreen(loc)
        canvas.save()
        canvas.translate(-loc[0].toFloat(), -loc[1].toFloat())

        // Ukuran teks seragam: pakai median tinggi baris di layar.
        val heights = items.map { it.rect.height() }.sorted()
        val baseSize = maxOf(10f, heights[heights.size / 2] * 0.85f)
        val screenRight = (loc[0] + width - 4).toFloat()

        for (item in items) {
            val h = item.rect.height().toFloat()
            val padX = maxOf(3f, h * 0.2f)
            val padY = maxOf(2f, h * 0.12f)
            val innerLeft = item.rect.left.toFloat()
            val top = item.rect.top - padY
            val bottom = item.rect.bottom + padY

            var size = baseSize
            textPaint.textSize = size
            var textWidth = textPaint.measureText(item.text)
            val maxTextWidth = screenRight - innerLeft - padX
            if (textWidth > maxTextWidth && textWidth > 0f) {
                size = maxOf(8f, size * maxTextWidth / textWidth)
                textPaint.textSize = size
                textWidth = textPaint.measureText(item.text)
            }

            val right = maxOf(item.rect.right.toFloat() + padX, innerLeft + textWidth + padX)
            canvas.drawRect(innerLeft - padX, top, right, bottom, bgPaint)

            val fm = textPaint.fontMetrics
            val baseline = (top + bottom) / 2f - (fm.ascent + fm.descent) / 2f
            canvas.drawText(item.text, innerLeft, baseline, textPaint)
        }

        canvas.restore()
    }
}
