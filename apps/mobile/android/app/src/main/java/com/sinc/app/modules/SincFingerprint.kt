package com.sinc.app.modules

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Small Shazam-style landmark fingerprint used by the download verifier.
 *
 * A trusted catalog preview is reduced to spectral peaks, then triplets of
 * peaks are hashed with their time deltas. The downloaded file is reduced the same
 * way. If both contain the same recording, many hashes recur at one constant
 * time offset (the preview can be from anywhere in the full track); a different
 * recording produces only scattered coincidences.
 *
 * Pure Kotlin on purpose: no Chromaprint binary, native dependency or network
 * service is involved. Audio is decoded by the bundled ffmpeg before it gets
 * here.
 */
object SincFingerprint {
  const val SAMPLE_RATE = 8_000
  const val FRAME_SIZE = 1_024
  const val HOP_SIZE = 512

  private const val MIN_FREQ_HZ = 180
  private const val MAX_FREQ_HZ = 3_600
  private const val PEAKS_PER_FRAME = 4
  private const val MIN_PEAK_SEPARATION_BINS = 4
  private const val PEAK_RELATIVE_FLOOR = 0.06f
  private const val MIN_PAIR_DT = 1
  private const val MAX_PAIR_DT = 24
  private const val PAIRS_PER_ANCHOR = 3
  private const val TRIPLETS_PER_PAIR = 2
  private const val FREQ_QUANT = 2

  /** Reference clips below this are too quiet/short to make a verdict. */
  const val MIN_REFERENCE_HASHES = 40
  private const val MIN_MATCHES = 12
  private const val MIN_MATCH_RATIO = 0.03

  data class Hash(val value: Long, val frame: Int)

  data class Match(
    val matches: Int,
    val referenceHashes: Int,
    val offsetFrames: Int,
  ) {
    val ratio: Double
      get() = if (referenceHashes == 0) 0.0 else matches.toDouble() / referenceHashes
  }

  private data class Peak(val frame: Int, val bin: Int)

  private val hann = FloatArray(FRAME_SIZE) { i ->
    (0.5 - 0.5 * cos(2.0 * PI * i / (FRAME_SIZE - 1))).toFloat()
  }
  private val fft = Fft(FRAME_SIZE)

  /**
   * Returns the landmark hashes for mono PCM. [samples] must be 16-bit PCM at
   * [SAMPLE_RATE]. Safe for concurrent callers (the shared tables are
   * read-only; per-call buffers are local).
   */
  fun fingerprint(samples: ShortArray): List<Hash> {
    if (samples.size < FRAME_SIZE) return emptyList()

    val minBin = (MIN_FREQ_HZ * FRAME_SIZE / SAMPLE_RATE).coerceAtLeast(1)
    val maxBin = (MAX_FREQ_HZ * FRAME_SIZE / SAMPLE_RATE)
      .coerceAtMost(FRAME_SIZE / 2 - 2)
    if (maxBin <= minBin + 2) return emptyList()

    val re = FloatArray(FRAME_SIZE)
    val im = FloatArray(FRAME_SIZE)
    val mag = FloatArray(FRAME_SIZE / 2 + 1)
    val peaks = ArrayList<Peak>(samples.size / HOP_SIZE * PEAKS_PER_FRAME)
    val selectedBins = IntArray(PEAKS_PER_FRAME)
    val selectedMag = FloatArray(PEAKS_PER_FRAME)

    var frame = 0
    var start = 0
    while (start + FRAME_SIZE <= samples.size) {
      for (i in 0 until FRAME_SIZE) {
        re[i] = samples[start + i] * hann[i]
        im[i] = 0f
      }
      fft.transform(re, im)
      var maxMag = 0f
      for (bin in minBin..maxBin) {
        val value = re[bin] * re[bin] + im[bin] * im[bin]
        mag[bin] = value
        if (value > maxMag) maxMag = value
      }
      if (maxMag > 1e-9f) {
        val floor = maxMag * PEAK_RELATIVE_FLOOR
        var count = 0
        for (bin in (minBin + 1) until maxBin) {
          val value = mag[bin]
          if (value < floor) continue
          if (value <= mag[bin - 1] || value < mag[bin + 1]) continue

          var separated = true
          for (k in 0 until count) {
            if (abs(bin - selectedBins[k]) < MIN_PEAK_SEPARATION_BINS) {
              separated = false
              break
            }
          }
          if (!separated) continue

          var pos = count
          while (pos > 0 && selectedMag[pos - 1] < value) pos--
          if (pos >= PEAKS_PER_FRAME) continue
          val last = min(count, PEAKS_PER_FRAME - 1)
          for (k in last downTo pos + 1) {
            selectedBins[k] = selectedBins[k - 1]
            selectedMag[k] = selectedMag[k - 1]
          }
          selectedBins[pos] = bin
          selectedMag[pos] = value
          if (count < PEAKS_PER_FRAME) count++
        }

        // Frequency-ascending order keeps pair generation deterministic.
        for (i in 1 until count) {
          var j = i
          while (j > 0 && selectedBins[j - 1] > selectedBins[j]) {
            val binSwap = selectedBins[j - 1]
            selectedBins[j - 1] = selectedBins[j]
            selectedBins[j] = binSwap
            j--
          }
        }
        for (i in 0 until count) peaks.add(Peak(frame, selectedBins[i]))
      }

      start += HOP_SIZE
      frame += 1
    }

    if (peaks.isEmpty()) return emptyList()
    // Triplet hashes (anchor + two later peaks, with both time deltas) are
    // deliberately more specific than the usual peak pair. Two different
    // melodies can share a pair by coincidence; sharing three frequencies and
    // two deltas at a consistent offset is vanishingly unlikely, which keeps
    // the false-positive rate low without needing a huge match threshold.
    val hashes = ArrayList<Hash>(peaks.size * 3)
    for (i in peaks.indices) {
      val anchor = peaks[i]
      var pairCount = 0
      var j = i + 1
      while (j < peaks.size && pairCount < PAIRS_PER_ANCHOR) {
        val second = peaks[j]
        val dt1 = second.frame - anchor.frame
        if (dt1 > MAX_PAIR_DT) break
        if (dt1 >= MIN_PAIR_DT && abs(second.bin - anchor.bin) >= 2) {
          pairCount += 1
          var tripletCount = 0
          var k = j + 1
          while (k < peaks.size && tripletCount < TRIPLETS_PER_PAIR) {
            val third = peaks[k]
            val dt2 = third.frame - second.frame
            if (dt2 > MAX_PAIR_DT) break
            if (dt2 >= MIN_PAIR_DT && abs(third.bin - second.bin) >= 2) {
              val f0 = anchor.bin / FREQ_QUANT
              val f1 = second.bin / FREQ_QUANT
              val f2 = third.bin / FREQ_QUANT
              val value = (f0.toLong() shl 28) or
                (f1.toLong() shl 19) or
                (f2.toLong() shl 10) or
                (dt1.toLong() shl 5) or
                dt2.toLong()
              hashes.add(Hash(value, anchor.frame))
              tripletCount += 1
            }
            k += 1
          }
        }
        j += 1
      }
    }
    return hashes
  }

