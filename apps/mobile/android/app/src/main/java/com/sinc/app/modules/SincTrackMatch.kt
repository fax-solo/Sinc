package com.sinc.app.modules

import java.text.Normalizer
import java.util.Locale

/**
 * Pure track-matching logic extracted from [SincYtModule] (no Android or RN
 * dependencies) so the acceptance gates are unit-testable. Mirrors
 * apps/server/src/lib/track-match.ts; the mobile copy is authoritative for
 * on-device search/download matching.
 *
 * The decisive gate added here: **artist evidence is mandatory**. A candidate
 * whose title matches but whose uploader/channel shows no resemblance to the
 * requested artist is exactly how unlabeled covers and re-uploads get saved as
 * the song — the old scoring only *penalized* that (title 100 + duration 25 -
 * artist 50 = 75 >= min 45, accepted). Now such candidates are rejected unless
 * the title matches outright AND the duration is tight (0.8x-1.25x), which is
 * the escape hatch that keeps "Artist - Topic"-style uploads and compilation
 * channels working where the channel name does not contain the artist.
 */
object SincTrackMatch {
  const val MIN_ACCEPT_SCORE = 45

  data class Candidate(val title: String, val artist: String, val durationMs: Long, val url: String)

  /**
   * How the title-relevance gate passed. The distinction matters for the
   * artist gate: containment ("title is literally this song") is strong
   * evidence; token overlap alone is not.
   */
  data class TitleGate(val passed: Boolean, val viaContainment: Boolean, val viaUploader: Boolean)

  // ---------------------------------------------------------------------
  // Text normalization
  // ---------------------------------------------------------------------

  /** Lowercases, removes diacritics/punctuation, collapses whitespace. */
  fun normalizeText(input: String): String =
    Normalizer.normalize(input, Normalizer.Form.NFKD)
      .replace(Regex("\\p{M}+"), "")
      // Arabic letter folding beyond NFKD: teh marbuta/ة and alef maqsura/ى
      // are VISUAL variants of ه and ي (the same name is routinely spelled
      // either way across platforms — 'حمو المرشدى' vs '…المرشدي'), Persian
      // ي merges into Arabic ي, and kashida/tatweel stretches are decoration.
      .replace(Regex("[\u0629\u06C0\u06C2]"), "\u0647")
      .replace(Regex("[\u0649\u06CC\u06C1\u06D2]"), "\u064A")
      .replace("\u0640", "")
      .lowercase(Locale.ROOT)
      .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
      .trim()
      .replace(Regex("\\s+"), " ")

  fun compactText(input: String): String = normalizeText(input).replace(" ", "")

  /** Jaccard overlap of the two texts' word tokens, 0..1. */
  fun tokenSimilarity(a: String, b: String): Double {
    val ta = a.split(' ').filter { it.isNotEmpty() }.toSet()
    val tb = b.split(' ').filter { it.isNotEmpty() }.toSet()
    if (ta.isEmpty() || tb.isEmpty()) return 0.0
    var intersection = 0
    for (t in ta) if (t in tb) intersection += 1
    val union = ta.size + tb.size - intersection
    return if (union == 0) 0.0 else intersection.toDouble() / union
  }

  private val variantTags = listOf(
    "remix", "remaster", "live", "lyrics", "karaoke", "instrumental", "acoustic",
    "cover", "mashup", "sped up", "slowed", "dance", "reverb", "8d", "loop", "edit",
    "version", "mix", "extended", "official video", "official audio", "official", "audio", "video",
    "mv", "music video",
  )

  private val variantPenalty = mapOf(
    "remix" to -45, "mashup" to -45, "sped up" to -45, "slowed" to -45,
    "dance" to -40, "reverb" to -40, "8d" to -40, "loop" to -40,
    "karaoke" to -35, "instrumental" to -35, "cover" to -35, "lyrics" to -30,
    "live" to -30, "remaster" to -20, "edit" to -25, "version" to -25,
    "mix" to -25, "official video" to -15, "music video" to -15, "mv" to -15,
    "video" to -15, "acoustic" to -25, "official audio" to 0, "official" to 0, "audio" to 0,
  )

