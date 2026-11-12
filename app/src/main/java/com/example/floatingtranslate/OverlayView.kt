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
    private val bgPaint = Paint().apply { color = Color.argb(245, 255, 255, 255) }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    fun setItems(newItems: List<Item>) {
        items = newItems
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (item in items) {
            val padX = maxOf(4, (item.rect.height() * 0.15f).toInt())
            val padY = maxOf(4, (item.rect.height() * 0.2f).toInt())
            val box = Rect(
                item.rect.left - padX,
                item.rect.top - padY,
                item.rect.right + padX,
                item.rect.bottom + padY
            )
            canvas.drawRect(box, bgPaint)

            val width = maxOf(1, box.width())
            var size = maxOf(12f, box.height() * 0.7f)
            var layout = buildLayout(item.text, width, size)
            while (layout.height > box.height() && size > 8f) {
                size -= 1f
                layout = buildLayout(item.text, width, size)
            }
            canvas.save()
            canvas.translate(box.left.toFloat(), box.top.toFloat())
            layout.draw(canvas)
            canvas.restore()
        }
    }

    private fun buildLayout(text: String, width: Int, size: Float): StaticLayout {
        textPaint.textSize = size
        return StaticLayout.Builder.obtain(text, 0, text.length, textPaint, width).build()
    }
}
