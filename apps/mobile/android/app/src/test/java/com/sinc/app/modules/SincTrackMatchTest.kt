package com.sinc.app.modules

import com.sinc.app.modules.SincTrackMatch.bestMatch
import com.sinc.app.modules.SincTrackMatch.compactText
import com.sinc.app.modules.SincTrackMatch.hasForbiddenVariant
import com.sinc.app.modules.SincTrackMatch.isUnwantedLive
import com.sinc.app.modules.SincTrackMatch.artistSignal
import com.sinc.app.modules.SincTrackMatch.searchTitle
import com.sinc.app.modules.SincTrackMatch.stripVariantTags
import com.sinc.app.modules.SincTrackMatch.titleGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fixtures for the matching gates that decide which search result is saved as
 * "the song" — the regression suite for the wrong-song class of bugs (unlabeled
 * covers winning on title alone, altered uploads winning via duration-only
 * scoring, all-variant pools falling through on downloads).
 */
class SincTrackMatchTest {

  private fun cand(
    title: String,
    artist: String = "",
    durationMs: Long = 0,
    url: String = "https://example.test/$title"
  ) = SincTrackMatch.Candidate(title, artist, durationMs, url)

  // -------------------------------------------------------------------
  // The wrong-song gate: artist evidence is mandatory
  // -------------------------------------------------------------------

