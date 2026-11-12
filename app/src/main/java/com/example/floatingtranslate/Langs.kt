package com.example.floatingtranslate

import com.google.mlkit.nl.translate.TranslateLanguage

object Langs {
    val ALL: List<Pair<String, String>> = listOf(
        "Indonesia" to TranslateLanguage.INDONESIAN,
        "Inggris" to TranslateLanguage.ENGLISH,
        "Jepang" to TranslateLanguage.JAPANESE,
        "Korea" to TranslateLanguage.KOREAN,
        "Mandarin" to TranslateLanguage.CHINESE,
        "Arab" to TranslateLanguage.ARABIC,
        "Prancis" to TranslateLanguage.FRENCH,
        "Jerman" to TranslateLanguage.GERMAN,
        "Spanyol" to TranslateLanguage.SPANISH,
    )
}