  private val tokenSuffixes = setOf("s", "es", "ed", "ing")

  /**
   * Boundary-safe tag matching on NORMALIZED text. Raw substring matching had
   * false positives from words that merely CONTAIN a tag: "Stayin' Alive" was
   * flagged as a live recording ("alive" ⊃ "live"), "Conversion" triggered the
   * "version" tag. Phrases ("sped up", "8d audio") need their spaces, so they
   * match as padded substrings; single words match whole tokens with a small
   * plural/derivative tolerance ("remastered" → "remaster", "edits" → "edit").
   */
  private fun hasTag(normalizedText: String, rawTag: String): Boolean {
    val tag = normalizeText(rawTag)
    if (tag.isEmpty()) return false
    if (' ' in tag) return " $normalizedText ".contains(" $tag ")
    return normalizedText.split(' ').any { token ->
      token == tag || (token.length > tag.length && token.startsWith(tag) && token.drop(tag.length) in tokenSuffixes)
    }
  }

  /**
   * Upload kinds that are never the song the user asked for unless the query
   * itself names them: pitch/speed alterations, ambience edits, sing-alongs
   * and re-performances. Duration-based guards can't catch these (a sped-up
   * upload is ~as long as the original), so the title is checked instead.
   */
  private val forbiddenVariantTags = listOf(
    "sped up", "spedup", "sped-up", "slowed", "slow + reverb", "slowed + reverb",
    "reverb", "nightcore", "daycore", "8d audio", "8d", "loop", "1 hour",
    "10 hour", "hour loop", "hour version", "karaoke", "instrumental", "cover",
    "mashup", "bootleg", "tiktok version", "tiktok remix",
    // Live recordings (crowd noise, different timing) break lyrics sync and
    // are never what "the song" means unless explicitly requested.
    "live", "unplugged", "in concert",
  )

  /** True when the result is a labeled variant the query did not ask for. */
  fun hasForbiddenVariant(query: String, resultTitle: String): Boolean {
    val q = normalizeText(query)
    val r = normalizeText(resultTitle)
    return forbiddenVariantTags.any { tag -> hasTag(r, tag) && !hasTag(q, tag) }
  }

  /** True for live recordings the user didn't ask for. */
  fun isUnwantedLive(query: String, resultTitle: String): Boolean {
    val q = normalizeText(query)
    val r = normalizeText(resultTitle)
    return listOf("live", "unplugged", "in concert")
      .any { tag -> hasTag(r, tag) && !hasTag(q, tag) }
  }

  /** Keeps variant tags like "(Remix)"/" - Live" but drops alt-title parens. */
  fun searchTitle(title: String): String {
    var out = title
      .trim()
      .replace(Regex("\\([^)]*live[^)]*\\)", RegexOption.IGNORE_CASE), "")
      .replace(Regex("\\([^)]*radio[^)]*\\)", RegexOption.IGNORE_CASE), "")
      .replace(Regex("\\[[^\\]]+\\]"), "")
      .replace(Regex("\\s+"), " ")
      .trim()
    val parens = Regex("\\(.+\\)$").find(out)
    if (parens != null) {
      val inner = parens.value.substring(1, parens.value.length - 1).lowercase(Locale.ROOT)
      val isVariant = Regex(
        "remix|edit|mix\\b|version|rework|instrumental|acoustic|demo|live|radio|extended",
        RegexOption.IGNORE_CASE
      ).containsMatchIn(inner)
      if (!isVariant) out = out.substring(0, out.length - parens.value.length).trim()
    }
    return out
  }

