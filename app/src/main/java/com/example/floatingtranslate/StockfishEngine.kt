package com.example.floatingtranslate

import android.content.Context
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import kotlin.math.max
import kotlin.math.min

// Pembungkus proses Stockfish (UCI) yang dipakai bersama oleh fitur review
// dan fitur hint langsung. Satu proses dipakai ulang selama masih hidup.
object StockfishEngine {

    // raw: dump UCI mentah (semua baris "info ..." sampai "bestmove ..."), dipakai
    // oleh review.js untuk evaluasi per-multipv. bestMove/scoreText adalah ringkasannya.
    data class Result(val raw: String, val bestMove: String, val scoreText: String?)

    @Volatile private var process: Process? = null
    private var reader: BufferedReader? = null
    private var writer: BufferedWriter? = null

    @Synchronized
    fun search(context: Context, fen: String, thinkMs: Int): Result {
        // FEN hanya boleh berisi karakter FEN, supaya tidak bisa menyisipkan perintah lain.
        require(fen.matches(Regex("[1-8a-hA-HkqrbnpKQRBNPw/ \\-0-9]+"))) { "posisi tidak valid" }
        if (process == null) start(context)
        send("position fen $fen")
        send("go movetime ${thinkMs.coerceIn(100, 5000)}")
        val text = readUntil("bestmove")
        val bestMove = Regex("bestmove (\\S+)").find(text)?.groupValues?.get(1) ?: "?"
        val score = Regex("score (cp|mate) (-?\\d+)").findAll(text).lastOrNull()?.let {
            val (kind, value) = it.destructured
            if (kind == "mate") "mate $value" else "${value.toInt() / 100.0}"
        }
        return Result(text, bestMove, score)
    }

    @Synchronized
    fun stop() {
        process?.destroy()
        process = null
        reader = null
        writer = null
    }

    private fun start(context: Context) {
        val binary = File(context.applicationInfo.nativeLibraryDir, "libstockfish.so")
        check(binary.exists()) { "file engine tidak ada untuk HP ini" }
        val started = ProcessBuilder(binary.absolutePath).redirectErrorStream(true).start()
        process = started
        reader = started.inputStream.bufferedReader()
        writer = started.outputStream.bufferedWriter()
        send("uci")
        readUntil("uciok")
        val threads = max(1, min(4, Runtime.getRuntime().availableProcessors() - 1))
        send("setoption name Threads value $threads")
        send("setoption name Hash value 32")
        send("setoption name MultiPV value 2")
        send("isready")
        readUntil("readyok")
    }

    private fun send(command: String) {
        val out = writer ?: error("engine belum jalan")
        out.write(command)
        out.newLine()
        out.flush()
    }

    private fun readUntil(prefix: String): String {
        val input = reader ?: error("engine belum jalan")
        val text = StringBuilder()
        while (true) {
            val line = input.readLine() ?: error("engine berhenti")
            text.appendLine(line)
            if (line.startsWith(prefix)) return text.toString()
        }
    }
}
