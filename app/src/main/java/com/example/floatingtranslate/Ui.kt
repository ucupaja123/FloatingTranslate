package com.example.floatingtranslate

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable

object Ui {
    val BG = Color.parseColor("#0E1016")
    val CARD = Color.parseColor("#F2161922")
    val FIELD = Color.parseColor("#1C202B")
    val LINE = Color.parseColor("#2EFFFFFF")
    val TEXT = Color.parseColor("#F4F5F7")
    val MUTED = Color.parseColor("#9AA0AE")
    val PURPLE = Color.parseColor("#8B5CF6")
    val BLUE = Color.parseColor("#3B82F6")
    val GREEN = Color.parseColor("#34D399")
    val RED = Color.parseColor("#F87171")

    fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun box(context: Context, color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(context, radius).toFloat()
        if (stroke != null) setStroke(dp(context, 1), stroke)
    }

    fun gradient(context: Context, radius: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR, intArrayOf(PURPLE, BLUE)
    ).apply { cornerRadius = dp(context, radius).toFloat() }
}
