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
        for (item in items) {
            val h = item.rect.height().toFloat()
            val padX = maxOf(3f, h * 0.2f)
            val padY = maxOf(2f, h * 0.12f)
            val left = item.rect.left - padX
            val top = item.rect.top - padY
            val right = item.rect.right + padX
            val bottom = item.rect.bottom + padY
            canvas.drawRect(left, top, right, bottom, bgPaint)

            val availableWidth = (right - left) - padX
            var size = maxOf(10f, (bottom - top) * 0.72f)
            textPaint.textSize = size
            val measured = textPaint.measureText(item.text)
            if (measured > availableWidth && measured > 0f) {
                size = maxOf(8f, size * availableWidth / measured)
                textPaint.textSize = size
            }
            val fm = textPaint.fontMetrics
            val baseline = (top + bottom) / 2f - (fm.ascent + fm.descent) / 2f
            canvas.drawText(item.text, left + padX / 2f, baseline, textPaint)
        }
    }
}