  /**
   * Correlates [reference] hashes against [full] hashes. The winning offset is
   * the preview's position inside the full file (in fingerprint frames). A
   * three-frame window absorbs one-hop differences from codec delay and
   * non-aligned slicing.
   */
  fun match(reference: List<Hash>, full: List<Hash>): Match {
    if (reference.isEmpty()) return Match(0, 0, 0)
    val refSet = HashSet<Long>(reference.size * 2)
    for (hash in reference) refSet.add(hash.value)

    val occurrences = HashMap<Long, MutableList<Int>>()
    for (hash in full) {
      if (!refSet.contains(hash.value)) continue
      occurrences.getOrPut(hash.value) { ArrayList(2) }.add(hash.frame)
    }
    if (occurrences.isEmpty()) return Match(0, reference.size, 0)

    val offsets = HashMap<Int, Int>()
    for (hash in reference) {
      val times = occurrences[hash.value] ?: continue
      for (fullFrame in times) {
        val offset = fullFrame - hash.frame
        offsets[offset] = (offsets[offset] ?: 0) + 1
      }
    }

    var bestWindow = 0
    var bestOffset = 0
    for ((offset, count) in offsets) {
      val window = count +
        (offsets[offset - 1] ?: 0) +
        (offsets[offset + 1] ?: 0)
      if (window > bestWindow) {
        bestWindow = window
        bestOffset = offset
      }
    }
    return Match(bestWindow, reference.size, bestOffset)
  }

  /** A match is accepted only above both an absolute and a relative floor. */
  fun isMatch(match: Match?): Boolean {
    if (match == null || match.referenceHashes < MIN_REFERENCE_HASHES) return false
    val threshold = maxOf(
      MIN_MATCHES,
      ceil(match.referenceHashes * MIN_MATCH_RATIO).toInt()
    )
    return match.matches >= threshold
  }

  /** In-place iterative radix-2 Cooley-Tukey FFT. Tables are read-only. */
  private class Fft(private val size: Int) {
    private val cosTable = FloatArray(size / 2)
    private val sinTable = FloatArray(size / 2)
    private val reversed = IntArray(size)

    init {
      for (i in 0 until size / 2) {
        val angle = 2.0 * PI * i / size
        cosTable[i] = cos(angle).toFloat()
        sinTable[i] = sin(angle).toFloat()
      }
      var j = 0
      for (i in 1 until size) {
        var bit = size shr 1
        while (j and bit != 0) {
          j = j xor bit
          bit = bit shr 1
        }
        j = j or bit
        reversed[i] = j
      }
    }

    fun transform(re: FloatArray, im: FloatArray) {
      for (i in 0 until size) {
        val j = reversed[i]
        if (j > i) {
          val reSwap = re[i]
          re[i] = re[j]
          re[j] = reSwap
          val imSwap = im[i]
          im[i] = im[j]
          im[j] = imSwap
        }
      }

      var length = 2
      while (length <= size) {
        val half = length / 2
        val step = size / length
        var start = 0
        while (start < size) {
          var k = 0
          for (offset in 0 until half) {
            val even = start + offset
            val odd = even + half
            val c = cosTable[k]
            val s = sinTable[k]
            val tr = re[odd] * c + im[odd] * s
            val ti = im[odd] * c - re[odd] * s
            re[odd] = re[even] - tr
            im[odd] = im[even] - ti
            re[even] += tr
            im[even] += ti
            k += step
          }
          start += length
        }
        length = length shl 1
      }
    }
  }
}