  @Test
  fun `rejects unlabeled cover with wrong uploader when duration is unknown`() {
    val best = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = null,
      candidates = listOf(
        cand(title = "Daylight", artist = "Cover Nation"),
        cand(title = "Daylight", artist = "deep focus", durationMs = 238_000),
      ),
    )
    assertNull(best)
  }

  @Test
  fun `rejects wrong-uploader candidate even with matching title tokens`() {
    val best = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = 210_000,
      // ratio 320/210 ≈ 1.52: inside the scoring eligibility (0.45..2.2) but
      // outside the 0.8..1.25 escape hatch, so zero artist signal must kill
      // this candidate regardless of the title score.
      candidates = listOf(cand(title = "Daylight", artist = "Music Hits 2026", durationMs = 320_000)),
    )
    assertNull("title-only candidate with loose duration must lose", best)
  }

  @Test
  fun `accepts artist channel with tight or absent duration`() {
    val exact = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = 210_000,
      candidates = listOf(cand(title = "Daylight", artist = "Ariana Grande - Topic", durationMs = 209_000)),
    )
    assertEquals("https://example.test/Daylight", exact?.url)
  }

  @Test
  fun `title containment with tight duration escapes the artist gate`() {
    // Compilation-style channel whose name never mentions the artist — the
    // escape hatch keeps these only when the length corroborates the title.
    val best = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = 210_000,
      candidates = listOf(cand(title = "Ariana Grande - Daylight", artist = "Best Pop Hits", durationMs = 211_000)),
    )
    assertEquals("https://example.test/Ariana Grande - Daylight", best?.url)
  }

  @Test
  fun `title containment with loose duration does not escape the artist gate`() {
    val best = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = 210_000,
      candidates = listOf(cand(title = "Daylight", artist = "Chill Vibes", durationMs = 420_000)),
    )
    assertNull(best)
  }

  @Test
  fun `real artist signal outranks escaped title-only candidate`() {
    // Both survive the gate (the unlabeled one via tight duration), but the
    // artist-evidenced upload must win the score.
    val best = bestMatch(
      title = "Daylight",
      artist = "Ariana Grande",
      durationMs = 210_000,
      candidates = listOf(
        SincTrackMatch.Candidate("Daylight", "Unlabeled Uploads", 211_000, "cover-url"),
        SincTrackMatch.Candidate("Daylight", "Ariana Grande - Topic", 209_000, "real-url"),
      ),
    )
    assertEquals("real-url", best?.url)
  }

  // -------------------------------------------------------------------
  // Alteration gates
  // -------------------------------------------------------------------

  @Test
  fun `forbidden variants win only when explicitly requested`() {
    val query = "Anti Hero Taylor Swift"
    assertTrue(hasForbiddenVariant(query, "Anti Hero (sped up)"))
    assertFalse(hasForbiddenVariant("Anti Hero (sped up)", "Anti Hero (sped up version)"))
  }

  @Test
  fun `strict download refuses an all-alteration pool`() {
    val best = bestMatch(
      title = "Levitating",
      artist = "Dua Lipa",
      durationMs = 203_000,
      candidates = listOf(cand(title = "Levitating (Nightcore Version)", artist = "Dua Lipa", durationMs = 160_000)),
      strict = true,
    )
    assertNull(best)
  }

  @Test
  fun `lenient playback still admits the alteration as last resort`() {
    val best = bestMatch(
      title = "Levitating",
      artist = "Dua Lipa",
      durationMs = 203_000,
      candidates = listOf(cand(title = "Levitating (Nightcore Version)", artist = "Dua Lipa", durationMs = 160_000)),
      strict = false,
    )
    // "A cover of the right song beats nothing" is PLAYER leniency; downloads
    // get the strict refusal above instead.
    assertEquals("https://example.test/Levitating (Nightcore Version)", best?.url)
  }

  @Test
  fun `strict download rejects a zero-artist re-upload inside the duration escape window`() {
    // The reported bug: an unlabeled sped-up / slowed+reverb re-upload titled
    // exactly like the song sits at ±10-15% duration, inside the 0.8x-1.25x
    // escape window, and used to win strict (download) matches.
    val best = bestMatch(
      title = "Die For You",
      artist = "Joji",
      durationMs = 210_000,
      candidates = listOf(
        SincTrackMatch.Candidate("Die For You", "Slowed Nation", 231_000, "wrong-url"),
      ),
      strict = true,
    )
    assertNull(best)
  }

  @Test
  fun `lenient playback keeps the zero-artist duration escape`() {
    val best = bestMatch(
      title = "Die For You",
      artist = "Joji",
      durationMs = 210_000,
      candidates = listOf(
        SincTrackMatch.Candidate("Die For You", "Slowed Nation", 209_000, "reupload-url"),
      ),
      strict = false,
    )
    // During playback an unlabeled re-upload of the right song still beats an
    // error screen; only downloads refuse it.
    assertEquals("reupload-url", best?.url)
  }

  @Test
  fun `strict download still accepts the artist-signed upload`() {
    val best = bestMatch(
      title = "Die For You",
      artist = "Joji",
      durationMs = 210_000,
      candidates = listOf(
        SincTrackMatch.Candidate("Die For You", "Joji - Topic", 209_000, "signed-url"),
      ),
      strict = true,
    )
    assertEquals("signed-url", best?.url)
  }

  // -------------------------------------------------------------------
  // Arabic/script reality of regional catalogs
  // -------------------------------------------------------------------

  @Test
  fun `arabic visual twin letters fold in normalization`() {
    // teh marbuta ة → ه and alef maqsura ى → ي: the same artist routinely
    // spells the name differently per platform ('حمو المرشدى' vs '…المرشدي').
    assertEquals(compactText("حمو المرشدى"), compactText("حمو المرشدي"))
    assertTrue(artistSignal("حمو المرشدى", "Hamo ELMorshdy - حمو المرشدي"))
  }

  @Test
  fun `strict pool accepts a cross-script official channel on near-exact length`() {
    // Channel name carries no artist evidence at all (latin channel for an
    // Arabic artist) — but the take is the SAME: title containment + identical
    // duration, zero alteration markers.
    val best = bestMatch(
      title = "الولا حمو جه",
      artist = "حمو المرشدى",
      durationMs = 203_000,
      candidates = listOf(
        cand(title = "الولا حمو جه", artist = "Hamo ELMorshdy", durationMs = 203_800),
      ),
      strict = true,
    )
    assertEquals("https://example.test/الولا حمو جه", best?.url)
  }

  @Test
  fun `strict pool refuses an unlabeled slowed take at 10 percent`() {
    val best = bestMatch(
      title = "الولا حمو جه",
      artist = "حمو المرشدى",
      durationMs = 203_000,
      candidates = listOf(
        cand(title = "الولا حمو جه", artist = "Random Mixes", durationMs = 223_000),
      ),
      strict = true,
    )
    assertNull(best)
  }

  @Test
  fun `strict pool refuses alteration-labeled channels even at exact length`() {
    val best = bestMatch(
      title = "Die For You",
      artist = "Joji",
      durationMs = 210_000,
      candidates = listOf(
        cand(title = "Die For You", artist = "Slowed Nation", durationMs = 210_200),
      ),
      strict = true,
    )
    assertNull(best)
  }

  // -------------------------------------------------------------------
  // Duration + title gates
  // -------------------------------------------------------------------

  @Test
  fun `hour-long compilation never wins a 3-minute song`() {
    val best = bestMatch(
      title = "Espresso",
      artist = "Sabrina Carpenter",
      durationMs = 175_000,
      candidates = listOf(cand(title = "Espresso", artist = "Sabrina Carpenter", durationMs = 3_600_000)),
    )
    assertNull(best)
  }

  @Test
  fun `off-topic title with overlapping tokens is rejected without artist signal`() {
    val best = bestMatch(
      title = "Runaway",
      artist = "Aurora",
      durationMs = 240_000,
      candidates = listOf(cand(title = "Runaway Baby", artist = "Some Channel", durationMs = 95_000)),
    )
    assertNull(best)
  }

  @Test
  fun `no candidates means no match`() {
    assertNull(bestMatch("Any", "Any", 1000, emptyList()))
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  @Test
  fun `searchTitle keeps variant parens and drops alt-title parens`() {
    assertEquals("Song (Remix)", searchTitle("Song (Remix)"))
    // "(Alternate Version)" names the wanted variant, so it stays in the query.
    assertEquals("Song (Alternate Version)", searchTitle("Song (Alternate Version)"))
    assertEquals("Song", searchTitle("Song (feat. Someone)"))
    assertEquals("Song", searchTitle("Song [Official Audio]"))
  }

  @Test
  fun `titleGate via uploader or containment`() {
    assertTrue(titleGate("Daylight", "Ariana Grande", "Daylight", "Ariana Grande - Topic").passed)
    assertTrue(titleGate("Daylight", "Ariana Grande", "Daylight (Official Audio)", "whatever").viaContainment)
    assertFalse(titleGate("Completely Different Song", "Ariana", "Weather Report 2024", "News Channel").passed)
  }

  // -------------------------------------------------------------------
  // Variant matching hygiene: words that CONTAIN a tag are not variants
  // -------------------------------------------------------------------

  @Test
  fun `words containing live are not live recordings`() {
    // "Stayin' Alive" contains the substring "live" — raw matching flagged
    // every such title as a live recording; boundary matching must not.
    assertFalse(hasForbiddenVariant("Bee Gees", "Stayin' Alive"))
    assertFalse(isUnwantedLive("Bee Gees", "Stayin' Alive"))
  }

  @Test
  fun `derivative spellings still count as variants`() {
    // Plural/derivative forms of forbidden tags keep matching; the raw
    // substring matcher lost these when words embed them ("instrumentals"
    // embeds "instrumental" only as a dictionary plural).
    assertTrue(hasForbiddenVariant("Golden Hour", "Golden Hour (Instrumentals)"))
    assertTrue(hasForbiddenVariant("Poker Face", "Poker Face (Karaoke Instrumentals)"))
    assertTrue(hasForbiddenVariant("Rehab", "Rehab (1 Hour Loop Version)"))
    assertTrue(hasForbiddenVariant("Blinding Lights", "Blinding Lights (Bootlegs Only)"))
  }

  @Test
  fun `explicitly requested variants are never their own forbidden tag`() {
    assertTrue(hasForbiddenVariant("Levitating (sped up)", "Levitating (Slowed Version)"))
    // The asked-for alteration in the result is fine.
    assertFalse(hasForbiddenVariant("Levitating sped up", "Levitating (Sped Up Version)"))
  }

  // -------------------------------------------------------------------
  // Collab credits: any credited artist provides the evidence
  // -------------------------------------------------------------------

  @Test
  fun `collab request matches an upload by any credited artist`() {
    val best = bestMatch(
      title = "Water",
      artist = "Tyla, Gunna & Skillibeng",
      durationMs = 200_000,
      candidates = listOf(
        cand(title = "Water", artist = "Tyla - Topic", durationMs = 199_000),
      ),
    )
    assertEquals("https://example.test/Water", best?.url)
  }

  @Test
  fun `collab still rejects an unrelated uploader`() {
    val best = bestMatch(
      title = "Water",
      artist = "Tyla, Gunna & Skillibeng",
      durationMs = 200_000,
      candidates = listOf(
        // Same title but 1.3x the length — no artist credit, no tight-duration
        // escape hatch: must lose.
        cand(title = "Water", artist = "Trending Mozambique", durationMs = 260_000),
      ),
    )
    assertNull(best)
  }

  // -------------------------------------------------------------------
  // Strict (download) title evidence: uploader identity is not enough
  // -------------------------------------------------------------------

  @Test
  fun `strict gate accepts channel match with corroborating length`() {
    val gate = titleGate(
      title = "Daylight",
      artist = "Ariana Grande",
      resultTitle = "Completely Different Title",
      uploader = "Ariana Grande - Topic",
      durationTight = true,
      requireEvidence = true,
    )
    assertTrue(gate.passed)
  }

  @Test
  fun `strict gate rejects uploader-only mismatch without length corroboration`() {
    val gate = titleGate(
      title = "Daylight",
      artist = "Ariana Grande",
      resultTitle = "Completely Different Title",
      uploader = "Ariana Grande - Topic",
      durationTight = false,
      requireEvidence = true,
    )
    assertFalse(gate.passed)
  }

  @Test
  fun `strict gate still passes containment regardless of length`() {
    val gate = titleGate(
      title = "Daylight",
      artist = "Ariana Grande",
      resultTitle = "Daylight (Album Version)",
      uploader = "Random Channel",
      durationTight = false,
      requireEvidence = true,
    )
    assertTrue(gate.passed)
  }

  @Test
  fun `requested original-mix stem matches the plain-title upload`() {
    // "Bizzare Contact & Electro Sun - Paragon" is the same song as
    // "Electro Sun - Paragon (Original Mix)": containment must see the same
    // stem ("paragon") once the compound qualifier is treated as a variant.
    val gate = titleGate(
      title = "Paragon (Original Mix)",
      artist = "Electro Sun",
      resultTitle = "Bizzare Contact & Electro Sun - Paragon",
      uploader = "Abora Recordings",
      durationTight = false,
      requireEvidence = false,
    )
    assertTrue(gate.passed)
    assertTrue(gate.viaContainment)
  }

  @Test
  fun `standalone original title word is not stripped`() {
    assertEquals("the original", stripVariantTags("The Original"))
    assertEquals("original", stripVariantTags("Original"))
  }

  @Test
  fun `original is stripped only next to a real variant tag`() {
    assertEquals("paragon", stripVariantTags("Paragon (Original Mix)"))
    assertEquals("paragon", stripVariantTags("Paragon (Original Extended Mix)"))
    assertEquals("stamina origami", stripVariantTags("Stamina Origami"))
  }
}
