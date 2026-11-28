package com.example.floatingtranslate

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

object Gemini {
    // Model ringan dicoba dulu supaya cepat; kalau sibuk, pindah ke cadangan.
    private val MODELS = listOf("gemini-flash-lite-latest", "gemini-flash-latest")
    private const val BUSY = "Gagal: server AI lagi sibuk. Otomatis dicoba lagi."

    private const val SOAL_PROMPT =
        "Jawab soal pada gambar dalam bahasa Indonesia. Baris pertama hanya jawabannya, " +
            "lalu baris baru berisi penjelasan maksimal 2 kalimat. Kalau ada beberapa soal, " +
            "tulis nomor dan jawabannya. Kalau tidak terbaca atau tidak ada soal, katakan saja " +
            "dengan singkat. Abaikan kotak abu-abu. Tanpa format markdown."

    const val CATUR_PROMPT =
        "Gambar ini papan catur. Baca posisi bidak dan tulis HANYA bagian penempatan bidak " +
            "dari FEN (8 baris dipisah '/', dari baris 8 ke baris 1, huruf besar untuk putih, " +
            "huruf kecil untuk hitam, angka untuk kotak kosong berurutan), dilihat dari sudut " +
            "pandang pemain putih (a1 di kiri bawah). Satu baris saja, tanpa penjelasan, tanpa " +
            "format markdown. Kalau papan catur tidak terlihat jelas, tulis saja: TIDAK_TERBACA."

    fun prefs(context: Context) = context.getSharedPreferences("soal", Context.MODE_PRIVATE)

    // Panggil dari thread latar. Selalu mengembalikan teks untuk ditampilkan.
    fun ask(context: Context, bitmap: Bitmap, prompt: String = SOAL_PROMPT): String {
        val key = prefs(context).getString("key", "").orEmpty()
        if (key.isBlank()) return "Isi API key Gemini dulu di menu Scan Soal."
        var reply = BUSY
        for (model in MODELS) {
            reply = try {
                request(key, model, bitmap, prompt) ?: continue
            } catch (e: SocketTimeoutException) {
                continue
            } catch (e: Exception) {
                return "Gagal: cek koneksi internet. (${e.message})"
            }
            break
        }
        return reply
    }

    // null berarti model ini sedang tidak bisa dipakai.
    private fun request(key: String, model: String, bitmap: Bitmap, prompt: String): String? {
        val parts = JSONArray().put(JSONObject().put("text", prompt))
        val jpg = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, jpg)
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
            c.connectTimeout = 10000
            c.readTimeout = 20000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("x-goog-api-key", key)
            c.outputStream.use { it.write(body) }

            val status = c.responseCode
            val stream = if (status < 400) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status == 429) return "Kuota API habis. Tunggu sebentar atau cek kuota di Google AI Studio."
            if (status == 404 || status >= 500) return null
            if (status == 400 || status == 401 || status == 403) {
                return "Error $status: permintaan ditolak. Cek lagi API key kamu."
            }
            if (status >= 400) return "Error $status dari server AI."

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