  fun stripVariantTags(title: String): String {
    val withoutParens = title.replace(Regex("\\(([^)]*)\\)"), " $1 ")
    val words = Normalizer.normalize(withoutParens, Normalizer.Form.NFKD)
      .replace(Regex("\\p{M}+"), "")
      .lowercase(Locale.ROOT)
      .split(Regex("[^\\p{L}\\p{N}]+"))
      .filter { it.isNotEmpty() }
    // Compound qualifier: "Paragon (Original Mix)" and "Bizzare Contact & X -
    // Paragon" are the same stem. But on its own "original" is a legitimate
    // title word ("The Original"), so it survives unless a real variant tag
    // appears alongside it.
    val strip = if (words.any { it in variantTags }) variantTags + "original" else variantTags
    return words.filter { it !in strip }.joinToString(" ")
  }

  fun baseTitle(title: String): String =
    stripVariantTags(title.replace(Regex("\\([^)]*\\)"), " "))

  /**
   * Credits inside a request string: "Tyla, Gunna" is two artists, "Eminem
   * feat. Nate Dogg" is two, "Earth, Wind & Fire" is three. Evidence from ANY
   * credit counts — an "A - Topic" channel upload matches a request for
   * "A & B" even though the compact string of the whole query would not.
   */
  private val creditSeparators = Regex(
    """\s*(?:,|&|\+|\b(?:feat\.?|ft\.?|featuring|duet|versus|vs\.?|x|with)\b)\s*""",
    RegexOption.IGNORE_CASE,
  )

  fun artistCredits(artist: String): List<String> =
    artist.split(creditSeparators).map { it.trim() }.filter { normalizeText(it).isNotEmpty() }

  /** True when one credit string resembles an uploader/channel name. */
  private fun creditSignal(credit: String, uploader: String): Boolean {
    val creditCompact = compactText(credit)
    if (creditCompact.isEmpty()) return false
    val uploaderCompact = compactText(uploader)
    if (uploaderCompact.isEmpty()) return false
    if (uploaderCompact.contains(creditCompact) || creditCompact.contains(uploaderCompact)) return true
    return tokenSimilarity(normalizeText(credit), normalizeText(uploader)) >= 0.5
  }

  /**
   * True when the uploader/channel resembles the requested artist — the
   * request as a whole OR any single credit. Auto-generated "Artist - Topic"
   * channels pass; random re-uploaders ("Music Hits 2026") fail.
   */
  fun artistSignal(artist: String, uploader: String): Boolean {
    if (creditSignal(artist, uploader)) return true
    return artistCredits(artist).any { creditSignal(it, uploader) }
  }

  /**
   * Artist evidence score (0..25) using the same any-credit semantics as
   * [artistSignal]: the best evidence across the whole string and each
   * individual credit wins, so collab requests score against channels of any
   * credited artist.
   */
  private fun artistEvidenceScore(artist: String, candidateArtist: String): Int {
    fun scoreOf(credit: String): Int {
      val creditCompact = compactText(credit)
      val cCompact = compactText(candidateArtist)
      if (creditCompact.isEmpty() || cCompact.isEmpty()) return 0
      return when {
        cCompact == creditCompact -> 25
        cCompact.contains(creditCompact) || creditCompact.contains(cCompact) -> 18
        tokenSimilarity(normalizeText(credit), normalizeText(candidateArtist)) >= 0.5 -> 10
        else -> 0
      }
    }
    return maxOf(scoreOf(artist), artistCredits(artist).maxOfOrNull { scoreOf(it) } ?: 0)
  }

  /** Zero-evidence escape hatch also honours any single credit (≥ 0.3 overlap). */
  private fun artistLooseEvidence(artist: String, candidateArtist: String): Boolean {
    fun loose(credit: String): Boolean {
      val aNorm = normalizeText(credit)
      val cNorm = normalizeText(candidateArtist)
      return aNorm.isNotEmpty() && cNorm.isNotEmpty() && tokenSimilarity(cNorm, aNorm) >= 0.3
    }
    return loose(artist) || artistCredits(artist).any { loose(it) }
  }

