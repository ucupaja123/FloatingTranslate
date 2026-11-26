package com.example.floatingtranslate

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

object Gemini {
    const val DEFAULT_MODEL = "gemini-flash-latest"

    fun prefs(context: Context) = context.getSharedPreferences("soal", Context.MODE_PRIVATE)

    // Panggil dari thread latar. Selalu mengembalikan teks untuk ditampilkan.
    fun ask(context: Context, bitmap: Bitmap): String = try {
        val key = prefs(context).getString("key", "").orEmpty()
        val model = prefs(context).getString("model", "").orEmpty().ifBlank { DEFAULT_MODEL }
        if (key.isBlank()) "Isi API key Gemini dulu di menu Scan Soal." else request(key, model, bitmap)
    } catch (e: Exception) {
        "Gagal: ${e.message}"
    }

    private fun request(key: String, model: String, bitmap: Bitmap): String {
        val parts = JSONArray().put(
            JSONObject().put(
                "text",
                "Jawab soal pada gambar dalam bahasa Indonesia. Baris pertama hanya jawabannya, " +
                    "lalu baris baru berisi penjelasan maksimal 2 kalimat. Kalau ada beberapa soal, " +
                    "tulis nomor dan jawabannya. Kalau tidak terbaca atau tidak ada soal, katakan saja " +
                    "dengan singkat. Abaikan kotak abu-abu. Tanpa format markdown."
            )
        )
        val jpg = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, jpg)
        parts.put(
            JSONObject().put(
                "inline_data",
                JSONObject()
                    .put("mime_type", "image/jpeg")
                    .put("data", Base64.encodeToString(jpg.toByteArray(), Base64.NO_WRAP))
            )
        )
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("parts", parts)))
            .toString().toByteArray()

        val url = "https://generativelanguage.googleapis.com/v1beta/models/${Uri.encode(model)}:generateContent"
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 20000
            c.readTimeout = 90000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("x-goog-api-key", key)
            c.outputStream.use { it.write(body) }

            val status = c.responseCode
            val stream = if (status < 400) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status == 429) return "Kuota API habis. Tunggu sebentar atau cek kuota di Google AI Studio."
            if (status >= 400) return "Error $status: $text"

            val out = JSONObject(text).optJSONArray("candidates")
                ?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
                ?: return "AI tidak memberi jawaban."
            return (0 until out.length()).joinToString("") { out.getJSONObject(it).optString("text") }
                .ifBlank { "AI tidak memberi jawaban." }
        } finally {
            c.disconnect()
        }
    }
}
