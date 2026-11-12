package com.example.floatingtranslate

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View

class OverlayView(context: Context) : View(context) {

    data class Item(val rect: Rect, val text: String)

    private var items: List<Item> = emptyList()
    private val bgPaint = Paint().apply { color = Color.argb(230, 255, 255, 255) }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    fun setItems(newItems: List<Item>) {
        items = newItems
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (item in items) {
            canvas.drawRect(item.rect, bgPaint)
            val width = maxOf(1, item.rect.width())
            var size = maxOf(12f, item.rect.height() * 0.8f)
            var layout = buildLayout(item.text, width, size)
            while (layout.height > item.rect.height() && size > 8f) {
                size -= 1f
                layout = buildLayout(item.text, width, size)
            }
            canvas.save()
            canvas.translate(item.rect.left.toFloat(), item.rect.top.toFloat())
            layout.draw(canvas)
            canvas.restore()
        }
    }

    private fun buildLayout(text: String, width: Int, size: Float): StaticLayout {
        textPaint.textSize = size
        return StaticLayout.Builder.obtain(text, 0, text.length, textPaint, width).build()
    }
}