  /**
   * Title-relevance gate for a top search hit. Passes when the hit's title
   * contains the requested title (or vice versa), when the uploader is
   * recognizably the artist's own channel, or when token overlap is strong.
   *
   * `requireEvidence` (downloads/strict): an uploader match alone is no longer
   * enough — a right-artists channel can still mislabel an upload — unless the
   * length corroborates the request, which keeps script-mismatched uploads
   * (Arabic title, Latin catalog name) alive.
   */
  fun titleGate(
    title: String,
    artist: String,
    resultTitle: String,
    uploader: String,
    durationTight: Boolean = false,
    requireEvidence: Boolean = false,
  ): TitleGate {
    val qTitle = stripVariantTags(title).lowercase(Locale.ROOT).trim()
    val rTitle = stripVariantTags(resultTitle).lowercase(Locale.ROOT).trim()
    val viaContainment = qTitle.isNotEmpty() && rTitle.isNotEmpty() &&
      (rTitle.contains(qTitle) || qTitle.contains(rTitle))
    val viaUploader = artistSignal(artist, uploader)
    if (viaContainment) return TitleGate(true, true, viaUploader)
    val tokenOverlap = qTitle.isNotEmpty() && rTitle.isNotEmpty() &&
      tokenSimilarity(qTitle, rTitle) >= 0.34
    if (requireEvidence && !tokenOverlap) {
      // Strict: uploader-only acceptance needs the length as a second witness.
      return TitleGate(viaUploader && durationTight, false, viaUploader)
    }
    if (viaUploader || tokenOverlap) return TitleGate(true, viaContainment, viaUploader)
    return TitleGate(false, false, false)
  }

  /**
   * Scores the candidate pool and returns the best acceptable candidate.
   *
   * @param strict downloads refuse an all-variant pool instead of saving a
   *   cover/slowed copy the user never asked for ("a slowed copy beats no song
   *   at all" remains playback-only leniency).
   */
  fun bestMatch(
    title: String,
    artist: String,
    durationMs: Long?,
    candidates: List<Candidate>,
    strict: Boolean = false,
  ): Candidate? {
    if (candidates.isEmpty()) return null
    // Hard duration gate first: scoring alone would still accept an hour-long
    // compilation whose title matches (title 100 + artist 25 clears the bar).
    val eligible = if (durationMs != null && durationMs > 0) {
      candidates.filter { c ->
        c.durationMs <= 0 || c.durationMs.toDouble() / durationMs in 0.45..2.2
      }
    } else {
      candidates
    }
    if (eligible.isEmpty()) return null
    // Same title-variant rule as the fast path: altered uploads can only win
    // when the user explicitly asked for that alteration.
    val queryText = "$artist $title"
    val noVariants = eligible.filterNot { c -> hasForbiddenVariant(queryText, c.title) }
    // Live recordings are excluded harder (they poison lyrics sync), but if
    // literally everything is live, score the pool rather than failing —
    // unless this is a strict resolve (downloads), where an all-alteration or
    // all-live pool is refused instead of saving a copy the user never asked
    // for.
    val noLive = (if (noVariants.isNotEmpty() || strict) noVariants else eligible)
      .filterNot { c -> isUnwantedLive(queryText, c.title) }
    val pool = when {
      noLive.isNotEmpty() -> noLive
      noVariants.isNotEmpty() -> noVariants
      // Strict (downloads): refuse instead of saving an alteration.
      else -> if (strict) return null else eligible
    }
    val qTitleNorm = normalizeText(title)
    val qTitleBase = baseTitle(title)
    val qArtistCompact = compactText(artist)
    val coCredit = Regex("\\+|&|\\bx\\b|,|\\bfeat\\b|\\bft\\.?\\b|\\bwith\\b|\\bduet\\b", RegexOption.IGNORE_CASE)

    val scored = pool.mapNotNull { c ->
      val cTitleNorm = normalizeText(c.title)
      val cTitleBase = baseTitle(c.title)

      var titleScore = 0
      if (cTitleBase.isNotEmpty() && qTitleBase.isNotEmpty()) {
        titleScore = when {
          cTitleBase == qTitleBase -> 100
          cTitleBase.contains(qTitleBase) || qTitleBase.contains(cTitleBase) -> 82
          else -> Math.round(tokenSimilarity(cTitleBase, qTitleBase) * 75).toInt()
        }
      } else if (cTitleNorm == qTitleNorm) {
        titleScore = 100
      }

      var artistScore = artistEvidenceScore(artist, c.artist)

      var durationScore = 0
      if (durationMs != null && durationMs > 0 && c.durationMs > 0) {
        val ratio = kotlin.math.abs(c.durationMs - durationMs) / durationMs.toDouble()
        durationScore = kotlin.math.max(0, Math.round(25.0 * (1.0 - kotlin.math.min(ratio, 0.15) / 0.15)).toInt())
      }

      var penalty = 0
      var variantHit = false
      for (tag in variantTags) {
        val inCandidate = hasTag(cTitleNorm, tag)
        val inQuery = hasTag(qTitleNorm, tag)
        if (inCandidate && !inQuery) penalty += variantPenalty[tag] ?: 0
      }
      val queryVariants = variantTags.filter { hasTag(qTitleNorm, it) }
      val baseMatched =
        cTitleBase == qTitleBase ||
          (qTitleBase.isNotEmpty() &&
            (cTitleBase.contains(qTitleBase) || qTitleBase.contains(cTitleBase)))
      if (queryVariants.isNotEmpty() && baseMatched) {
        val variantMatches = queryVariants.filter { hasTag(cTitleNorm, it) }
        if (variantMatches.size == queryVariants.size) {
          penalty += 35
          variantHit = true
        } else if (variantMatches.isEmpty()) {
          penalty -= 15 * queryVariants.size
        }
      }
      if (coCredit.containsMatchIn(cTitleNorm) && !coCredit.containsMatchIn(qTitleNorm)) penalty -= 40

      // --- hard artist gate (the wrong-song fix) --------------------------
      // Zero artist evidence + no tight title/duration corroboration = reject.
      // A query with unknown duration can never use the escape hatch, so
      // title-only candidates never win for it.
      val artistOk = artistScore > 0 || artistLooseEvidence(artist, c.artist)
      if (qArtistCompact.isNotEmpty() && !artistOk) {
        val nearExact = baseMatched &&
          durationMs != null && durationMs > 0 && c.durationMs > 0 &&
          c.durationMs.toDouble() / durationMs in 0.94..1.07 &&
          !hasForbiddenVariant(queryText, c.title) &&
          !hasForbiddenVariant(queryText, c.artist)
        if (strict) {
          // A file the user will keep: the only zero-artist escape is the
          // near-exact re-upload rule (the artist's channel under another
          // script — وينجى ↔ "Wingii" — and regional re-uploads keep their
          // original take, so duration stays within ±6%). Everything else —
          // including unlabeled sped/slowed versions at ±10-15% and
          // alteration-labeled channels — is refused.
          if (!nearExact) return@mapNotNull null
        } else {
          val tightTitleAndDuration =
            baseMatched &&
              durationMs != null && durationMs > 0 && c.durationMs > 0 &&
              c.durationMs.toDouble() / durationMs in 0.8..1.25
          if (!tightTitleAndDuration) return@mapNotNull null
          // Escape hatch survivors keep the original mismatch penalty: the title
          // carried the decision, so a real artist signal must outrank them.
          if (!variantHit) penalty -= 50
        }
      }

      Scored(c, titleScore + artistScore + durationScore + penalty)
    }

    val best = scored.maxByOrNull { it.score } ?: return null
    if (best.score < MIN_ACCEPT_SCORE) return null
    return best.candidate
  }

  private data class Scored(val candidate: Candidate, val score: Int)
}
